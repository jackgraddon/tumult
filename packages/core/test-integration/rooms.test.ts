import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { createDm } from "../src/rooms/lifecycle.ts";
import { updateRoomSettings } from "../src/rooms/settings.ts";
import { selectSpaceTree } from "../src/selectors/spaceTree.ts";
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
        body: body === undefined ? null : JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as Record<string, unknown>;
}

async function register(username: string, password: string): Promise<AuthedUser> {
    // Registration is UIAA: the first call returns a session, the second
    // completes the m.login.dummy stage.
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

async function waitFor(label: string, cond: () => boolean, timeoutMs = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (cond()) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await new Promise((r) => setTimeout(r, 500));
    }
}

describe("rooms against real Synapse", () => {
    it("syncs spaces, parent links and unread counts", { timeout: 180000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`alice-${suffix}`, "testtesttest");
        const bob = await register(`bob-${suffix}`, "testtesttest");

        // Alice builds: one space with two channel rooms.
        const space = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "Test Guild",
            creation_content: { type: "m.space" },
        }))["room_id"] as string;
        const general = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "general",
            topic: "hello there",
        }))["room_id"] as string;
        const random = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "random",
        }))["room_id"] as string;

        for (const child of [general, random]) {
            await api(
                "PUT",
                `/_matrix/client/v3/rooms/${encodeURIComponent(space)}/state/m.space.child/${encodeURIComponent(child)}`,
                alice.token,
                { via: ["localhost"] },
            );
            await api(
                "POST",
                `/_matrix/client/v3/rooms/${encodeURIComponent(child)}/invite`,
                alice.token,
                { user_id: bob.userId },
            );
        }
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(space)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );

        // Bob joins everything, then Alice speaks in #general while Bob is away.
        for (const roomId of [space, general, random]) {
            await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, bob.token, {});
        }
        await api(
            "PUT",
            `/_matrix/client/v3/rooms/${encodeURIComponent(general)}/send/m.room.message/txn1`,
            alice.token,
            { msgtype: "m.text", body: "hey bob" },
        );

        // Bob syncs with a raw SDK client (no crypto: rooms are unencrypted).
        const bobClient: MatrixClient = createClient({ baseUrl: BASE });
        await bobClient.loginWithPassword(bob.userId, "testtesttest");
        await bobClient.startClient({ initialSyncLimit: 10 });
        try {
            await waitFor(
                "bob to see 3 rooms",
                () =>
                    bobClient.getRooms().filter((r) => r.getMyMembership() === "join").length >= 3,
            );
            // Let the message's sync batch land so unread counts settle.
            await new Promise((r) => setTimeout(r, 2000));

            const summaries = snapshotRooms(bobClient);
            const byId = new Map(summaries.map((s) => [s.id, s]));

            const spaceSummary = byId.get(space);
            assert.ok(spaceSummary, "space is present");
            assert.equal(spaceSummary.isSpace, true);
            assert.equal(spaceSummary.name, "Test Guild");

            const generalSummary = byId.get(general);
            assert.ok(generalSummary, "#general is present");
            assert.deepEqual(generalSummary.parentSpaceIds, [space]);
            assert.equal(generalSummary.topic, "hello there");
            assert.ok(
                generalSummary.unreadCount >= 1,
                `expected unread in #general, got ${generalSummary.unreadCount}`,
            );

            const randomSummary = byId.get(random);
            assert.ok(randomSummary, "#random is present");
            assert.deepEqual(randomSummary.parentSpaceIds, [space]);

            // The pure selector eats the real feed without choking.
            const tree = selectSpaceTree(summaries);
            assert.equal(tree.guilds.length, 1);
            assert.equal(tree.guilds[0]?.rooms.length, 2);
            assert.equal(tree.orphans.length, 0);
        } finally {
            await bobClient.stopClient();
        }
    });

    it("lets the other person in a DM join its calls", { timeout: 60000 }, async () => {
        // Joining a call is sending a call.member STATE event. The private_chat
        // preset keeps state events at 50 and the invitee at 0, so a room that
        // does not lower it refuses every member but the creator: the bug the
        // two-browser media test found. createDm must open it, and lower
        // nothing else.
        const suffix = Date.now().toString(36);
        const alice = await register(`calla-${suffix}`, "testtesttest");
        const bob = await register(`callb-${suffix}`, "testtesttest");
        const CALL_MEMBER = "org.matrix.msc3401.call.member";
        const stateKey = encodeURIComponent(`_${bob.userId}_TEST`);

        // Control: the same preset without our helper refuses Bob, so the pass
        // below is the server's rule and not a permissive test server.
        const plain = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            preset: "private_chat",
            invite: [bob.userId],
        }))["room_id"] as string;
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(plain)}`, bob.token, {});
        await assert.rejects(
            api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(plain)}/state/${CALL_MEMBER}/${stateKey}`, bob.token, {}),
            /403/,
            "a plain private_chat room must refuse a member's call membership",
        );

        const aliceClient = createClient({ baseUrl: BASE, userId: alice.userId, accessToken: alice.token });
        const roomId = await createDm(aliceClient, { userId: bob.userId });
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, bob.token, {});
        await api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${CALL_MEMBER}/${stateKey}`, bob.token, {});

        const levels = await api("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`, alice.token);
        const events = levels["events"] as Record<string, number>;
        assert.equal(events[CALL_MEMBER], 0);
        // The server's defaults survive: only the one entry was lowered.
        assert.equal(events["m.room.power_levels"], 100);
        assert.equal(events["m.room.encryption"], 100);
        assert.equal(levels["state_default"], 50, "other state stays admin-only");
    });

    it("lets an admin open and close an existing room's calls from room settings", { timeout: 60000 }, async () => {
        // A room another client made (or Tumult before createDm opened calls):
        // calls are admins-only, and room settings is the way to change that.
        const suffix = Date.now().toString(36);
        const alice = await register(`setta-${suffix}`, "testtesttest");
        const bob = await register(`settb-${suffix}`, "testtesttest");
        const CALL_MEMBER = "org.matrix.msc3401.call.member";
        const stateKey = encodeURIComponent(`_${bob.userId}_TEST`);
        const roomId = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            preset: "private_chat",
            invite: [bob.userId],
        }))["room_id"] as string;
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, bob.token, {});
        // Different content each time: Synapse answers an IDENTICAL state write
        // with the existing event (200) before any permission check, so a
        // repeat of an earlier allowed write would pass even once closed.
        let attempt = 0;
        const bobJoinsCall = (): Promise<Record<string, unknown>> =>
            api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${CALL_MEMBER}/${stateKey}`, bob.token, {
                attempt: ++attempt,
            });

        await assert.rejects(bobJoinsCall(), /403/, "admins-only to begin with");
        const aliceClient = createClient({ baseUrl: BASE, userId: alice.userId, accessToken: alice.token });

        await updateRoomSettings(aliceClient, roomId, { membersCanJoinCalls: true });
        await bobJoinsCall();

        await updateRoomSettings(aliceClient, roomId, { membersCanJoinCalls: false });
        await assert.rejects(bobJoinsCall(), /403/, "closed again");
        const levels = await api("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`, alice.token);
        assert.equal((levels["events"] as Record<string, number>)["m.room.power_levels"], 100, "nothing else was lowered");

        // And a member cannot open them for themselves.
        const bobClient = createClient({ baseUrl: BASE, userId: bob.userId, accessToken: bob.token });
        await assert.rejects(updateRoomSettings(bobClient, roomId, { membersCanJoinCalls: true }), /403|permission/i);
    });
});
