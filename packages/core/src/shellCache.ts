/**
 * The shell's "first paint" cache: the last good room list, painted from disk
 * before the first network batch.
 *
 * Why this exists. A reload would otherwise show a blank rail until the first
 * sliding-sync response arrives — and that response is a *full* resync, because
 * the SDK keeps its resume cursor in a loop local and never persists it, so
 * `client.getRooms()` is empty the moment after `store.startup()`. Seeding
 * `rooms` from the SDK's on-disk cache is therefore not an option: the rooms
 * live in the store's raw tables, not the in-memory map, and only sync
 * re-hydrates them. So we keep our own snapshot of the *published* contract —
 * the `RoomSummary[]` the UI renders — and paint that first, letting the live
 * sync upgrade it. It is a hint, never truth: every live recompute overwrites it.
 *
 * Mirrors the theme cache (`@tumult/theme`'s `runtime.ts`) and the sliding-sync
 * window store: one storage key, a versioned envelope, readers/writers that
 * never throw and degrade to empty on a malformed or stale payload, and a
 * storage-agnostic interface so this stays unit-testable without a browser.
 *
 * Nothing here touches matrix-js-sdk or the contract's secret surface;
 * `RoomSummary` is plain (names, topics, mxc URI *pointers*, counts) — no
 * message bodies, no tokens.
 */
import type { RoomSummary } from "./contract.ts";

/** One key holds the whole shell cache, keyed per-account inside the envelope. */
export const SHELL_CACHE_KEY = "tumult.shell";
/** Bump when the persisted envelope shape changes; a mismatch degrades to empty. */
export const SHELL_CACHE_VERSION = 1;
/**
 * Debounce interval for the writer. The room list republishes on every sync and
 * receipt burst; this collapses a flood into one write.
 */
export const SHELL_CACHE_DEBOUNCE_MS = 250;

/**
 * The JSON storage surface core already uses for other client state
 * (`AuthStorage.getItem<T>`/`setItem<T>`, the sliding-sync window store). Values
 * are JSON-encoded by the store, so callers pass and receive objects.
 */
export interface ShellStore {
    getItem<T>(key: string): T | null;
    setItem<T>(key: string, value: T): void;
    removeItem(key: string): void;
}

/**
 * What we paint the shell with before the first network batch.
 *
 * `rooms` is the non-sensitive half of the contract — names, topics, mxc
 * *pointers* (resolved through `resolveMedia`, not bytes), counts, structure.
 * Never message content, never tokens. Painting it first is the same kind of
 * "cache then reconcile" a browser does with its HTTP cache.
 */
export interface ShellSnapshot {
    version: number;
    savedAt: number;
    /** The account the cache belongs to; a mismatch (a stale other log-in) is empty. */
    userId: string;
    homeserverUrl: string;
    /** The room the UI last showed, re-subscribed on the first sliding-sync request. */
    lastRoomId: string | null;
    rooms: RoomSummary[];
}

/** A bare, empty cache for the given account — the never-throw default. */
export function emptyShellSnapshot(userId: string, homeserverUrl: string): ShellSnapshot {
    return { version: SHELL_CACHE_VERSION, savedAt: 0, userId, homeserverUrl, lastRoomId: null, rooms: [] };
}

/**
 * Read the last-good snapshot for `account`. Never throws: a missing, malformed,
 * wrong-version, or wrong-account entry degrades to an empty snapshot. The live
 * sync is the source of truth and repopulates this on its first recompute.
 */
