import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

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
        body: body === undefined ? undefined : JSON.stringify(body),
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
});
