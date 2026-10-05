import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { redactEvent } from "../src/rooms/redact.ts";
import { searchRoomHistory } from "../src/rooms/search.ts";
import { snapshotRooms } from "../src/rooms/snapshot.ts";
import { TimelineFeed } from "../src/timeline/feed.ts";

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

/** Send an m.text and return its event id. Bursts trip the ratelimiter. */
async function sendText(token: string, roomId: string, body: string, txn: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(
            `${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ msgtype: "m.text", body }),
            },
        );
        if (res.status !== 429) {
            if (!res.ok) throw new Error(`PUT send -> ${res.status}: ${await res.text()}`);
            return ((await res.json()) as { event_id: string }).event_id;
        }
        if (attempt > 8) throw new Error(`send ratelimited after ${attempt} retries`);
        const retryAfter = ((await res.json()) as Record<string, unknown>)["retry_after_ms"];
        await new Promise((r) => setTimeout(r, (typeof retryAfter === "number" ? retryAfter : 1000) + 250));
    }
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

describe("message completeness against real Synapse", () => {
    it("round-trips a redaction: wire tombstone on one side, timeline tombstone on the other", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`xalice-${suffix}`, "testtesttest");
        const bob = await register(`xbob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "redact",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});
        await sendText(alice.token, room, "delete me, bob", `txn-x1-${suffix}`);

        const bobClient = clientFor(bob);
        const feedB = new TimelineFeed(bobClient);
        await bobClient.startClient({ initialSyncLimit: 10 });
        let aliceClient: MatrixClient | null = null;
        try {
            await waitFor("bob to see the target", () =>
                feedB.timeline(room).get().some((m) => m.body === "delete me, bob"),
            );
            const target = feedB.timeline(room).get().find((m) => m.body === "delete me, bob");
            assert.ok(target);

            aliceClient = clientFor(alice);
            await redactEvent(aliceClient, room, target.id, "integration");

            // Only the server applies it: the row tombstones on Bob's next
            // rebuild (the redaction event itself never renders).
            await waitFor("bob's row to tombstone", () => {
                const row = feedB.timeline(room).get().find((m) => m.id === target.id);
                return row?.body === "Message deleted." && row.redacted;
            });

            // The wire: body stripped, redaction explained.
            const wire = await api(
                "GET",
                `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/event/${encodeURIComponent(target.id)}`,
                alice.token,
            );
            const content = wire["content"] as Record<string, unknown>;
            assert.equal(content["body"], undefined, "the wire body is stripped");
            const unsigned = wire["unsigned"] as Record<string, unknown>;
            const because = unsigned?.["redacted_because"] as Record<string, unknown> | undefined;
            assert.equal(because?.["type"], "m.room.redaction");
        } finally {
            feedB.detachAll();
            await bobClient.stopClient();
            aliceClient?.stopClient();
        }
    });

    it("markRead lands the m.fully_read marker the room snapshot reads", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`xread-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "marker",
        }))["room_id"] as string;
        await sendText(alice.token, room, "read marker one", `txn-x2-${suffix}`);
        await sendText(alice.token, room, "read marker two", `txn-x3-${suffix}`);

        const aliceClient = clientFor(alice);
        const feed = new TimelineFeed(aliceClient);
        await aliceClient.startClient({ initialSyncLimit: 10 });
        try {
            await waitFor("both messages", () => feed.timeline(room).get().length >= 2);
            const tail = feed.timeline(room).get().at(-1);
            assert.ok(tail);

            await feed.markRead(room);

            // The marker is real account data, not a local-only flag.
            const marker = await api(
                "GET",
                `/_matrix/client/v3/user/${encodeURIComponent(alice.userId)}/rooms/${encodeURIComponent(room)}/account_data/m.fully_read`,
                alice.token,
            );
            assert.equal(marker["event_id"], tail.id, "marker points at the tail");

            // …and the snapshot's divider anchor follows it (next sync echo).
            await waitFor("marker in the room snapshot", () =>
                snapshotRooms(aliceClient).find((r) => r.id === room)?.fullyReadEventId === tail.id,
            );
        } finally {
            feed.detachAll();
            await aliceClient.stopClient();
        }
    });

    it("searches one room server-side, recent-first, paged with no repeats", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`xsearch-${suffix}`, "testtesttest");
        const token = `zqneedle${suffix}`; // one FTS token, unique to this run

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "search",
        }))["room_id"] as string;
        for (let i = 0; i < 12; i++) {
            await sendText(alice.token, room, `alpha ${token} bravo ${i}`, `txn-x4-${i}-${suffix}`);
        }

        const aliceClient = clientFor(alice);
        try {
            let page1: Awaited<ReturnType<typeof searchRoomHistory>> | null = null;
            await waitFor("search to index the newest message", async () => {
                page1 = await searchRoomHistory(aliceClient, room, token);
                return (page1?.hits.length ?? 0) > 0;
            });
            const first = page1;
            assert.ok(first);
            assert.equal(first.total, 12, "room-scoped count is exact");
            assert.equal(first.hits.length, 10, "one full page");
            assert.ok(first.nextBatch, "more results remain");
            assert.equal(first.hits[0]?.body, `alpha ${token} bravo 11`, "recent first");
            assert.equal(first.hits[0]?.senderId, alice.userId);
            assert.equal(first.hits[0]?.decryption, "ok");

            const second = await searchRoomHistory(aliceClient, room, token, first.nextBatch);
            assert.equal(second.hits.length, 2, "the tail page holds the rest");
            assert.equal(second.nextBatch, null, "and then we're done");
            assert.equal(second.total, 12);
            assert.equal(second.hits[0]?.body, `alpha ${token} bravo 1`);
            assert.equal(second.hits[1]?.body, `alpha ${token} bravo 0`);

            const ids = [...first.hits, ...second.hits].map((h) => h.id);
            assert.equal(new Set(ids).size, 12, "no repeats across pages");
        } finally {
            aliceClient.stopClient();
        }
    });

    it("jumpTo pages history into the window and stops at exhaustion", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`xjump-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "jump",
        }))["room_id"] as string;
        let oldestId = "";
        for (let i = 0; i < 60; i++) {
            const id = await sendText(alice.token, room, `jump message ${i}`, `txn-x5-${i}-${suffix}`);
            if (i === 0) oldestId = id;
        }

        const aliceClient = clientFor(alice);
        const feed = new TimelineFeed(aliceClient);
        await aliceClient.startClient({ initialSyncLimit: 10 });
        try {
            await waitFor("a partial initial window", () => feed.timeline(room).get().length >= 5);
            assert.ok(
                feed.timeline(room).get().length < 60,
                "the window starts short — otherwise the test proves nothing",
            );

            assert.equal(await feed.jumpTo(room, oldestId), true);
            assert.ok(
                feed.timeline(room).get().some((m) => m.id === oldestId),
                "the target is held after the walk",
            );

            assert.equal(
                await feed.jumpTo(room, "$not-here:localhost"),
                false,
                "exhausted history resolves false instead of hanging",
            );
        } finally {
            feed.detachAll();
            await aliceClient.stopClient();
        }
    });
});
