import { NotificationCountType } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";

import type { ConnectionState, RoomSummary } from "../contract.ts";
import type { StoredSession } from "../auth/storage.ts";
import type { ClientContext } from "../client-context.ts";
import { Observable } from "../observable.ts";
import { SHELL_CACHE_DEBOUNCE_MS, readShellSnapshot, writeShellSnapshot } from "../shellCache.ts";
import { ThrottledTask } from "../util/throttle.ts";
import { mergeRoomSummaries, sameRoomSummaries, snapshotRooms } from "./snapshot.ts";
import { UnreadTracker } from "./unread.ts";

/**
 * Throttle for progressive room-list refreshes during the first sync. Sliding
 * sync emits `ClientEvent.Room` once per room as it enters the window (roughly
 * 100 events on a large account), all before the single terminal
 * `ClientEvent.Sync`; without a throttle the list would recompute and re-render
 * once per room. One pass per this window keeps it smooth while still painting
 * long before the batch finishes.
 */
export const PROGRESSIVE_REFRESH_MS = 120;

/**
 * A structure signature over a room list, for gating an async cache write.
 *
 * The published room list re-publishes on every sync and receipt burst, and
 * `sameRoomSummaries` already skips a republish when nothing counts-differently
 * moved — but a single new message bumps a count, republishes the array, and
 * arms the debounced writer. Counts change every message; the *structure* (which
 * rooms exist, their names, space nesting, favourites) is what first paint needs
 * and changes rarely, so a count-only update must not force a localStorage write.
 *
 * The signature therefore keeps only structural fields and omits the
 * high-frequency ones (unread / highlight / read marker / topic / alias, which
 * the live sync reconciles anyway). Order is preserved positionally — a genuine
 * reorder SHOULD write once — so the signature is compared against the last
 * written one rather than recomputed-and-stored per burst.
 */
export function shellSignature(rooms: readonly RoomSummary[]): string {
    return rooms
        .map((r) => {
            const kind = r.isSpace ? "S" : "C";
            const fav = r.favourite ? String(r.favouriteOrder ?? 0) : "-";
            return [r.id, r.name, kind, fav, r.parentSpaceIds.join(","), r.avatarUrl ?? "", r.joinRule].join("#");
        })
        .join("\n");
}

/**
 * The published room list: a snapshot over the SDK, recomputed (never
 * patched) on invalidation signals, coalesced per burst, seeded from the
 * shell cache at boot and persisted back to it.
 *
 * The feed is created once and lives for the client's whole life. The SDK
 * listeners that drive it (Sync, Room, receipt) stay inline in the client's
 * bootstrap, where their registration order is visible; they call
 * {@link onSync} / {@link schedule} / {@link scheduleProgressive}.
 */
export class RoomListPublisher {
    public readonly feed = new Observable<RoomSummary[]>([]);

    private readonly ctx: ClientContext;
    /** Client-side unread counts (sliding sync only — Synapse sends none). */
    private unread: UnreadTracker | null = null;
    /**
     * A room-list refresh is due on the next microtask. Sync, receipt, and
     * unread-count signals arrive in bursts (a sync batch can carry many
     * receipts); coalescing keeps `snapshotRooms` to one pass per burst.
     */
    private refreshScheduled = false;
    /**
     * Progressive room-list refresh for the first sync (see
     * {@link scheduleProgressive}). A throttled task, not a microtask: the
     * first-sync room flood must not recompute once per room.
     */
    private readonly progressive: ThrottledTask;
    /**
     * Debounced writer for the shell's first-paint cache (see `shellCache.ts`).
     * The room list republishes on every sync/receipt burst; this collapses a
     * flood into one localStorage write so a busy room can't churn the cache.
     */
    private readonly persist: ThrottledTask;
    /**
     * Signature of the last cache write: the room *structure* (ids, names,
     * space nesting, favourite order), not the counts. Counts change every
     * message but the structure is what first paint needs, so a count-only
     * update is not worth a localStorage write.
     */
    private lastSignature: string | null = null;
    /**
     * The room list painted from the shell cache at boot, held until the first
     * full sync batch supersedes it. With sliding sync the SDK does not persist
     * its window cursor, so the first network batch is a *partial* resync — far
     * fewer rooms than the cache holds. {@link refresh} overlays this seed over
     * every partial batch (see `mergeRoomSummaries`) so the rail can't collapse
     * (92 → 9 → 92) while the window fills in; {@link clearWarmSeed} drops it on
     * the first full batch and on every teardown (stop / logout / logged-out).
     */
    private warmSeed: RoomSummary[] | null = null;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(ctx: ClientContext) {
        this.ctx = ctx;
        this.progressive = new ThrottledTask(() => this.refresh(), PROGRESSIVE_REFRESH_MS);
        this.persist = new ThrottledTask(() => this.flush(), SHELL_CACHE_DEBOUNCE_MS);
    }

