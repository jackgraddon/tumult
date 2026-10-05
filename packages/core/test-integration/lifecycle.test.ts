import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import {
    createChannel,
    createDm,
    createSpace,
    inviteToRoom,
    joinRoom,
    leaveRoom,
    searchUserDirectory,
} from "../src/rooms/lifecycle.ts";
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

/** A synced client with `roomId` visible in its snapshot. */
async function syncedWith(user: AuthedUser, roomId: string): Promise<MatrixClient> {
    const client = clientFor(user);
    await client.startClient({ initialSyncLimit: 10 });
    await waitFor(`${user.userId} to see ${roomId}`, () =>
        snapshotRooms(client).some((r) => r.id === roomId),
    );
    return client;
}

function stop(client: MatrixClient): void {
    client.stopClient();
}

describe("room lifecycle against real Synapse", () => {
    it("creates a space and channels that snap in under it, encrypted one included", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`lalice-${suffix}`, "testtesttest");
        const client = clientFor(alice);
        await client.startClient({ initialSyncLimit: 10 });
        try {
            const spaceId = await createSpace(client, { name: "Lifecycle Guild", topic: "slices" });
            await waitFor("space in the snapshot", () =>
                snapshotRooms(client).some((r) => r.id === spaceId && r.isSpace),
            );

            const plainId = await createChannel(client, spaceId, { name: "general" });
            await waitFor("plain channel in the snapshot", () =>
                snapshotRooms(client).some((r) => r.id === plainId),
            );

            // The whole point of the child link: snapshotRooms must place it.
            const snapshot = snapshotRooms(client);
            const space = snapshot.find((r) => r.id === spaceId);
            assert.ok(space?.isSpace, "space snapshots as a space");
            const plain = snapshot.find((r) => r.id === plainId);
            assert.deepEqual(plain?.parentSpaceIds, [spaceId], "channel parented to its space");

            // No encryption state on the default (toggle off).
            const plainStates = await api(
                "GET",
                `/_matrix/client/v3/rooms/${encodeURIComponent(plainId)}/state/m.room.encryption`,
                alice.token,
            ).then(
                () => true,
                () => false,
            );
            assert.equal(plainStates, false, "unencrypted channel has no encryption state");

            // Toggle on: m.room.encryption lands at creation.
            const encId = await createChannel(client, spaceId, { name: "secret", encrypted: true });
            const encState = await api(
                "GET",
                `/_matrix/client/v3/rooms/${encodeURIComponent(encId)}/state/m.room.encryption`,
                alice.token,
            );
            assert.equal(encState["algorithm"], "m.megolm.v1.aes-sha2", "encrypted at creation");
        } finally {
            stop(client);
        }
    });

    it("public channel with an alias is joinable by another user", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`lalice-${suffix}`, "testtesttest");
        const bob = await register(`lbob-${suffix}`, "testtesttest");

        const aliceClient = clientFor(alice);
        await aliceClient.startClient({ initialSyncLimit: 10 });
        let bobClient: MatrixClient | null = null;
        try {
            const spaceId = await createSpace(aliceClient, { name: "Public Guild" });
            const localpart = `town-hall-${suffix}`;
            const channelId = await createChannel(aliceClient, spaceId, {
                name: "town hall",
                visibility: "public",
                aliasLocalpart: localpart,
            });

            // Bob resolves the alias to the room id — the join-by-alias flow.
            bobClient = clientFor(bob);
            await bobClient.startClient({ initialSyncLimit: 10 });
            const joinedId = await joinRoom(bobClient, `#${localpart}:localhost`);
            assert.equal(joinedId, channelId, "alias resolves to the created channel");
            await waitFor("bob to see the joined room", () =>
                snapshotRooms(bobClient!).some((r) => r.id === channelId),
            );
        } finally {
            stop(aliceClient);
            bobClient && stop(bobClient);
        }
    });

    it("invite + join puts the room in both feeds; leave removes it from one", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`lalice-${suffix}`, "testtesttest");
        const bob = await register(`lbob-${suffix}`, "testtesttest");

        const aliceClient = clientFor(alice);
        await aliceClient.startClient({ initialSyncLimit: 10 });
        let bobClient: MatrixClient | null = null;
        try {
            const spaceId = await createSpace(aliceClient, { name: "Invite Guild" });
            const channelId = await createChannel(aliceClient, spaceId, { name: "crew" });

            await inviteToRoom(aliceClient, channelId, bob.userId);

            // The invite lands as an invite membership; joinRoom accepts it.
            bobClient = clientFor(bob);
            await bobClient.startClient({ initialSyncLimit: 10 });
            await waitFor("bob's invite to arrive", () =>
                bobClient!
                    .getRoom(channelId)
                    ?.getMember(bob.userId)
                    ?.membership === "invite",
            );
            const accepted = await joinRoom(bobClient, channelId);
            assert.equal(accepted, channelId, "joinRoom doubles as accept-invite");
            await waitFor("bob's snapshot to include the room", () =>
                snapshotRooms(bobClient!).some((r) => r.id === channelId),
            );

            // Alice leaves: the room leaves HER snapshot on a later sync.
            await leaveRoom(aliceClient, channelId);
            await waitFor("alice's snapshot to drop the room", () =>
                !snapshotRooms(aliceClient).some((r) => r.id === channelId),
            );
            assert.ok(
                snapshotRooms(bobClient).some((r) => r.id === channelId),
                "bob still has it after alice leaves",
            );
        } finally {
            stop(aliceClient);
            bobClient && stop(bobClient);
        }
    });

    it("createDm invites, records m.direct, and lands as an orphan", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`lalice-${suffix}`, "testtesttest");
        const bob = await register(`lbob-${suffix}`, "testtesttest");

        const client = clientFor(alice);
        await client.startClient({ initialSyncLimit: 10 });
        try {
            const roomId = await createDm(client, { userId: bob.userId });
            await waitFor("dm in the snapshot", () =>
                snapshotRooms(client).some((r) => r.id === roomId),
            );

            // Orphan rule: no parents means the DMs tab.
            const dm = snapshotRooms(client).find((r) => r.id === roomId);
            assert.deepEqual(dm?.parentSpaceIds, [], "DM is an orphan");

            // The mapping other clients read to file this under DMs.
            const direct = await api(
                "GET",
                `/_matrix/client/v3/user/${encodeURIComponent(alice.userId)}/account_data/m.direct`,
                alice.token,
            );
            const mapping = direct as Record<string, string[]>;
            assert.ok(
                (mapping[bob.userId] ?? []).includes(roomId),
                `m.direct maps ${bob.userId} -> ${roomId}, got ${JSON.stringify(mapping)}`,
            );
        } finally {
            stop(client);
        }
    });

    it("searchUsers finds a profile through the directory", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`lalice-${suffix}`, "testtesttest");
        const bob = await register(`lbob-${suffix}`, "testtesttest");
        // The directory indexes display names — set one before searching.
        await api(
            "PUT",
            `/_matrix/client/v3/profile/${encodeURIComponent(bob.userId)}/displayname`,
            bob.token,
            { displayname: `Zebulon ${suffix}` },
        );

        // Synapse's user_directory.search_all_users defaults to false: the
        // directory only answers with users you SHARE A ROOM WITH (a profile
        // isn't enough). That's also why the pickers keep the raw-mxid
        // fallback — a brand-new user is findable by id, not by search.
        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "directory",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});

        const client = clientFor(alice);
        await client.startClient({ initialSyncLimit: 10 });
        try {
            const results = await searchUserDirectory(client, `Zebulon ${suffix}`);
            const hit = results.find((r) => r.userId === bob.userId);
            assert.ok(hit, `directory should find Zebulon, got ${JSON.stringify(results)}`);
            assert.equal(hit.displayName, `Zebulon ${suffix}`);

            // And an unknown term finds nothing rather than everything.
            assert.deepEqual(await searchUserDirectory(client, "qqq-no-such-user-zzz"), []);

            // Raw-id input still resolves to a result clients can render.
            const byId = await searchUserDirectory(client, bob.userId);
            assert.ok(byId.some((r) => r.userId === bob.userId));
        } finally {
            stop(client);
        }
    });
});
