import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MatrixEventEvent, RoomEvent, type MatrixClient, type Room } from "matrix-js-sdk";

import { Observable } from "../src/observable.ts";
import { onDecryptedRebuild, TimelineFeed } from "../src/timeline/feed.ts";
import type { MappableEvent } from "../src/timeline/map.ts";

type Listener = (...args: unknown[]) => void;

/** Minimal event emitter sharing the SDK's `on`/`removeListener`/`emit` shape. */
function emitter(): {
    on(ev: string, fn: Listener): void;
    removeListener(ev: string, fn: Listener): boolean;
    emit(ev: string, ...args: unknown[]): void;
    listenerCount(ev: string): number;
} {
    const listeners = new Map<string, Set<Listener>>();
    return {
        on(ev, fn) {
            let set = listeners.get(ev);
            if (!set) listeners.set(ev, (set = new Set()));
            set.add(fn);
        },
        removeListener(ev, fn) {
            return listeners.get(ev)?.delete(fn) ?? false;
        },
        emit(ev, ...args) {
            for (const fn of [...(listeners.get(ev) ?? [])]) fn(...args);
        },
        listenerCount(ev) {
            return listeners.get(ev)?.size ?? 0;
        },
    };
}

function mappable(over: Partial<MappableEvent> = {}): MappableEvent {
    return {
        getId: () => "$h:localhost",
        getType: () => "m.room.message",
        getSender: () => "@alice:localhost",
        getTs: () => 1700000000000,
        getContent: () => ({ msgtype: "m.text", body: "hi" }),
        isEncrypted: () => false,
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        status: null,
        clearEvent: {},
        getStateKey: () => null,
        getRelation: () => undefined,
        ...over,
    } as MappableEvent;
}

interface RoomStub {
    room: Room;
    /** Rebuilds are observable as `getLiveTimeline().getEvents()` calls. */
    reads: { count: number };
    emitter: ReturnType<typeof emitter>;
}

function stubRoom(roomId: string, events: MappableEvent[]): RoomStub {
    const e = emitter();
    const reads = { count: 0 };
    const room = {
        roomId,
        getLiveTimeline: () => ({
            getEvents: () => {
                reads.count++;
                return events;
            },
        }),
        getUsersReadUpTo: () => [],
        ...e,
    } as unknown as Room;
    return { room, reads, emitter: e };
}

function stubMatrix(rooms: RoomStub[]): { matrix: MatrixClient; emitter: ReturnType<typeof emitter> } {
    const e = emitter();
    const byId = new Map(rooms.map((r) => [(r.room as unknown as { roomId: string }).roomId, r.room]));
    const matrix = {
        getUserId: () => "@me:x",
        getRoom: (id: string) => byId.get(id) ?? null,
        ...e,
    } as unknown as MatrixClient;
    return { matrix, emitter: e };
}

const flush = (): Promise<void> => Promise.resolve();
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("TimelineFeed coalescing", () => {
    it("collapses a burst of room events into one rebuild per microtask", async () => {
        const r = stubRoom("!r:x", [mappable()]);
        const { matrix } = stubMatrix([r]);
        const feed = new TimelineFeed(matrix);
        try {
            feed.timeline("!r:x");
            const afterAttach = r.reads.count; // attach rebuilds once, synchronously
            r.emitter.emit(RoomEvent.Timeline);
            r.emitter.emit(RoomEvent.Timeline);
            r.emitter.emit(RoomEvent.Timeline);
            assert.equal(r.reads.count, afterAttach, "no synchronous rebuild per event");
            await flush();
            assert.equal(r.reads.count, afterAttach + 1, "three signals, one rebuild");
        } finally {
            feed.detachAll();
        }
    });

    it("keeps the initial snapshot synchronous on timeline()", () => {
        const r = stubRoom("!r:x", [mappable({ getId: () => "$one:x" })]);
        const { matrix } = stubMatrix([r]);
        const feed = new TimelineFeed(matrix);
        try {
            const obs = feed.timeline("!r:x");
            assert.equal(obs.get().length, 1, "the first read already has data");
        } finally {
            feed.detachAll();
        }
    });
});