    /**
     * Paint the cached room list for `session` and hold it as the warm seed.
     * Returns the room the cache says the UI last had open (null when the cache
     * is empty, stale or another account's); the client applies it only when
     * nothing is selected yet.
     */
    public seed(session: StoredSession): string | null {
        const seed = readShellSnapshot(this.ctx.storage, { userId: session.userId, homeserverUrl: session.homeserverUrl });
        if (seed.rooms.length === 0) return null;
        this.feed.set(seed.rooms);
        this.lastSignature = shellSignature(seed.rooms);
        // Hold the seed so the first partial batch can't collapse the rail;
        // `clearWarmSeed()` drops it on the first full sync.
        this.warmSeed = seed.rooms;
        console.debug(`[tumult] warm seed: ${seed.rooms.length} rooms from shell cache`);
        return seed.lastRoomId;
    }

    /**
     * The sync listener's share of the room list. The first usable batch
     * supersedes the warm seed: Prepared, Syncing and Catchup all collapse to
     * "syncing", so the first one is the first full list, and from here on
     * {@link refresh} publishes the authoritative live list. Then recompute
     * wholesale: every batch can join/leave/rename rooms, change hierarchy, or
     * move unread counts (receipts ride the same loop), and the Sync event is
     * the one invalidation signal that covers all of them without per-room
     * listener bookkeeping.
     */
    public onSync(next: ConnectionState): void {
        if (this.warmSeed && next === "syncing") this.clearWarmSeed();
        this.schedule();
    }

    /** Sliding sync only: count unread client-side (Synapse sends 0). */
    public attachUnread(client: MatrixClient): void {
        this.unread = new UnreadTracker(client, () => this.schedule());
    }

    /**
     * Drop all per-start state and pending work: the unread tracker, a queued
     * microtask refresh, the warm seed and the progressive timer. Idempotent.
     * Leaves the debounced cache writer alone — stop() flushes and clears that
     * itself, first, before the selection and client go.
     */
    public detach(): void {
        this.unread?.dispose();
        this.unread = null;
        this.refreshScheduled = false;
        this.clearWarmSeed();
        this.clearProgressive();
    }

    /** Cancel a pending debounced cache write. */
    public clearPersist(): void {
        this.persist.clear();
    }

    /**
     * Coalesce a room-list refresh onto the next microtask. Sync, receipt, and
     * unread-count changes all funnel here: a single sync batch can carry many
     * receipts, and each used to run a full `snapshotRooms` pass.
     */
    public schedule(): void {
        if (this.refreshScheduled) return;
        this.refreshScheduled = true;
        queueMicrotask(() => {
            this.refreshScheduled = false;
            // A pending progressive refresh would do the same pass; drop it so
            // a Sync/receipt burst never costs two snapshots.
            this.clearProgressive();
            this.refresh();
        });
    }

    /**
     * Throttled variant of {@link schedule}, used for the first-sync room
     * flood. At most one recompute per {@link PROGRESSIVE_REFRESH_MS} while
     * rooms stream in, so the list grows smoothly instead of re-rendering once
     * per room. A later `schedule()` (the terminal Sync) still runs
     * immediately; the timer is cleared on teardown.
     */
    public scheduleProgressive(): void {
        this.progressive.schedule();
    }

