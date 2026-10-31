import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, PendingEventOrdering } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";

import { TimelineFeed } from "../src/timeline/feed.ts";
import { sendTextMessage } from "../src/rooms/send.ts";

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

async function sendText(token: string, roomId: string, body: string, txn: string): Promise<void> {
    // Bursts trip Synapse's ratelimiter: honor retry_after_ms and retry.
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
            return;
        }
        if (attempt > 8) throw new Error(`send ratelimited after ${attempt} retries`);
        const retryAfter = ((await res.json()) as Record<string, unknown>)["retry_after_ms"];
        await new Promise((r) => setTimeout(r, (typeof retryAfter === "number" ? retryAfter : 1000) + 250));
    }
}

async function waitFor(label: string, cond: () => boolean, timeoutMs = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (cond()) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await new Promise((r) => setTimeout(r, 500));
    }
}

describe("inline replies against real Synapse", () => {
    it("round-trips rich replies: wire shape, fallback strip, quote enrichment", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`qalice-${suffix}`, "testtesttest");
        const bob = await register(`qbob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "replies",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});
        // Multi-line target: the fallback must quote every line.
        await sendText(alice.token, room, "original line\nsecond line", `txn-q1-${suffix}`);

        const bobClient: MatrixClient = createClient({
            baseUrl: BASE,
        });
        await bobClient.loginWithPassword(bob.userId, "testtesttest");
        const feedB = new TimelineFeed(bobClient);
        await bobClient.startClient({ initialSyncLimit: 10, pendingEventOrdering: PendingEventOrdering.Chronological });
        let feedA: TimelineFeed | null = null;
        let aliceClient: MatrixClient | null = null;
        try {
            const timelineB = feedB.timeline(room);
            await waitFor("bob to see the target", () => timelineB.get().length >= 1);
            const targetId = timelineB.get()[0]?.id;
            assert.ok(targetId);

            // Our production send path: relation + fallback + mention.
            await sendTextMessage(bobClient, room, "the reply", targetId);
            await waitFor("bob's reply to echo stripped", () =>
                timelineB.get().some((m) => m.body === "the reply" && m.reply?.eventId === targetId),
            );
            const own = timelineB.get().find((m) => m.reply?.eventId === targetId);
            assert.ok(own);
            // Fallback parsed provisionally before the target's own values land.
            assert.equal(own.reply?.senderId, alice.userId);

            // The wire carries the spec fallback and the in_reply_to relation.
            const wire = await api(
                "GET",
                `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/event/${encodeURIComponent(own.id)}`,
                alice.token,
            );
            const wireContent = wire["content"] as Record<string, unknown>;
            const relates = wireContent["m.relates_to"] as Record<string, unknown>;
            assert.deepEqual(relates["m.in_reply_to"], { event_id: targetId });
            assert.equal(
                wireContent["body"],
                `> <${alice.userId}> original line\n> second line\n\nthe reply`,
            );
            assert.deepEqual((wireContent["m.mentions"] as Record<string, unknown>)["user_ids"], [
                alice.userId,
            ]);

            // Alice reads Bob's reply: body stripped of the fallback, quote
            // enriched from her own target (post-window, post-edit values).
            aliceClient = createClient({ baseUrl: BASE });
            await aliceClient.loginWithPassword(alice.userId, "testtesttest");
            feedA = new TimelineFeed(aliceClient);
            await aliceClient.startClient({ initialSyncLimit: 10 });
            const timelineA = feedA.timeline(room);
            await waitFor("alice to see bob's reply", () =>
                timelineA.get().some((m) => m.id === own.id),
            );
            const foreign = timelineA.get().find((m) => m.id === own.id);
            assert.equal(foreign?.body, "the reply");
            assert.equal(foreign?.reply?.eventId, targetId);
            // Bob's reply quotes ALICE's message, so the quote enriches to her.
            assert.equal(foreign?.reply?.senderId, alice.userId);
            assert.equal(foreign?.reply?.body, "original line\nsecond line");

            // A reply from a client we don't control (hand-rolled PUT with a
            // fallback we never built): still strips and enriches.
            await api(
                "PUT",
                `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/txn-q2-${suffix}`,
                alice.token,
                {
                    msgtype: "m.text",
                    body: `> <${bob.userId}> the reply\n\nraw client reply`,
                    "m.relates_to": { "m.in_reply_to": { event_id: own.id } },
                },
            );
            await waitFor("bob to see the raw client's reply", () =>
                timelineB
                    .get()
                    .some(
                        (m) =>
                            m.body === "raw client reply" &&
                            m.reply?.eventId === own.id &&
                            m.reply.body === "the reply" &&
                            m.reply.senderId === bob.userId,
                    ),
            );
            // The raw reply never leaks its fallback into the rendered body.
            assert.ok(timelineB.get().every((m) => !m.body.startsWith("> <")));
        } finally {
            feedB.detachAll();
            await bobClient.stopClient();
            feedA?.detachAll();
            await aliceClient?.stopClient();
        }
    });
});