describe("TimelineFeed idle eviction", () => {
    it("drops an unsubscribed feed after the grace period", async () => {
        const r = stubRoom("!r:x", [mappable()]);
        const { matrix } = stubMatrix([r]);
        const feed = new TimelineFeed(matrix, 5);
        try {
            const obs = feed.timeline("!r:x");
            const sub = obs.subscribe(() => undefined);
            assert.equal(feed.feedCount(), 1);
            sub.unsubscribe();
            await wait(20);
            assert.equal(feed.feedCount(), 0, "idle feed evicted");
            assert.equal(r.emitter.listenerCount(RoomEvent.Timeline), 0, "room listener detached");
        } finally {
            feed.detachAll();
        }
    });

    it("keeps the feed when a subscriber arrives before the grace elapses", async () => {
        const r = stubRoom("!r:x", [mappable()]);
        const { matrix } = stubMatrix([r]);
        const feed = new TimelineFeed(matrix, 30);
        try {
            const obs = feed.timeline("!r:x");
            obs.subscribe(() => undefined).unsubscribe();
            const second = obs.subscribe(() => undefined); // cancels the pending eviction
            await wait(40);
            assert.equal(feed.feedCount(), 1, "still alive");
            second.unsubscribe();
        } finally {
            feed.detachAll();
        }
    });

    it("rebuilds from the SDK timeline on resubscribe after eviction", async () => {
        const r = stubRoom("!r:x", [mappable()]);
        const { matrix } = stubMatrix([r]);
        const feed = new TimelineFeed(matrix, 5);
        try {
            const obs = feed.timeline("!r:x");
            obs.subscribe(() => undefined).unsubscribe();
            await wait(20);
            assert.equal(feed.feedCount(), 0, "idle feed evicted");

            const readsBefore = r.reads.count;
            const again = feed.timeline("!r:x");
            assert.equal(feed.feedCount(), 1, "recreated on revisit");
            assert.equal(r.reads.count, readsBefore + 1, "rebuilt from the SDK timeline");
            assert.equal(again.get().length, 1, "the fresh snapshot has data again");
            assert.equal(r.emitter.listenerCount(RoomEvent.Timeline), 1, "room listener re-attached");
        } finally {
            feed.detachAll();
        }
    });
});

describe("TimelineFeed decrypted scoping", () => {
    it("rebuilds only the event's room, not every feed", async () => {
        const a = stubRoom("!a:x", [mappable()]);
        const b = stubRoom("!b:x", [mappable()]);
        const { matrix } = stubMatrix([a, b]);
        const feed = new TimelineFeed(matrix);
        const detach = onDecryptedRebuild(matrix, feed);
        try {
            feed.timeline("!a:x");
            feed.timeline("!b:x");
            const aBefore = a.reads.count;
            const bBefore = b.reads.count;
            matrix.emit(MatrixEventEvent.Decrypted, { getRoomId: () => "!a:x" });
            await flush();
            assert.equal(a.reads.count, aBefore + 1, "the event's room rebuilt");
            assert.equal(b.reads.count, bBefore, "unrelated room untouched");
        } finally {
            detach();
            feed.detachAll();
        }
    });
});

describe("Observable subscription hooks", () => {
    it("fires first/last subscribe hooks exactly once per transition", () => {
        let firsts = 0;
        let lasts = 0;
        const obs = new Observable<number>(0, {
            onFirstSubscribe: () => {
                firsts++;
            },
            onLastUnsubscribe: () => {
                lasts++;
            },
        });
        const a = obs.subscribe(() => undefined);
        const b = obs.subscribe(() => undefined);
        assert.equal(firsts, 1, "second subscriber does not re-fire first");
        a.unsubscribe();
        assert.equal(lasts, 0, "still one subscriber");
        b.unsubscribe();
        assert.equal(lasts, 1);
        // A new cycle fires again.
        obs.subscribe(() => undefined);
        assert.equal(firsts, 2);
    });
});