    /**
     * Recompute the room list from the SDK and publish it. Never throws:
     * a snapshot failure must not take down the sync listener.
     *
     * While a warm seed is held (boot, before the first full batch), the fresh
     * snapshot is overlaid onto it: a partial resync can't drop the count, and
     * seed-only rooms survive until the first full batch supersedes the seed.
     * `sameRoomSummaries` then skips a republish when the merged list is byte
     * for byte what the UI already shows.
     */
    public refresh(): void {
        const client = this.ctx.matrix();
        if (!client) return;
        try {
            // Sliding sync sends no unread counts (Synapse hardcodes them to 0),
            // so in that mode the tracker recomputes them here, before the
            // snapshot reads them. Classic /sync supplies exact server counts
            // and highlights, so there is no tracker to run.
            this.unread?.update();
            const next = snapshotRooms(
                client,
                this.unread ? (roomId) => this.unread!.getUnread(roomId) : undefined,
            );
            const published = this.warmSeed ? mergeRoomSummaries(this.warmSeed, next) : next;
            if (sameRoomSummaries(published, this.feed.get())) return;
            const spaces = published.filter((r) => r.isSpace).length;
            console.debug(`[tumult] rooms snapshot: ${published.length} joined (${spaces} spaces)`);
            this.feed.set(published);
            // The published list is what first-paint will use; queue its cache
            // write (debounced, structure-gated below) so the next boot paints it.
            this.persist.schedule();
        } catch (error) {
            console.error("[tumult] room snapshot failed", error);
        }
    }

    /**
     * Persist the published room list so the next boot can paint it before the
     * first network batch (see {@link seed}). Structure-gated: a count-only
     * change re-publishes the list but moves no room's identity, so it is not
     * worth a synchronous localStorage write. Best-effort: a full store makes
     * `writeShellSnapshot` return false and the list still renders.
     */
    public flush(): void {
        const account = this.ctx.session();
        if (!account) return; // logged out / pre-session: nothing to cache
        const rooms = this.feed.get();
        const signature = shellSignature(rooms);
        if (signature === this.lastSignature) return;
        this.lastSignature = signature;
        writeShellSnapshot(
            this.ctx.storage,
            { userId: account.userId, homeserverUrl: account.homeserverUrl },
            rooms,
            this.ctx.selectedRoomId(),
        );
    }

    /**
     * Dev diagnostics behind the client's `debugUnread()`: the raw
     * read-position state behind each joined room's unread badge. Pass `true`
     * to force a recompute first.
     */
    public debugUnread(recompute = false): Array<Record<string, unknown>> {
        const client = this.ctx.matrix();
        if (!client) return [];
        if (recompute) this.unread?.update();
        return client
            .getRooms()
            .filter((room) => room.getMyMembership() === "join")
            .map((room) => ({
                name: room.name,
                roomId: room.roomId,
                sdkUnread: room.getUnreadNotificationCount(),
                threadUnread: room.hasThreadUnreadNotification(),
                ...(this.unread
                    ? this.unread.describe(room)
                    : {
                        total: room.getUnreadNotificationCount(),
                        highlight: room.getUnreadNotificationCount(NotificationCountType.Highlight),
                        markerId: null,
                        receiptIds: [],
                        readIndex: -1,
                        window: room.getLiveTimeline().getEvents().length,
                        tailId: null,
                    }),
            }));
    }

    /** Drop any pending progressive refresh (stop/teardown). */
    private clearProgressive(): void {
        this.progressive.clear();
    }

    /**
     * Drop the warm seed. Either the first full batch has arrived (the sync
     * listener clears it, from which point the live list is authoritative) or
     * the client is tearing down (stop / logout / logged-out — a stale seed
     * must never linger into the next boot's first paint).
     */
    private clearWarmSeed(): void {
        this.warmSeed = null;
    }
}
