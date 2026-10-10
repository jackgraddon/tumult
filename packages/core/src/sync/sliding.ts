import type { MatrixClient } from "matrix-js-sdk";
import {
    MSC3575_STATE_KEY_ME,
    MSC3575_WILDCARD,
    SlidingSync,
    type MSC3575List,
} from "matrix-js-sdk/lib/sliding-sync.js";
import {
    SlidingSyncRangeManager,
    SSS_LIST_KEY,
    type SssWindowStore,
} from "./range-manager.js";

/**
 * Simplified Sliding Sync (MSC4186) — the sync mode this client prefers
 * when the homeserver advertises `org.matrix.simplified_msc3575`.
 *
 * The SDK only swaps its sync loop to `SlidingSyncSdk` when a `SlidingSync`
 * instance is passed as a **`startClient()` option** (`client.js` reads
 * `clientOpts.slidingSync`). Passing it to `createClient` is silently
 * ignored — the same trap as `threadSupport`/`lazyLoadMembers`. The official
 * js-sdk guide shows the `createClient` form; it is wrong for this version.
 *
 * Wire format: matrix-js-sdk@43 and Synapse 1.114 are a matched
 * pre-conformance draft pair — `pos`/`timeout` travel as query params, lists
 * carry `ranges` (not the final `range`), and `required_state` is a tuple
 * array. Newer Synapse releases moved toward the merged MSC and may reject
 * this shape, which is why `syncMode` can force classic `/sync`.
 */

/** How the sync loop is chosen. `auto` prefers sliding sync, else classic. */
export type SyncModeOption = "auto" | "classic" | "sliding";

/** The sync loop actually running after detection/override. */
export type ActiveSyncMode = "classic" | "sliding";

export type { SlidingSync, SlidingSyncRangeManager, SssWindowStore };

const SSS_FEATURE = "org.matrix.simplified_msc3575";

/**
 * State every room in the window needs for the app to render it.
 *
 * `m.room.member` uses the wildcard because the pre-conformance draft has no
 * lazy-members flag (that is the final-MSC object form): without `*`, sender
 * displaynames and avatars don't resolve and the timeline shows raw mxids.
 * The cost is a full roster on each room's first sync; incremental syncs
 * then carry only membership deltas.
 */
const REQUIRED_STATE: string[][] = [
    ["m.room.name", ""],
    ["m.room.topic", ""],
    ["m.room.avatar", ""],
    ["m.room.canonical_alias", ""],
    ["m.room.encryption", ""],
    ["m.room.create", ""],
    ["m.room.power_levels", ""],
    ["m.room.join_rules", ""],
    ["m.space.child", ""],
    ["m.room.parent", ""],
    ["m.room.member", MSC3575_STATE_KEY_ME],
    ["m.room.member", MSC3575_WILDCARD],
];

/**
 * Ask the homeserver whether it speaks MSC4186. Any failure (offline, weird
 * `/versions`) means classic `/sync` — never let detection break login.
 */
export async function detectSlidingSync(client: MatrixClient): Promise<boolean> {
    try {
        return await client.doesServerSupportUnstableFeature(SSS_FEATURE);
    } catch {
        return false;
    }
}

/**
 * Build the `SlidingSync` for a client. One list, `all`, covering the first
 * 1000 rooms by activity — the room list shows every joined room, so the
 * window has to be generous. (`slow_get_all_rooms` and empty `ranges` both
 * 500 on Synapse 1.114, so an explicit range is the only working form.)
 *
 * `timeline_limit` matches classic's default `initialSyncLimit` of 20, so
 * the first sync is no heavier than the loop it replaces; `loadMore()` walks
 * the rest via `prev_batch`.
 *
 * The range itself is owned by `SlidingSyncRangeManager`: it is applied via
 * `setListRanges` (the one list, grown in place) and restored from `store`
 * before `startClient()`.
 */
export function buildSlidingSync(
    client: MatrixClient,
    store?: SssWindowStore,
): { sync: SlidingSync; manager: SlidingSyncRangeManager } {
    const list: MSC3575List = {
        // Replaced by manager.restoreWindow() before start; a sane default
        // keeps a forgotten call from sending an empty range.
        ranges: [[0, 999]],
        timeline_limit: 20,
        required_state: REQUIRED_STATE,
        filters: {},
    };

    const sync = new SlidingSync(
        client.baseUrl,
        new Map([[SSS_LIST_KEY, list]]),
        // Room-subscription defaults for explicitly subscribed rooms (the open
        // room). This arg is a *subscription*, not a list: passing the list
        // shape here is silently ignored.
        { required_state: REQUIRED_STATE, timeline_limit: 20 },
        client,
        30_000,
    );

    const manager = new SlidingSyncRangeManager(sync, store);
    return { sync, manager };
}
