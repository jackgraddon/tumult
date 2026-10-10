import type { SlidingSync } from "matrix-js-sdk/lib/sliding-sync.js";

/** The single SSS list key the room window lives under. */
export const SSS_LIST_KEY = "all";

/** How many rooms `loadMore()` adds to the window per call. */
const PAGE_SIZE = 500;
/** Hard cap on the window's inclusive upper bound. */
const MAX_END = 5000;
/** Window used on a cold start (no persisted value): a Discord-sized first page. */
const DEFAULT_END = 999;

/**
 * Persists the sliding-sync room window across reloads. Kept as an interface so
 * the manager stays free of any browser/storage dependency and is unit-testable.
 */
export interface SssWindowStore {
    /** The previously saved upper bound, or `null`. */
    loadEnd(): number | null;
    /** Persist the upper bound after a change. */
    saveEnd(end: number): void;
}

/**
 * Owns the sliding-sync room window.
 *
 * The window is a single list (`all`) whose one range `[[0, end]]` asks for the
 * first `end + 1` rooms by activity. Growing it is `setListRanges` — the
 * supported SDK entry point — and ranges are non-sticky, so this does not force
 * a re-send of the list's other params.
 *
 * Persistence is the **upper bound only**. v43's sliding path keeps its sync
 * `pos` in a local inside `start()` and never calls `setSyncToken`, so a cold
 * boot still performs a fresh initial sync and an offline boot has no rooms.
 * What this restores is the window *size*, so a returning user does not have to
 * page the room list back to where they left it.
 */
export class SlidingSyncRangeManager {
    private readonly sync: SlidingSync;
    private readonly store: SssWindowStore | undefined;
    private end = -1;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(sync: SlidingSync, store?: SssWindowStore) {
        this.sync = sync;
        this.store = store;
    }

    /** The current inclusive upper bound, or -1 before `restoreWindow()`. */
    public get currentEnd(): number {
        return this.end;
    }

    /**
     * Apply the persisted window (clamped to the supported bounds) or the
     * default. Call before `startClient()` so the first request carries it.
     */
    public restoreWindow(): number {
        const persisted = this.store?.loadEnd() ?? null;
        const wanted =
            persisted !== null && Number.isFinite(persisted) ? Math.floor(persisted) : DEFAULT_END;
        const end = Math.min(Math.max(wanted, DEFAULT_END), MAX_END);
        this.apply(end);
        return end;
    }

    /**
     * Grow the window by one page. Resolves `false` at the cap (or before
     * `restoreWindow()` ran), so callers can stop offering "load more".
     */
    public loadMore(): boolean {
        if (this.end < 0 || this.end >= MAX_END) return false;
        const next = Math.min(this.end + PAGE_SIZE, MAX_END);
        if (next <= this.end) return false;
        this.apply(next);
        return true;
    }

    /**
     * Whether the server reports more joined rooms than the window covers and
     * the window is not at its cap. Drives the "load more" affordance; the
     * server's total only exists after the first response, so this is `false`
     * until then.
     */
    public hasMore(): boolean {
        if (this.end < 0 || this.end >= MAX_END) return false;
        const joined = this.sync.getListData(SSS_LIST_KEY)?.joinedCount ?? 0;
        return joined > this.end + 1;
    }

    private apply(end: number): void {
        this.end = end;
        this.sync.setListRanges(SSS_LIST_KEY, [[0, end]]);
        this.store?.saveEnd(end);
    }
}
