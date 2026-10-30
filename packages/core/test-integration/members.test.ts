import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { MembersTracker } from "../src/rooms/members.ts";
import { readProfile, writeProfile } from "../src/rooms/profile.ts";
import { snapshotRooms } from "../src/rooms/snapshot.ts";

const BASE = process.env["TEST_SYNAPSE_URL"] ?? "http://localhost:8008";

interface AuthedUser {
    userId: string;
    token: string;
}

async function api(
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
): Promise<Record<string, unknown>> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as Record<string, unknown>;
}

async function register(username: string, password: string): Promise<AuthedUser> {
    const body = {
        username,
        password,
        device_id: `TEST-${username.toUpperCase()}`,
        initial_device_display_name: "integration test",
    };
    const first = await fetch(`${BASE}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (first.status !== 401) {
        throw new Error(`register step 1 -> ${first.status}: ${await first.text()}`);
    }
    const session = ((await first.json()) as Record<string, unknown>)["session"];
    const res = await api("POST", "/_matrix/client/v3/register", null, {
        ...body,
        auth: { type: "m.login.dummy", session },
    });
    return { userId: res["user_id"] as string, token: res["access_token"] as string };
}

async function waitFor(
    label: string,
    cond: () => boolean | Promise<boolean>,
    timeoutMs = 60000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await cond()) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await new Promise((r) => setTimeout(r, 500));
    }
}

function clientFor(user: AuthedUser): MatrixClient {
    return createClient({ baseUrl: BASE, userId: user.userId, accessToken: user.token });
}

/** Create a room as `owner`, invite each user, and have every invitee join. */
async function sharedRoom(
    owner: AuthedUser,
    joiners: AuthedUser[],
    invitersOnly: AuthedUser[] = [],
): Promise<string> {
    const roomId = (await api("POST", "/_matrix/client/v3/createRoom", owner.token, {
        name: "members fixture",
    }))["room_id"] as string;
    for (const user of [...joiners, ...invitersOnly]) {
        await api("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, owner.token, {
            user_id: user.userId,
        });
    }
    for (const user of joiners) {
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, user.token, {});
    }
    return roomId;
}

describe("members and profiles against real Synapse", () => {
    it("lazy roster completes via loadMembers, and member events rebuild it live", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`malice-${suffix}`, "testtesttest");
        const bob = await register(`mbob-${suffix}`, "testtesttest");
        const carol = await register(`mcarol-${suffix}`, "testtesttest");

        const roomId = await sharedRoom(alice, [carol], [bob]);
        const client = clientFor(alice);
        // The option under test: lazy loading ships only members who speak,
        // so the first snapshot is honestly partial until loadMembers().
        await client.startClient({ initialSyncLimit: 10, lazyLoadMembers: true });
        const tracker = new MembersTracker(client);
        try {
            await waitFor("alice to see the room", () => client.getRoom(roomId) !== null);
            const feed = tracker.members(roomId);
            assert.equal(feed, tracker.members(roomId), "same observable per room");

            const before = feed.get();
            assert.ok(
                before.length > 0 && before.some((m) => m.isSelf),
                "self arrives with the room",
            );

            await tracker.loadMembers(roomId);
            const after = feed.get();
            const ids = after.map((m) => m.userId);
            assert.deepEqual(
                [...ids].sort(),
                [alice.userId, bob.userId, carol.userId].sort(),
                `loadMembers completes the roster, got ${JSON.stringify(ids)}`,
            );
            const byId = new Map(after.map((m) => [m.userId, m]));
            assert.equal(byId.get(alice.userId)?.membership, "join");
            assert.equal(byId.get(carol.userId)?.membership, "join");
            assert.equal(byId.get(bob.userId)?.membership, "invite", "an unaccepted invite shows as invite");
            assert.equal(byId.get(alice.userId)?.isSelf, true);
            assert.equal(byId.get(bob.userId)?.isSelf, false);
            // Creator is the only admin; everyone else is a plain member.
            assert.equal(byId.get(alice.userId)?.powerLevel, 100);
            assert.equal(byId.get(bob.userId)?.powerLevel, 0);
            // Ordering guarantee: admins first, then members.
            assert.equal(after[0]?.userId, alice.userId);
            // Our own dot is ONE source: the client feeds the tracker its
            // ownPresence snapshot, and until then the row says `unknown`
            // rather than a stale `online`. Standalone, the test is the client.
            assert.equal(after[0]?.presence, "unknown", "own presence is unknown until the client reports it");
            tracker.setSelfPresence("online");
            assert.equal(feed.get()[0]?.presence, "online", "our row mirrors the reported presence");
            // Unnamed members render their localpart, never the raw mxid.
            assert.equal(byId.get(bob.userId)?.displayName, `mbob-${suffix}`);

            // A live membership change (profile rename → member event) must
            // rebuild the feed through the client's re-emitted RoomMember
            // events — the exact path a hand-typed stub could lie about.
            // Carol, not bob: she actually joined, so her profile change
            // reaches the room as an updated m.room.member event.
            await api(
                "PUT",
                `/_matrix/client/v3/profile/${encodeURIComponent(carol.userId)}/displayname`,
                carol.token,
                { displayname: `Zebulon ${suffix}` },
            );
            await waitFor("carol's rename to land in the roster", () =>
                feed.get().some((m) => m.userId === carol.userId && m.displayName === `Zebulon ${suffix}`),
            );
        } finally {
            tracker.detachAll();
            client.stopClient();
        }
    });

    it("presence arrives as a live event and lands in the roster", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`palice-${suffix}`, "testtesttest");
        const bob = await register(`pbob-${suffix}`, "testtesttest");
        const roomId = await sharedRoom(alice, [bob]);

        const aliceClient = clientFor(alice);
        await aliceClient.startClient({ initialSyncLimit: 10 });
        const tracker = new MembersTracker(aliceClient);
        let bobClient: MatrixClient | null = null;
        try {
            const feed = tracker.members(roomId);
            await waitFor("alice's roster to include bob", () =>
                feed.get().some((m) => m.userId === bob.userId),
            );
            // Own presence comes from the client's ownPresence, not the roster
            // (see the test above); play the client's part before asserting it.
            tracker.setSelfPresence("online");
            assert.equal(feed.get().find((m) => m.isSelf)?.presence, "online", "self is online");

            // Bob comes online with his own client: his server-side presence
            // changes, and the update rides alice's next sync as m.presence.
            // This is the whole honesty path — queued on the event, committed
            // at the sync boundary, then published.
            bobClient = clientFor(bob);
            await bobClient.startClient({ initialSyncLimit: 10 });
            await waitFor("bob's presence to go live in alice's roster", () => {
                const row = feed.get().find((m) => m.userId === bob.userId);
                return row?.presence === "online" && row.lastActiveTs !== null;
            }, 90000);
        } finally {
            tracker.detachAll();
            aliceClient.stopClient();
            bobClient?.stopClient();
        }
    });

    it("writeProfile and readProfile round-trip name and avatar", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`salice-${suffix}`, "testtesttest");

        assert.deepEqual(await readProfile(clientFor(alice)), {
            userId: alice.userId,
            displayName: `salice-${suffix}`,
            avatarUrl: null,
        });

        await writeProfile(clientFor(alice), { displayName: `  Slice Twenty-One  ` });
        assert.equal((await readProfile(clientFor(alice))).displayName, "Slice Twenty-One");

        // Avatar: upload through the media repo, then the profile points at it.
        const avatar = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
        await writeProfile(clientFor(alice), { avatar });
        const withAvatar = await readProfile(clientFor(alice));
        assert.ok(withAvatar.avatarUrl?.startsWith("mxc://"), `avatar is an mxc uri, got ${withAvatar.avatarUrl}`);

        // Clearing each half independently, exactly as the dialog offers.
        await writeProfile(clientFor(alice), { avatar: null });
        assert.equal((await readProfile(clientFor(alice))).avatarUrl, null);
        await writeProfile(clientFor(alice), { displayName: "" });
        assert.equal(
            (await readProfile(clientFor(alice))).displayName,
            `salice-${suffix}`,
            "an empty display name falls back to the localpart",
        );
    });

    it("room snapshot and roster agree after a join", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`jalice-${suffix}`, "testtesttest");
        const bob = await register(`jbob-${suffix}`, "testtesttest");
        const roomId = await sharedRoom(alice, [bob]);

        const client = clientFor(alice);
        await client.startClient({ initialSyncLimit: 10 });
        const tracker = new MembersTracker(client);
        try {
            await waitFor("room in the snapshot", () =>
                snapshotRooms(client).some((r) => r.id === roomId),
            );
            await tracker.loadMembers(roomId);
            const roster = tracker.members(roomId).get();
            assert.equal(roster.length, 2, "owner plus joiner, nothing else");
            assert.ok(roster.every((m) => m.membership === "join"));
            assert.equal(
                roster.filter((m) => m.isSelf).length,
                1,
                "exactly one self row, even with multiple devices' members collapsed",
            );
        } finally {
            tracker.detachAll();
            client.stopClient();
        }
    });
});