export function readShellSnapshot(store: ShellStore, account: { userId: string; homeserverUrl: string }): ShellSnapshot {
    const empty = emptyShellSnapshot(account.userId, account.homeserverUrl);
    const raw = store.getItem<ShellSnapshot | null>(SHELL_CACHE_KEY);
    if (!raw || typeof raw !== "object") return empty;
    // Version and account guard: a hand-edited key or a cache from a different
    // user/homeserver must not bleed into this boot.
    if (raw.version !== SHELL_CACHE_VERSION) return empty;
    if (raw.userId !== account.userId || raw.homeserverUrl !== account.homeserverUrl) return empty;
    if (!Array.isArray(raw.rooms)) return empty;

    const lastRoomId = typeof raw.lastRoomId === "string" ? raw.lastRoomId : null;
    const savedAt = typeof raw.savedAt === "number" && Number.isFinite(raw.savedAt) ? raw.savedAt : 0;
    // Trust only the fields we validate; a half-written summary is dropped, not fatal.
    const rooms = raw.rooms.map(safeSummary).filter((r): r is RoomSummary => r !== null);
    return { version: SHELL_CACHE_VERSION, savedAt, userId: account.userId, homeserverUrl: account.homeserverUrl, lastRoomId, rooms };
}

/**
 * Persist the current shell view. Best-effort: a full or unavailable localStorage
 * must never take down the room list — the cache is a hint, not a dependency, so
 * the failure is swallowed.
 */
export function writeShellSnapshot(
    store: ShellStore,
    account: { userId: string; homeserverUrl: string },
    rooms: readonly RoomSummary[],
    lastRoomId: string | null,
): boolean {
    try {
        const snapshot: ShellSnapshot = {
            version: SHELL_CACHE_VERSION,
            savedAt: Date.now(),
            userId: account.userId,
            homeserverUrl: account.homeserverUrl,
            lastRoomId,
            rooms: rooms.map(safeSummary).filter((r): r is RoomSummary => r !== null),
        };
        store.setItem<ShellSnapshot>(SHELL_CACHE_KEY, snapshot);
        return true;
    } catch {
        return false;
    }
}

/** Drop the cache (logout, token revocation). Best-effort. */
export function clearShellSnapshot(store: ShellStore): void {
    try {
        store.removeItem(SHELL_CACHE_KEY);
    } catch {
        // A failing remove must not trap logout.
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept the persisted summary shape but trust nothing: a summary that is missing
 * a field, or has the wrong type, is dropped. The live snapshot will replace the
 * whole list on the next recompute, so dropping a few stale rows on a boot is
 * cheaper than rendering a malformed one.
 */
function safeSummary(input: unknown): RoomSummary | null {
    if (!isRecord(input)) return null;
    if (typeof input["id"] !== "string" || typeof input["name"] !== "string" || typeof input["isSpace"] !== "boolean") {
        return null;
    }
    const out = {} as RoomSummary;
    out.id = input["id"];
    out.name = input["name"];
    out.isSpace = input["isSpace"];
    out.topic = typeof input["topic"] === "string" ? input["topic"] : null;
    out.avatarUrl = typeof input["avatarUrl"] === "string" ? input["avatarUrl"] : null;
    out.parentSpaceIds = Array.isArray(input["parentSpaceIds"])
        ? (input["parentSpaceIds"].filter((v): v is string => typeof v === "string"))
        : [];
    out.unreadCount = typeof input["unreadCount"] === "number" ? input["unreadCount"] : 0;
    out.highlightCount = typeof input["highlightCount"] === "number" ? input["highlightCount"] : 0;
    out.fullyReadEventId = typeof input["fullyReadEventId"] === "string" ? input["fullyReadEventId"] : null;
    out.joinRule = (typeof input["joinRule"] === "string" ? input["joinRule"] : "invite") as RoomSummary["joinRule"];
    out.historyVisibility = (
        typeof input["historyVisibility"] === "string" ? input["historyVisibility"] : "shared"
    ) as RoomSummary["historyVisibility"];
    out.canonicalAlias = typeof input["canonicalAlias"] === "string" ? input["canonicalAlias"] : null;
    out.favourite = typeof input["favourite"] === "boolean" ? input["favourite"] : false;
    out.favouriteOrder =
        typeof input["favouriteOrder"] === "number" ? input["favouriteOrder"] : null;
    out.muted = typeof input["muted"] === "boolean" ? input["muted"] : false;
    return out;
}
