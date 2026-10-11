import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { ReceiptType } from "matrix-js-sdk/lib/@types/read_receipts.js";

import { BackfillQueue } from "./backfill-queue.ts";

/**
 * Client-side unread counts for Simplified Sliding Sync.
 *
 * Synapse hardcodes `notification_count=0, highlight_count=0` in its SSS
 * responses (a `TODO: these are just dummy values` in `sliding_sync/__init__.py`,
 * still present on `develop`) — the server never sends real counts over SSS.
 * Classic `/sync` computes them server-side, so this tracker exists only for
 * the sliding-sync mode; classic rooms keep using `room.getUnreadNotificationCount`.
 *
 * The count is message-like events from other users after the read position —
 * the later of the `m.fully_read` marker and the user's read receipt. The
 * receipt half is load-bearing: older clients and rooms read before
 * `m.fully_read` gained adoption only ever send a receipt, so a missing marker
 * must not turn the whole loaded window "unread" (the exact bug that made old,
 * read rooms light up). When the position predates the loaded timeline window
 * the count is a lower bound, so a one-time backfill paginates history back to
 * it (capped) to make it exact. The backfill reuses `paginateEventTimeline`,
 * so the scanned events join the room timeline — they are the unread messages,
 * and the render-side `TIMELINE_CAP` bounds what the feed shows.
 *
 * Highlights (mentions) are not computed: they need message-content parsing
 * the server normally does, so sliding-sync rooms report `highlight: 0`.
 */
export interface UnreadCounts {
    total: number;
    highlight: number;
}

/** Event types Synapse counts toward the unread total. */
const UNREAD_TYPES = new Set([
    "m.room.message",
    "m.room.encrypted",
    "m.sticker",
    "m.poll.start",
    "m.beacon_info",
    "m.call.invite",
]);

const READ_MARKER = "m.fully_read";
const BACKFILL_PAGES = 3;
const BACKFILL_PAGE_SIZE = 100;

function isUnreadType(event: MatrixEvent): boolean {
    return UNREAD_TYPES.has(event.getType());
}

/** Where the user last read this room, from every signal we have. */
interface ReadPositions {
    /** The `m.fully_read` account-data event id, or `null`. */
    markerId: string | null;
    /** Real (server-confirmed) read-receipt event ids: public and private. */
    receiptIds: string[];
}

function readPositions(room: Room, selfId: string | null): ReadPositions {
    let markerId: string | null = null;
    try {
        const eventId = room.getAccountData(READ_MARKER)?.getContent()?.["event_id"];
        markerId = typeof eventId === "string" && eventId.length > 0 ? eventId : null;
    } catch {
        markerId = null;
    }

    // `getEventReadUpTo` returns null when the receipt points at an event that
    // isn't loaded yet — but we still want the id so a backfill has something
    // to hunt for, so read the raw receipt. Both receipt types count: a user
    // with private read receipts (`m.read.private`, a common privacy setting)
    // has no public receipt at all, and the server's own count honours the
    // private one. Synthesized receipts (the SDK's implicit ones for events we
    // sent) are ignored: the server-confirmed receipt is the truth.
    const receiptIds: string[] = [];
    if (selfId) {
        for (const type of [ReceiptType.Read, ReceiptType.ReadPrivate]) {
            try {
                const id = room.getReadReceiptForUserId(selfId, true, type)?.eventId;
                if (id && !receiptIds.includes(id)) receiptIds.push(id);
            } catch {
                // A throwing accessor must not take down the whole snapshot.
            }
        }
    }
    return { markerId, receiptIds };
}

/** The newest read position that is actually loaded, or -1 when none is. */
function latestLoadedReadIndex(timeline: MatrixEvent[], read: ReadPositions): number {
    let index = -1;
    for (const id of [read.markerId, ...read.receiptIds]) {
        if (!id) continue;
        const found = timeline.findIndex((e) => e.getId() === id);
        if (found > index) index = found;
    }
    return index;
}

/** Re-arm key for the backfill: re-run when either read position moves. */
function readKey(read: ReadPositions): string {
    return `${read.markerId ?? ""}\u0000${read.receiptIds.join(",")}`;
}

