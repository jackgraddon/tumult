import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { TimelineFeed } from "../src/timeline/feed.ts";
import { sendTextMessage } from "../src/rooms/send.ts";
import { toggleReaction } from "../src/rooms/reactions.ts";
import { snapshotRooms } from "../src/rooms/snapshot.ts";
import { TypingTracker } from "../src/typing/tracker.ts";
import { ThreadTracker } from "../src/threads/tracker.ts";

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

describe("timeline against real Synapse", () => {
    it("reads live timelines per room and paginates history", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`talice-${suffix}`, "testtesttest");
        const bob = await register(`tbob-${suffix}`, "testtesttest");

        const roomA = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "timeline-a",
        }))["room_id"] as string;
        const roomB = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "timeline-b",
        }))["room_id"] as string;
        for (const roomId of [roomA, roomB]) {
            await api(
                "POST",
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
                alice.token,
                { user_id: bob.userId },
            );
            await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, bob.token, {});
        }

        // Burst into A before Bob's client starts with a small sync window.
        for (let i = 0; i < 25; i++) {
            await sendText(alice.token, roomA, `msg-${i}`, `txn-a-${suffix}-${i}`);
        }
        await sendText(alice.token, roomB, "only-in-b", `txn-b-${suffix}`);

        const bobClient: MatrixClient = createClient({ baseUrl: BASE });
        await bobClient.loginWithPassword(bob.userId, "testtesttest");
        const feed = new TimelineFeed(bobClient);
        await bobClient.startClient({ initialSyncLimit: 5 });
        try {
            const timelineA = feed.timeline(roomA);
            await waitFor("bob to see room A messages", () => timelineA.get().length >= 5);

            // Same Subscribable instance on repeat calls (contract guarantee).
            assert.ok(feed.timeline(roomA) === timelineA, "timeline() must cache per roomId");

            // Per-room isolation: B's feed never sees A's burst.
            const timelineB = feed.timeline(roomB);
            await waitFor("bob to see room B message", () => timelineB.get().length >= 1);
            assert.ok(
                timelineB.get().every((m) => !m.body.startsWith("msg-")),
                "room B feed must not contain room A messages",
            );
            assert.ok(timelineB.get().some((m) => m.body === "only-in-b"));

            // Live tail of A is ordered and well-formed.
            const tail = timelineA.get();
            for (const m of tail) {
                assert.equal(m.type, "m.room.message");
                assert.equal(m.senderId, alice.userId);
                assert.equal(m.status, "sent");
                assert.equal(m.decryption, "ok");
            }
            const bodies = tail.map((m) => m.body);
            const sorted = [...bodies].sort();
            assert.deepEqual(bodies, sorted, "timeline must arrive in order");

            // Paginate back to the start of the burst.
            let more = true;
            for (let i = 0; i < 10 && more && timelineA.get().length < 25; i++) {
                more = await feed.loadMore(roomA);
            }
            const full = timelineA.get();
            assert.equal(full.length, 25);
            assert.equal(full[0]?.body, "msg-0");
            assert.equal(full[24]?.body, "msg-24");
        } finally {
            feed.detachAll();
            await bobClient.stopClient();
        }
    });

    it("shows sending then sent for own messages", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`salice-${suffix}`, "testtesttest");
        const bob = await register(`sbob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "send-roundtrip",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});

        // Chronological ordering puts the local echo in the live timeline.
        // (This is the SDK default; stated explicitly to lock the assumption
        // the app client relies on.)
        const bobClient: MatrixClient = createClient({
            baseUrl: BASE,
            pendingEventOrdering: "chronological",
        });
        await bobClient.loginWithPassword(bob.userId, "testtesttest");
        const feed = new TimelineFeed(bobClient);
        await bobClient.startClient({ initialSyncLimit: 5 });
        try {
            const timeline = feed.timeline(room);
            await waitFor("room to enter the store", () => bobClient.getRoom(room) != null);

            // Hold the send PUT mid-flight so the local echo is observable
            // deterministically instead of racing the localhost round trip.
            let releaseSend: (() => void) | null = null;
            const gate = new Promise<void>((resolve) => {
                releaseSend = resolve;
            });
            const realFetch = globalThis.fetch;
            globalThis.fetch = ((input: unknown, init?: unknown) => {
                if (String(input).includes("/send/") && releaseSend) return gate.then(() => realFetch(input as never, init as never));
                return realFetch(input as never, init as never);
            }) as typeof fetch;
            try {
                const pending = sendTextMessage(bobClient, room, "gated hello");
                await waitFor("local echo to read sending", () =>
                    timeline.get().some((m) => m.body === "gated hello" && m.status === "sending"),
                );
                releaseSend?.();
                releaseSend = null;
                await pending;
                await waitFor("echo to settle as sent", () =>
                    timeline.get().some((m) => m.body === "gated hello" && m.status === "sent"),
                );
            } finally {
                releaseSend?.();
                globalThis.fetch = realFetch;
            }
        } finally {
            feed.detachAll();
            await bobClient.stopClient();
        }
    });

    it("aggregates reactions and toggles them off", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`ralice-${suffix}`, "testtesttest");
        const bob = await register(`rbob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "reactions",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});
        await sendText(alice.token, room, "react to this", `txn-r-${suffix}`);

        const bobClient: MatrixClient = createClient({
            baseUrl: BASE,
            pendingEventOrdering: "chronological",
        });
        await bobClient.loginWithPassword(bob.userId, "testtesttest");
        const feed = new TimelineFeed(bobClient);
        await bobClient.startClient({ initialSyncLimit: 10 });
        try {
            const timeline = feed.timeline(room);
            await waitFor("bob to see the message", () => timeline.get().length >= 1);
            const targetId = timeline.get()[0]?.id;
            assert.ok(targetId);

            // React via the production helper: local echo aggregates instantly.
            await toggleReaction(bobClient, room, targetId, "👍");
            await waitFor("own reaction to aggregate", () =>
                timeline
                    .get()
                    .some((m) => m.id === targetId && m.reactions.some((r) => r.emoji === "👍" && r.count >= 1 && r.ownReacted)),
            );

            // A second sender's reaction folds into the same chip.
            await api(
                "PUT",
                `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.reaction/txn-ra-${suffix}`,
                alice.token,
                { "m.relates_to": { rel_type: "m.annotation", event_id: targetId, key: "👍" } },
            );
            await waitFor("both reactions to aggregate", () =>
                timeline
                    .get()
                    .some((m) => m.id === targetId && m.reactions.some((r) => r.emoji === "👍" && r.count === 2 && r.ownReacted)),
            );

            // Toggling again redacts our reaction; Alice's remains.
            await toggleReaction(bobClient, room, targetId, "👍");
            await waitFor("our reaction to disappear", () => {
                const found = timeline.get().find((m) => m.id === targetId);
                return found !== undefined && found.reactions.every((r) => !r.ownReacted);
            });
            const remaining = timeline.get().find((m) => m.id === targetId)?.reactions ?? [];
            assert.ok(remaining.some((r) => r.emoji === "👍" && r.count === 1 && !r.ownReacted));

            // Reaction annotations never render as message rows.
            assert.ok(timeline.get().every((m) => m.type !== "m.reaction"));
        } finally {
            feed.detachAll();
            await bobClient.stopClient();
        }
    });

    it("marks rooms read and shows readers to the other side", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`ealice-${suffix}`, "testtesttest");
        const bob = await register(`ebob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "receipts",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});
        await sendText(alice.token, room, "message one", `txn-e1-${suffix}`);
        await sendText(alice.token, room, "message two", `txn-e2-${suffix}`);

        const login = async (user: { userId: string }, password: string): Promise<MatrixClient> => {
            const client: MatrixClient = createClient({ baseUrl: BASE });
            await client.loginWithPassword(user.userId, password);
            await client.startClient({ initialSyncLimit: 10 });
            return client;
        };
        const aliceClient = await login(alice, "testtesttest");
        const bobClient = await login(bob, "testtesttest");
        const feedA = new TimelineFeed(aliceClient);
        const feedB = new TimelineFeed(bobClient);
        try {
            const timelineA = feedA.timeline(room);
            const timelineB = feedB.timeline(room);
            await waitFor("both sides to see the messages", () =>
                timelineA.get().length >= 2 && timelineB.get().length >= 1,
            );

            // Bob reads the tail: receipt sends, then Alice sees him on the
            // latest message while his own feed excludes himself.
            await feedB.markRead(room);
            await waitFor("alice to see bob as reader", () =>
                timelineA.get().some((m) => m.body === "message two" && m.readBy.includes(bob.userId)),
            );
            // Our own receipt shows on our own feed too.
            await waitFor("bob to see himself as reader", () =>
                timelineB.get().some((m) => m.body === "message two" && m.readBy.includes(bob.userId)),
            );

            // Reading clears Bob's unread badge on the next sync.
            await waitFor("bob's unread to clear", () => {
                const summary = snapshotRooms(bobClient).find((r) => r.id === room);
                return summary !== undefined && summary.unreadCount === 0;
            });
        } finally {
            feedA.detachAll();
            feedB.detachAll();
            await aliceClient.stopClient();
            await bobClient.stopClient();
        }
    });

    it("applies edits with an edited flag, latest wins", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`malice-${suffix}`, "testtesttest");
        const bob = await register(`mbob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "edits",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});
        await sendText(alice.token, room, "original version", `txn-m-${suffix}`);

        const bobClient: MatrixClient = createClient({ baseUrl: BASE });
        await bobClient.loginWithPassword(bob.userId, "testtesttest");
        const feed = new TimelineFeed(bobClient);
        await bobClient.startClient({ initialSyncLimit: 10 });
        try {
            const timeline = feed.timeline(room);
            await waitFor("bob to see the message", () =>
                timeline.get().some((m) => m.body === "original version" && !m.edited),
            );
            const targetId = timeline.get().find((m) => m.body === "original version")?.id;
            assert.ok(targetId);

            const editVia = async (token: string, body: string, txn: string): Promise<void> => {
                await api(
                    "PUT",
                    `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${txn}`,
                    token,
                    {
                        msgtype: "m.text",
                        body: `* ${body}`,
                        "m.new_content": { msgtype: "m.text", body },
                        "m.relates_to": { rel_type: "m.replace", event_id: targetId },
                    },
                );
            };
            await editVia(alice.token, "first revision", `txn-e1-${suffix}`);
            await waitFor("first edit to apply", () =>
                timeline.get().some((m) => m.id === targetId && m.body === "first revision" && m.edited),
            );

            // Second edit wins; someone else's edit is ignored.
            await editVia(alice.token, "second revision", `txn-e2-${suffix}`);
            await editVia(bob.token, "hijacked", `txn-e3-${suffix}`);
            await waitFor("second edit to win", () =>
                timeline.get().some((m) => m.id === targetId && m.body === "second revision" && m.edited),
            );
            await new Promise((r) => setTimeout(r, 3000));
            assert.equal(
                timeline.get().find((m) => m.id === targetId)?.body,
                "second revision",
            );

            // Edit events never render as message rows.
            assert.ok(
                timeline.get().every((m) => m.type !== "m.room.message" || !("m.new_content" in m.content)),
            );
        } finally {
            feed.detachAll();
            await bobClient.stopClient();
        }
    });

    it("tombstones redacted messages without redaction rows", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`dalice-${suffix}`, "testtesttest");
        const bob = await register(`dbob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "redactions",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});
        await sendText(alice.token, room, "doomed message", `txn-d-${suffix}`);

        const bobClient: MatrixClient = createClient({
            baseUrl: BASE,
            pendingEventOrdering: "chronological",
        });
        await bobClient.loginWithPassword(bob.userId, "testtesttest");
        const feed = new TimelineFeed(bobClient);
        await bobClient.startClient({ initialSyncLimit: 10 });
        try {
            const timeline = feed.timeline(room);
            await waitFor("bob to see the message", () =>
                timeline.get().some((m) => m.body === "doomed message"),
            );
            const targetId = timeline.get().find((m) => m.body === "doomed message")?.id;
            assert.ok(targetId);

            await api(
                "POST",
                // No txn segment: this Synapse answers 405 to .../redact/{event}/{txn}.
                `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/redact/${encodeURIComponent(targetId)}`,
                alice.token,
                {},
            );
            await waitFor("redaction to land as a tombstone", () =>
                timeline.get().some((m) => m.id === targetId && m.body === "Message deleted."),
            );
            assert.ok(timeline.get().every((m) => m.type !== "m.room.redaction"));
        } finally {
            feed.detachAll();
            await bobClient.stopClient();
        }
    });

    it("shows typing to the other side and clears on send", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`talice-${suffix}`, "testtesttest");
        const bob = await register(`tbob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "typing",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});

        const login = async (user: { userId: string }): Promise<MatrixClient> => {
            const client: MatrixClient = createClient({ baseUrl: BASE });
            await client.loginWithPassword(user.userId, "testtesttest");
            await client.startClient({ initialSyncLimit: 10 });
            return client;
        };
        const aliceClient = await login(alice);
        const bobClient = await login(bob);
        const feedA = new TimelineFeed(aliceClient);
        const typingA = new TypingTracker(aliceClient);
        const typingB = new TypingTracker(bobClient);
        try {
            feedA.timeline(room);
            await waitFor("alice to see the room", () => aliceClient.getRoom(room) != null);

            // Bob types: Alice sees him.
            await typingB.sendTyping(room, true);
            await waitFor("alice to see bob typing", () =>
                (typingA.snapshot.rooms[room] ?? []).includes(bob.userId),
            );

            // Bob sends: typing clears.
            await sendTextMessage(bobClient, room, "hello there");
            await waitFor("bob's typing to clear", () =>
                !(typingA.snapshot.rooms[room] ?? []).includes(bob.userId),
            );

            // Alice types: Bob sees her.
            await typingA.sendTyping(room, true);
            await waitFor("bob to see alice typing", () =>
                (typingB.snapshot.rooms[room] ?? []).includes(alice.userId),
            );
        } finally {
            feedA.detachAll();
            typingA.detachAll();
            typingB.detachAll();
            await aliceClient.stopClient();
            await bobClient.stopClient();
        }
    });

    it("threads: reply count, timeline and read", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`ualice-${suffix}`, "testtesttest");
        const bob = await register(`ubob-${suffix}`, "testtesttest");

        const room = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
            name: "threads",
        }))["room_id"] as string;
        await api(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/invite`,
            alice.token,
            { user_id: bob.userId },
        );
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(room)}`, bob.token, {});
        await sendText(alice.token, room, "thread root", `txn-u-${suffix}`);

        const login = async (user: { userId: string }): Promise<MatrixClient> => {
            const client: MatrixClient = createClient({ baseUrl: BASE });
            await client.loginWithPassword(user.userId, "testtesttest");
            // threadSupport is a START option; on createClient it's ignored.
            await client.startClient({ initialSyncLimit: 10, threadSupport: true });
            return client;
        };
        const aliceClient = await login(alice);
        const bobClient = await login(bob);
        const feedA = new TimelineFeed(aliceClient);
        const threadsA = new ThreadTracker(aliceClient);
        const threadsB = new ThreadTracker(bobClient);
        try {
            const timelineA = feedA.timeline(room);
            await waitFor("alice to see the root", () =>
                timelineA.get().some((m) => m.body === "thread root"),
            );
            const rootId = timelineA.get().find((m) => m.body === "thread root")?.id;
            assert.ok(rootId);

            // Bob replies in the thread.
            await threadsB.sendReply(room, rootId, "first reply");
            await waitFor("alice to see the thread", () =>
                threadsA.threads(room).get().some((t) => t.rootEventId === rootId && t.replyCount > 0),
            );
            // Exact: thread.length excludes the root, so one reply is 1, not 0.
            const once = threadsA.threads(room).get().find((t) => t.rootEventId === rootId);
            assert.equal(once?.replyCount, 1);
            // Server semantics: authoring the ROOT counts as participating.
            assert.equal(once?.hasParticipated, true);

            await threadsB.sendReply(room, rootId, "second reply");
            await waitFor("reply count to reach 2", () =>
                threadsA.threads(room).get().find((t) => t.rootEventId === rootId)?.replyCount === 2,
            );
            await waitFor("bob to have participated", () =>
                threadsB.threads(room).get().find((t) => t.rootEventId === rootId)?.hasParticipated === true,
            );

            // Alice sees the reply in the thread timeline.
            const threadTimeline = threadsA.threadTimeline(rootId);
            await waitFor("thread timeline to show the reply", () =>
                threadTimeline.get().some((m) => m.body === "first reply"),
            );

            // Bob's replies are unread for Alice until she reads the thread.
            await waitFor("thread unread to rise", () =>
                (threadsA.threads(room).get().find((t) => t.rootEventId === rootId)?.unreadCount ?? 0) > 0,
            );
            // Root first, then replies — the tracker prepends the root when the SDK hasn't.
            assert.equal(threadTimeline.get()[0]?.id, rootId);

            await threadsA.markThreadRead(rootId);
            await waitFor("thread unread to clear", () =>
                (threadsA.threads(room).get().find((t) => t.rootEventId === rootId)?.unreadCount ?? 1) === 0,
            );
        } finally {
            feedA.detachAll();
            threadsA.detachAll();
            threadsB.detachAll();
            await aliceClient.stopClient();
            await bobClient.stopClient();
        }
    });
});
