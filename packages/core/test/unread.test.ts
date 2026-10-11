import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient, Room } from "matrix-js-sdk";

import { UnreadTracker, type UnreadCounts } from "../src/rooms/unread.ts";

const SELF = "@me:x";
const PAGE = 100; // mirror of the tracker's BACKFILL_PAGE_SIZE

interface StubEvent {
    getId(): string;
    getType(): string;
    getSender(): string | undefined;
}

function ev(id: string, type = "m.room.message", sender = "@alice:x"): StubEvent {
    return { getId: () => id, getType: () => type, getSender: () => sender };
}

/** History array behind each room's loaded window, keyed by live timeline. */
const mirrors = new Map<unknown, StubEvent[]>();

interface StubRoomOpts {
    roomId: string;
    /** Loaded timeline events, oldest-first. */
    events: StubEvent[];
    /** Older events behind the window, oldest-first; served by backfill. */
    history?: StubEvent[];
    fullyRead?: string;
    receipt?: string | null;
    /** Private read receipt (`m.read.private`), returned for that type only. */
    privateReceipt?: string | null;
}

function stubRoom(o: StubRoomOpts): Room {
    const events = [...o.events];
    const history = o.history ? [...o.history] : [];
    const live = { getEvents: () => events };
    mirrors.set(live, history);
    return {
        roomId: o.roomId,
        getMyMembership: () => "join",
        getLiveTimeline: () => live,
        getAccountData: (type: string) =>
            type === "m.fully_read" && o.fullyRead
                ? { getContent: () => ({ event_id: o.fullyRead }) }
                : undefined,
        getReadReceiptForUserId: (_userId: string, _ignore: boolean, type?: string) => {
            const id = type === "m.read.private" ? o.privateReceipt : o.receipt;
            return id ? { eventId: id, data: null } : null;
        },
    } as unknown as Room;
}

/**
 * Fake matrix: `paginateEventTimeline` serves each room's `history` in
 * PAGE-sized ascending pages, spliced into the window prefix so chronology
 * stays correct. Counts calls per room so tests can assert a backfill runs
 * (exactly) once. Pass `pageFails` to make pagination reject.
 */
function stubClient(rooms: Room[], pageFails = false): MatrixClient & { paginateCalls: Map<string, number> } {
    const paginateCalls = new Map<string, number>();
    const served = new Map<unknown, number>();
    const matrix = {
        getUserId: () => SELF,
        getRooms: () => rooms,
        getRoom: (roomId: string) => rooms.find((r) => r.roomId === roomId) ?? null,
        async paginateEventTimeline(timeline: unknown) {
            if (pageFails) throw new Error("network down");
            const room = rooms.find((r) => r.getLiveTimeline() === timeline);
            const history = mirrors.get(timeline);
            if (!room || !history) return false;
            paginateCalls.set(room.roomId, (paginateCalls.get(room.roomId) ?? 0) + 1);
            const from = served.get(timeline) ?? 0;
            const batch = history.slice(from, from + PAGE);
            served.set(timeline, from + batch.length);
            const events = room.getLiveTimeline().getEvents() as unknown as StubEvent[];
            events.splice(from, 0, ...batch);
            return served.get(timeline)! < history.length;
        },
    };
    return Object.assign(matrix, { paginateCalls }) as unknown as MatrixClient & {
        paginateCalls: Map<string, number>;
    };
}

function makeTracker(client: MatrixClient, published: Array<Record<string, UnreadCounts>>): UnreadTracker {
    let tracker!: UnreadTracker;
    tracker = new UnreadTracker(client, () => {
        const snapshot: Record<string, UnreadCounts> = {};
        for (const room of client.getRooms()) snapshot[room.roomId] = tracker.getUnread(room.roomId);
        published.push(snapshot);
    });
    return tracker;
}