export class UnreadTracker {
    private readonly matrix: MatrixClient;
    /** Called when a room's count changes, so the caller can re-snapshot. */
    private readonly onCounts: () => void;
    private readonly counts = new Map<string, UnreadCounts>();
    /**
     * Serialized, deduped backfills. A first sync with many out-of-window read
     * positions used to launch one concurrent pagination each — a burst of
     * hundreds of events in a single frame. The queue spreads them out.
     */
    private readonly backfills: BackfillQueue;
    /** Read position each room's backfill ran for — a moved position re-arms it. */
    private readonly backfilledRead = new Map<string, string>();
    /**
     * `recompute` calls `onCounts` (→ refreshRooms → update) as soon as a count
     * moves, so a burst of changes (receipts landing for the whole window)
     * would otherwise re-enter this loop once per room — O(n²) snapshots and
     * one stack frame per change. The guard collapses that: the in-flight pass
     * finishes, `onCounts` still republishes, and the caller's own final
     * snapshot follows.
     */
    private updating = false;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient, onCounts: () => void) {
        this.matrix = matrix;
        this.onCounts = onCounts;
        this.backfills = new BackfillQueue((roomId) => this.runBackfill(roomId));
    }

    /** Recompute every joined room's count. Called before `snapshotRooms`. */
    public update(): void {
        if (this.updating) return;
        this.updating = true;
        try {
            for (const room of this.matrix.getRooms()) {
                // One room's throwing accessor must not abandon every room
                // after it: that would freeze those badges on stale counts for
                // as long as the thrower stays in the list. Membership is read
                // inside the guard too — it is not guaranteed not to throw.
                try {
                    if (room.getMyMembership() !== "join") continue;
                    this.recompute(room);
                } catch (err) {
                    console.error("[tumult] unread recompute failed", room.roomId, err);
                }
            }
        } finally {
            this.updating = false;
        }
    }

    public getUnread(roomId: string): UnreadCounts {
        return this.counts.get(roomId) ?? { total: 0, highlight: 0 };
    }

    /**
     * Dev diagnostics: every input behind a room's count, so a wrong badge can
     * be explained instead of guessed at. Not part of the contract.
     */
    public describe(room: Room): UnreadCounts & {
        markerId: string | null;
        receiptIds: string[];
        readIndex: number;
        window: number;
        tailId: string | null;
    } {
        const read = readPositions(room, this.matrix.getUserId());
        const timeline = room.getLiveTimeline().getEvents();
        return {
            ...this.getUnread(room.roomId),
            markerId: read.markerId,
            receiptIds: read.receiptIds,
            readIndex: latestLoadedReadIndex(timeline, read),
            window: timeline.length,
            tailId: timeline[timeline.length - 1]?.getId() ?? null,
        };
    }

    private recompute(room: Room): void {
        const selfId = this.matrix.getUserId();
        const read = readPositions(room, selfId);
        const timeline = room.getLiveTimeline().getEvents();
        const readIndex = latestLoadedReadIndex(timeline, read);
        let count = 0;
        for (let i = readIndex + 1; i < timeline.length; i++) {
            const event = timeline[i];
            if (!event) continue;
            if (event.getSender() === selfId) continue;
            if (isUnreadType(event)) count++;
        }
        const prev = this.counts.get(room.roomId);
        if (prev?.total !== count) {
            this.counts.set(room.roomId, { total: count, highlight: 0 });
            this.onCounts();
        }
        // A read position that predates the loaded window leaves the count a
        // lower bound. Backfill once per position so the next recompute is
        // exact. A room with NO read position at all was never read — the
        // whole window is genuinely unread and there is nothing to page to.
        const key = readKey(read);
        const positionsKnown = read.markerId !== null || read.receiptIds.length > 0;
        if (
            positionsKnown &&
            readIndex < 0 &&
            this.backfilledRead.get(room.roomId) !== key &&
            !this.backfills.has(room.roomId)
        ) {
            this.backfills.enqueue(room.roomId);
        }
    }

    /** Drop queued backfills on client teardown. Running ones finish on their own. */
    public dispose(): void {
        this.backfills.clear();
    }

    /**
     * Paginate history back to a known read position so the next recompute is
     * exact. Capped: a room whose position is older than the cap keeps the
     * lower bound until the user reads it (which moves the position into the
     * window). Never rejects — failures just leave the lower bound in place.
     *
     * Runs from the {@link BackfillQueue}, so the read position is re-read here:
     * it may have landed in the window while this waited its turn.
     */
    private async runBackfill(roomId: string): Promise<void> {
        const room = this.matrix.getRoom(roomId);
        if (!room) return;
        const read = readPositions(room, this.matrix.getUserId());
        if (latestLoadedReadIndex(room.getLiveTimeline().getEvents(), read) >= 0) {
            this.backfilledRead.set(roomId, readKey(read));
            return;
        }
        for (let page = 0; page < BACKFILL_PAGES; page++) {
            const timeline = room.getLiveTimeline().getEvents();
            if (latestLoadedReadIndex(timeline, read) >= 0) break;
            const more = await this.matrix.paginateEventTimeline(room.getLiveTimeline(), {
                backwards: true,
                limit: BACKFILL_PAGE_SIZE,
            });
            if (!more) break;
        }
        this.backfilledRead.set(roomId, readKey(read));
        this.recompute(room);
    }
}