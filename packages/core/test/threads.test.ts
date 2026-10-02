import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FeatureSupport, Thread, ThreadEvent, type MatrixClient, type Room } from "matrix-js-sdk";

import { ThreadTracker, summarise } from "../src/threads/tracker.ts";

type Listener = (...args: unknown[]) => void;

/** Minimal emitter so stubs dispatch by the SDK's real event VALUES. */
function emitter() {
    const listeners = new Map<string, Set<Listener>>();
    return {
        on: (event: string, fn: Listener) => {
            const set = listeners.get(event) ?? new Set();
            set.add(fn);
            listeners.set(event, set);
        },
        removeListener: (event: string, fn: Listener) => {
            listeners.get(event)?.delete(fn);
        },
        emit: (event: string, ...args: unknown[]) => {
            for (const fn of listeners.get(event) ?? []) fn(...args);
        },
        count: (event: string) => listeners.get(event)?.size ?? 0,
    };
}

function ev(id: string, ts: number) {
    return {
        getId: () => id,
        getTs: () => ts,
        getStateKey: () => undefined,
        getType: () => "m.room.message",
        getSender: () => "@a:x",
        getContent: () => ({ msgtype: "m.text", body: id }),
        isEncrypted: () => false,
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        status: null,
        clearEvent: undefined,
    };
}

/** `length` is replies only — the root is not counted (matches SDK v43). */
function thread(id: string, roomId: string, replies: number, lastTs: number): Thread {
    const events = [ev(id, lastTs - 10_000), ...Array.from({ length: replies }, (_, i) => ev(`${id}:r${i}`, lastTs - (replies - 1 - i) * 1000))];
    return {
        id,
        roomId,
        length: replies,
        rootEvent: events[0],
        liveTimeline: { getEvents: () => events },
        replyToEvent: events[events.length - 1],
        hasCurrentUserParticipated: false,
    } as unknown as Thread;
}

function room(roomId: string, threads: Thread[]) {
    const bus = emitter();
    const byId = new Map(threads.map((t) => [t.id, t]));
    const stub = {
        ...bus,
        roomId,
        threads,
        getThreads: () => stub.threads,
        getThread: (id: string) => byId.get(id) ?? null,
        findEventById: () => undefined,
        getThreadUnreadNotificationCount: (id: string) => (id === "$unread" ? 4 : 0),
    };
    return stub;
}

function stubMatrix(rooms: ReturnType<typeof room>[]) {
    const bus = emitter();
    const byId = new Map(rooms.map((r) => [r.roomId, r]));
    return {
        ...bus,
        getUserId: () => "@me:localhost",
        getRooms: () => rooms,
        getRoom: (id: string) => byId.get(id) ?? null,
        sendMessage: async () => ({ event_id: "$sent:x" }),
        sendReadReceipt: async () => ({}),
    };
}

const asClient = (m: unknown) => m as MatrixClient;

describe("ThreadTracker", () => {
    it("counts replies from thread.length without dropping one for the root", () => {
        const r = room("!a", []);
        const summary = summarise(r as unknown as Room, thread("$t1", "!a", 1, 5000));
        assert.equal(summary.replyCount, 1);
        assert.equal(summarise(r as unknown as Room, thread("$unread", "!a", 2, 1)).unreadCount, 4);
    });

    it("collects thread summaries per room, newest activity first", () => {
        const matrix = stubMatrix([room("!a", [thread("$old", "!a", 1, 3000), thread("$new", "!a", 3, 9000)])]);
        const summaries = new ThreadTracker(asClient(matrix)).threads("!a").get();
        assert.deepEqual(
            summaries.map((s) => [s.rootEventId, s.replyCount]),
            [
                ["$new", 3],
                ["$old", 1],
            ],
        );
    });

    it("returns the same observable per roomId", () => {
        const tracker = new ThreadTracker(asClient(stubMatrix([])));
        assert.equal(tracker.threads("!a"), tracker.threads("!a"));
    });

    it("rebuilds on the ROOM's thread events, using the real event names", () => {
        const t1 = thread("$t1", "!a", 1, 1000);
        const r = room("!a", [t1]);
        const tracker = new ThreadTracker(asClient(stubMatrix([r])));
        const list = tracker.threads("!a");
        assert.equal(list.get()[0]?.replyCount, 1);

        (t1 as { length: number }).length = 2;
        // The value is "Thread.newReply", not "ThreadEvent.NewReply".
        assert.equal(ThreadEvent.NewReply, "Thread.newReply");
        r.emit(ThreadEvent.NewReply, t1);
        assert.equal(list.get()[0]?.replyCount, 2);

        // Brand-new threads arrive as ThreadEvent.New.
        r.threads = [...r.threads, thread("$t2", "!a", 1, 2000)];
        r.emit(ThreadEvent.New, r.threads[1]);
        assert.equal(list.get().length, 2);
    });

    it("does not listen on the client for thread events (the client never emits them)", () => {
        const r = room("!a", []);
        const matrix = stubMatrix([r]);
        new ThreadTracker(asClient(matrix)).threads("!a");
        assert.equal(matrix.count(ThreadEvent.Update), 0);
        assert.ok(r.count(ThreadEvent.Update) > 0);
    });

    it("attaches to a room that only appears after the first threads() call", () => {
        const rooms: ReturnType<typeof room>[] = [];
        const matrix = stubMatrix(rooms);
        const late = room("!late", [thread("$t", "!late", 1, 1000)]);
        const m2 = { ...matrix, getRoom: (id: string) => (id === "!late" && rooms.length ? late : null) };
        const tracker = new ThreadTracker(asClient(m2));
        const list = tracker.threads("!late");
        assert.equal(list.get().length, 0);
        rooms.push(late);
        m2.emit("sync");
        assert.equal(list.get().length, 1);
        assert.ok(late.count(ThreadEvent.Update) > 0);
    });

    it("thread timeline includes the root once, first", () => {
        const tracker = new ThreadTracker(asClient(stubMatrix([room("!a", [thread("$t1", "!a", 2, 5000)])])));
        const ids = tracker.threadTimeline("$t1").get().map((m) => m.id);
        assert.deepEqual(ids, ["$t1", "$t1:r0", "$t1:r1"]);
    });

    it("sendReply routes through the thread's room", async () => {
        const calls: unknown[][] = [];
        const matrix = {
            ...stubMatrix([room("!a", [])]),
            sendMessage: async (...args: unknown[]) => {
                calls.push(args);
                return { event_id: "$sent:x" };
            },
        };
        await new ThreadTracker(asClient(matrix)).sendReply("!a", "$t1", "hello");
        assert.deepEqual(calls[0]?.slice(0, 2), ["!a", "$t1"]);
    });

    it("supported() follows the SDK's server capability probe", () => {
        const tracker = new ThreadTracker(asClient(stubMatrix([])));
        const saved = Thread.hasServerSideSupport;
        try {
            Thread.hasServerSideSupport = FeatureSupport.None;
            assert.equal(tracker.supported(), false);
            Thread.hasServerSideSupport = FeatureSupport.Stable;
            assert.equal(tracker.supported(), true);
        } finally {
            Thread.hasServerSideSupport = saved;
        }
    });

    it("detachAll removes room and client listeners", () => {
        const r = room("!a", []);
        const matrix = stubMatrix([r]);
        const tracker = new ThreadTracker(asClient(matrix));
        tracker.threads("!a");
        tracker.detachAll();
        assert.equal(r.count(ThreadEvent.Update), 0);
        assert.equal(matrix.count("sync"), 0);
    });
});