describe("UnreadTracker", () => {
    it("counts unread message events after the m.fully_read marker", () => {
        const room = stubRoom({
            roomId: "!a:x",
            events: [ev("$t1"), ev("$t2"), ev("$t3", "m.room.message", SELF), ev("$t4", "m.room.member"), ev("$t5")],
            fullyRead: "$t2",
        });
        const published: Array<Record<string, UnreadCounts>> = [];
        const tracker = makeTracker(stubClient([room]), published);
        tracker.update();
        // Only $t5 counts: $t3 is self, $t4 is not a message type.
        assert.equal(tracker.getUnread("!a:x").total, 1);
        assert.equal(published[0]?.["!a:x"].total, 1);
        assert.equal(published[0]?.["!a:x"].highlight, 0);
    });

    it("uses the read receipt when m.fully_read is absent (old/read rooms)", () => {
        // Read through a client that never wrote m.fully_read: only the
        // receipt marks the position. Before the fix this room counted the
        // whole loaded window as unread.
        const room = stubRoom({
            roomId: "!a:x",
            events: [ev("$t1"), ev("$t2"), ev("$t3", "m.room.message", SELF), ev("$t5")],
            receipt: "$t2",
        });
        const tracker = makeTracker(stubClient([room]), []);
        tracker.update();
        assert.equal(tracker.getUnread("!a:x").total, 1); // $t5
    });

    it("uses a private read receipt when the public one is absent", () => {
        // `m.read.private` (a common privacy setting) leaves no public receipt;
        // the server's own count honours it, so we must too.
        const room = stubRoom({
            roomId: "!a:x",
            events: [ev("$t1"), ev("$t2"), ev("$t3", "m.room.message", SELF), ev("$t5")],
            privateReceipt: "$t2",
        });
        const tracker = makeTracker(stubClient([room]), []);
        tracker.update();
        assert.equal(tracker.getUnread("!a:x").total, 1); // $t5
    });

    it("takes the later of marker and receipt when both exist", () => {
        const room = stubRoom({
            roomId: "!a:x",
            events: [ev("$t1"), ev("$t2"), ev("$t3"), ev("$t5")],
            fullyRead: "$t1",
            receipt: "$t3",
        });
        const tracker = makeTracker(stubClient([room]), []);
        tracker.update();
        assert.equal(tracker.getUnread("!a:x").total, 1); // $t5 only
    });

    it("counts the whole window for rooms never read (no marker, no receipt)", () => {
        const room = stubRoom({
            roomId: "!a:x",
            events: [ev("$t1"), ev("$t2"), ev("$t3")],
        });
        const matrix = stubClient([room]);
        const tracker = makeTracker(matrix, []);
        tracker.update();
        assert.equal(tracker.getUnread("!a:x").total, 3);
        assert.equal(matrix.paginateCalls.get("!a:x") ?? 0, 0, "nothing to backfill to");
    });

    it("backfills once when the read position predates the window, then counts exactly", async () => {
        const room = stubRoom({
            roomId: "!a:x",
            events: [ev("$t10"), ev("$t11")],
            history: [ev("$t1"), ev("$t2")],
            receipt: "$t2",
        });
        const matrix = stubClient([room]);
        const tracker = makeTracker(matrix, []);
        tracker.update();
        await new Promise((r) => setTimeout(r, 10)); // backfill is async
        assert.equal(tracker.getUnread("!a:x").total, 2, "$t10 and $t11 are the unread tail");
        assert.equal(matrix.paginateCalls.get("!a:x"), 1);
        // A second update does not re-paginate (position unchanged).
        tracker.update();
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(matrix.paginateCalls.get("!a:x"), 1);
    });

    it("a failing backfill keeps the lower bound and never rejects", async () => {
        const room = stubRoom({
            roomId: "!a:x",
            events: [ev("$t10")],
            history: [ev("$t1"), ev("$t2")],
            receipt: "$t2",
        });
        const matrix = stubClient([room], true);
        const tracker = makeTracker(matrix, []);
        tracker.update();
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(tracker.getUnread("!a:x").total, 1, "window lower bound survives the failed page");
    });

    it("re-arms the backfill when the read position moves", async () => {
        const history = Array.from({ length: 200 }, (_, i) => ev(`$h${i}`));
        const room = stubRoom({
            roomId: "!a:x",
            events: [ev("$t10")],
            history,
            receipt: "$h0",
        });
        const matrix = stubClient([room]);
        const tracker = makeTracker(matrix, []);
        tracker.update();
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(matrix.paginateCalls.get("!a:x"), 1, "first backfill pulls the $h0 page");

        // The receipt moves beyond the first page: a new key re-arms it.
        const mutable = room as unknown as { getReadReceiptForUserId(): unknown };
        mutable.getReadReceiptForUserId = () => ({ eventId: "$h150", data: null });
        tracker.update();
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(matrix.paginateCalls.get("!a:x"), 2, "second backfill pulls the $h150 page");
        // Reading up to $h150 leaves $h151..$h199 (49) plus $t10 unread.
        assert.equal(tracker.getUnread("!a:x").total, 50);
    });

    it("skips rooms the user is not joined to", () => {
        const room = stubRoom({ roomId: "!a:x", events: [ev("$t1")] });
        const matrix = stubClient([room]);
        const mutable = room as unknown as { getMyMembership(): string };
        mutable.getMyMembership = () => "leave";
        const tracker = makeTracker(matrix, []);
        tracker.update();
        assert.equal(tracker.getUnread("!a:x").total, 0);
    });

    it("a throwing room does not freeze the rooms after it", () => {
        // Regression: `update()` used to abort on the first room that threw,
        // leaving every later room on a stale count until the thrower left.
        const bad = stubRoom({ roomId: "!bad:x", events: [] });
        (bad as unknown as { getLiveTimeline(): never }).getLiveTimeline = () => {
            throw new Error("boom");
        };
        const good = stubRoom({ roomId: "!good:x", events: [ev("$t1"), ev("$t2")] });
        const tracker = makeTracker(stubClient([bad, good]), []);
        tracker.update();
        assert.equal(tracker.getUnread("!good:x").total, 2, "the healthy room still counted");
    });

    it("collapses re-entrant updates instead of rescanning every room per change", () => {
        // `onCounts` is refreshRooms, which calls `update()` again — and a
        // recompute that changes a count calls `onCounts`. Without the guard,
        // N simultaneous changes re-scan the whole list N times (O(n²) and one
        // stack frame per change). With it, the callback's update is a no-op.
        let visits = 0;
        const rooms = Array.from({ length: 20 }, (_, i) => {
            const room = stubRoom({ roomId: `!r${i}:x`, events: [ev("$t1")] });
            const inner = room.getMyMembership;
            (room as unknown as { getMyMembership(): string }).getMyMembership = () => {
                visits++;
                return inner();
            };
            return room;
        });
        let tracker!: UnreadTracker;
        tracker = new UnreadTracker(stubClient(rooms), () => tracker.update());
        tracker.update();
        assert.equal(visits, 20, "each room visited exactly once; the re-entrant call bailed early");
        assert.equal(tracker.getUnread("!r0:x").total, 1);
        assert.equal(tracker.getUnread("!r19:x").total, 1);
    });
});