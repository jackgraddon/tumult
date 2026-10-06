import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

/**
 * Client-side unread counts for Simplified Sliding Sync.
 *
 * Synapse hardcodes `notification_count=0, highlight_count=0` in its SSS
 * responses (a `TODO: these are just dummy values` in `sliding_sync/__init__.py`,
 * still present on `develop`) — the server never sends real counts over SSS.
 * Classic `/sync` computes them server-side, so this tracker exists only for
 * the sliding-sync mode; classic rooms keep using `room.getUnreadNotificationCount`.
 *
 * The count is message-like events from other users after the read marker
 * (`m.fully_read`). When the marker predates the loaded timeline window the
 * count is a lower bound, so a one-time backfill paginates history back to the
 * marker (capped) to make it exact. The backfill reuses `paginateEventTimeline`,
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

/** The `m.fully_read` event id, or `null` when this room has never been read. */
function readMarkerEventId(room: Room): string | null {
    try {
        const eventId = room.getAccountData(READ_MARKER)?.getContent()?.["event_id"];
        return typeof eventId === "string" && eventId.length > 0 ? eventId : null;
    } catch {
        return null;
    }
}

export class UnreadTracker {
    private readonly matrix: MatrixClient;
    /** Called when a room's count changes, so the caller can re-snapshot. */
    private readonly onCounts: () => void;
    private readonly counts = new Map<string, UnreadCounts>();
    private readonly backfilling = new Set<string>();
    /** Marker each room's backfill ran for — a new marker re-arms it. */
    private readonly backfilledMarkers = new Map<string, string>();

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient, onCounts: () => void) {
        this.matrix = matrix;
        this.onCounts = onCounts;
    }

    /** Recompute every joined room's count. Called before `snapshotRooms`. */
    public update(): void {
        for (const room of this.matrix.getRooms()) {
            if (room.getMyMembership() !== "join") continue;
            this.recompute(room);
        }
    }

    public getUnread(roomId: string): UnreadCounts {
        return this.counts.get(roomId) ?? { total: 0, highlight: 0 };
    }

    private recompute(room: Room): void {
        const selfId = this.matrix.getUserId();
        const marker = readMarkerEventId(room);
        const timeline = room.getLiveTimeline().getEvents();
        const markerIndex = marker ? timeline.findIndex((e) => e.getId() === marker) : -1;
        let count = 0;
        for (let i = markerIndex + 1; i < timeline.length; i++) {
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
        // Marker predates the window → lower bound. Backfill once per marker.
        if (
            marker &&
            markerIndex < 0 &&
            this.backfilledMarkers.get(room.roomId) !== marker &&
            !this.backfilling.has(room.roomId)
        ) {
            void this.backfill(room, marker);
        }
    }

    /**
     * Paginate history back to the read marker so the next recompute is exact.
     * Capped: a room whose marker is older than the cap keeps the lower bound
     * until the user reads it (which moves the marker into the window).
     */
    private async backfill(room: Room, marker: string): Promise<void> {
        this.backfilling.add(room.roomId);
        try {
            for (let page = 0; page < BACKFILL_PAGES; page++) {
                const timeline = room.getLiveTimeline().getEvents();
                if (timeline.some((e) => e.getId() === marker)) break;
                const more = await this.matrix.paginateEventTimeline(room.getLiveTimeline(), {
                    backwards: true,
                    limit: BACKFILL_PAGE_SIZE,
                });
                if (!more) break;
            }
            this.backfilledMarkers.set(room.roomId, marker);
            this.recompute(room);
        } finally {
            this.backfilling.delete(room.roomId);
        }
    }
}
