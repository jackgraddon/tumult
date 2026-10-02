import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient, Room, Thread } from "matrix-js-sdk";

import { ThreadTracker } from "../src/threads/tracker.ts";

function thread(id: string, roomId: string, length: number, lastTs: number): Thread {
    return {
        id,
        roomId,
        length,
        liveTimeline: {
            getEvents: () => Array.from({ length }, (_, i) => ({ getTs: () => lastTs - (length - i) * 1000 })),
        },
        replyToEvent: { getTs: () => lastTs - length * 1000 },
        hasCurrentUserParticipated: false,
    } as unknown as Thread;
}

function room(roomId: string, threads: Thread[]): Room {
    const byId = new Map(threads.map((t) => [t.id, t]));
    return {
        roomId,
        getThreads: () => threads,
        getThread: (id: string) => byId.get(id) ?? null,
        getThreadUnreadNotificationCount: () => 0,
    } as unknown as Room;
}

function stubMatrix(rooms: Room[], selfId = "@me:localhost"): MatrixClient {
    const listeners = new Map<string, Set<() => void>>();
    const byId = new Map(rooms.map((r) => [r.roomId, r]));
    return {
        getUserId: () => selfId,
        getRooms: () => rooms,
        getRoom: (id: string) => byId.get(id) ?? null,
        sendMessage: async () => ({ event_id: "$sent:x" }),
        sendReadReceipt: async () => ({}),
        on: (event: string, fn: () => void) => {
            const set = listeners.get(event) ?? new Set();
            set.add(fn);
            listeners.set(event, set);
        },
        removeListener: (event: string, fn: () => void) => {
            listeners.get(event)?.delete(fn);
        },
        emit: (event: string) => {
            for (const fn of listeners.get(event) ?? []) fn();
        },
    } as unknown as MatrixClient;
}

describe("ThreadTracker", () => {
    it("collects thread summaries per room", () => {
        const matrix = stubMatrix([
            room("!a", [thread("$t1", "!a", 3, 5000), thread("$t2", "!a", 1, 3000)]),
            room("!b", []),
        ]);
        const tracker = new ThreadTracker(matrix);
        const summaries = tracker.threads("!a").get();
        assert.equal(summaries.length, 2);
        assert.equal(summaries[0]?.rootEventId, "$t1");
        assert.equal(summaries[0]?.replyCount, 2);
        assert.equal(summaries[1]?.rootEventId, "$t2");
        assert.equal(summaries[1]?.replyCount, 0);
    });

    it("returns the same observable per roomId", () => {
        const tracker = new ThreadTracker(stubMatrix([]));
        assert.equal(tracker.threads("!a"), tracker.threads("!a"));
    });

    it("rebuilds on thread events", () => {
        const t1 = thread("$t1", "!a", 1, 1000);
        const matrix = stubMatrix([room("!a", [t1])]);
        const tracker = new ThreadTracker(matrix);
        assert.equal(tracker.threads("!a").get().length, 1);
        // Simulate a new reply arriving.
        t1.length = 3;
        matrix.emit("ThreadEvent.Update");
        assert.equal(tracker.threads("!a").get()[0]?.replyCount, 2);
    });

    it("sendReply routes through the thread's room", async () => {
        const calls: unknown[][] = [];
        const t1 = thread("$t1", "!a", 1, 1000);
        const matrix = {
            ...stubMatrix([room("!a", [t1])]),
            sendMessage: async (...args: unknown[]) => {
                calls.push(args);
                return { event_id: "$sent:x" };
            },
        } as unknown as MatrixClient;
        const tracker = new ThreadTracker(matrix);
        await tracker.sendReply("!a", "$t1", "hello");
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.[0], "!a");
        assert.equal(calls[0]?.[1], "$t1");
    });

    it("detachAll removes listeners", () => {
        const matrix = stubMatrix([]);
        const tracker = new ThreadTracker(matrix);
        tracker.detachAll();
        matrix.emit("ThreadEvent.Update");
        matrix.emit("sync");
        assert.deepEqual(tracker.threads("!a").get(), []);
    });
});
