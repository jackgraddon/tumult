import { NotificationCountType, type MatrixClient } from "matrix-js-sdk";

import type { RoomSummary } from "../contract.ts";
import { readSettingsFields } from "./settings.ts";
import type { UnreadCounts } from "./unread.ts";

const SPACE_CHILD = "m.space.child";
const ROOM_TOPIC = "m.room.topic";
const ROOM_FULLY_READ = "m.fully_read";
const RTAGS = "m.tag";
const FAVOURITES_TAG = "m.favourite";

/**
 * Map the SDK's joined rooms onto contract snapshots.
 *
 * Parent links come from `m.space.child` state events in space rooms: room R
 * lists parent S for every space S carrying such an event keyed by R. Unknown
 * or dangling parents are left in — `selectSpaceTree` sanitises them.
 *
 * Avatars are published as `mxc://` URIs; the UI resolves them through
 * `resolveMedia()` (authenticated media needs the access token, which a
 * plain URL in an `<img>` can't carry).
 *
 * `unreadOverride` supplies client-side unread counts for sliding-sync mode
 * (Synapse sends none); when absent the SDK's server-computed counts are used.
 */
export function snapshotRooms(
    client: MatrixClient,
    unreadOverride?: (roomId: string) => UnreadCounts | null,
): RoomSummary[] {
    const joined = client.getRooms().filter((room) => room.getMyMembership() === "join");

    const parentsByRoomId = new Map<string, Set<string>>();
    for (const room of joined) {
        if (!room.isSpaceRoom()) continue;
        let children: { getStateKey(): string | undefined; getContent(): Record<string, unknown> }[];
        try {
            children = room.currentState.getStateEvents(SPACE_CHILD);
        } catch {
            continue;
        }
        for (const event of children) {
            const childId = event.getStateKey();
            if (!childId) continue;
            // Removing a child doesn't delete the state event — it replaces it
            // with empty content. Per spec only a non-empty `via` makes it a
            // live link; without this check removed rooms stay nested forever.
            const via = event.getContent()?.["via"];
            if (!Array.isArray(via) || via.length === 0) continue;
            let parents = parentsByRoomId.get(childId);
            if (!parents) {
                parents = new Set();
                parentsByRoomId.set(childId, parents);
            }
            parents.add(room.roomId);
        }
    }

    return joined.map((room) => {
        const override = unreadOverride?.(room.roomId) ?? null;
        const settings = readSettingsFields(room);
        return {
            id: room.roomId,
            name: room.name,
            topic: readTopic(room),
            avatarUrl: readAvatar(room),
            isSpace: room.isSpaceRoom(),
            parentSpaceIds: [...(parentsByRoomId.get(room.roomId) ?? [])].sort(),
            unreadCount: override?.total ?? room.getUnreadNotificationCount(NotificationCountType.Total),
            highlightCount: override?.highlight ?? room.getUnreadNotificationCount(NotificationCountType.Highlight),
            fullyReadEventId: readFullyRead(room),
            joinRule: settings.joinRule,
            historyVisibility: settings.historyVisibility,
            canonicalAlias: settings.canonicalAlias,
            favourite: readFavourite(room),
            favouriteOrder: readFavouriteOrder(room),
        };
    });
}

/**
 * Shallow equality over published snapshots. The sync loop fires on every
 * batch (including idle polls), and most batches change nothing — publishing
 * a fresh array each time would re-render the whole shell for no reason.
 */
export function sameRoomSummaries(a: readonly RoomSummary[], b: readonly RoomSummary[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((room, i) => {
        const other = b[i];
        return (
            other !== undefined &&
            room.id === other.id &&
            room.name === other.name &&
            room.topic === other.topic &&
            room.avatarUrl === other.avatarUrl &&
            room.isSpace === other.isSpace &&
            room.unreadCount === other.unreadCount &&
            room.highlightCount === other.highlightCount &&
            // Account data, not send state: republish when the marker moves,
            // or the "New messages" divider sits on a stale row.
            room.fullyReadEventId === other.fullyReadEventId &&
            // State events: republish so the settings dialog never shows stale
            // join rule / history / alias after someone (or another client)
            // changed them.
            room.joinRule === other.joinRule &&
            room.historyVisibility === other.historyVisibility &&
            room.canonicalAlias === other.canonicalAlias &&
            // Favourites: republish so the rail's Favourites band reorders or
            // populates when the user's `m.favourite` tag / its order moves.
            room.favourite === other.favourite &&
            room.favouriteOrder === other.favouriteOrder &&
            room.parentSpaceIds.length === other.parentSpaceIds.length &&
            room.parentSpaceIds.every((p, j) => p === other.parentSpaceIds[j])
        );
    });
}

/**
 * Warm-boot merge: overlay a cached room list over a freshly computed one.
 *
 * At boot the cached list is painted, then the first network batch supersedes
 * it. With sliding sync the SDK does not persist its window cursor, so that first
 * batch is a *partial* resync — far fewer rooms than the account actually has.
 * Publishing it wholesale collapses the rail (e.g. 92 → 9) until the window
 * fills in, the flicker the cache-first seed above was meant to remove.
 *
 * The union keeps seed-only rooms and lets the live value win when a room is in
 * both, so `refreshRooms()` runs it for every recompute until the first full
 * batch supersedes the seed. Order is `next` first, then any seed rows not in
 * `next`, so a filled-in window re-sorts itself the moment the authoritative
 * list arrives.
 *
 * Pure: touches only each room's `id`; the list is a fresh array (the seed or
 * `next` are never mutated), so the UI and the id-ordered cache signature see a
 * stable list through the merge.
 */
export function mergeRoomSummaries(
    seed: readonly RoomSummary[],
    next: readonly RoomSummary[],
): RoomSummary[] {
    if (seed.length === 0) return next.slice();
    const alive = new Set<string>();
    for (const room of next) alive.add(room.id);
    const merged = next.slice();
    for (const room of seed) {
        if (!alive.has(room.id)) merged.push(room);
    }
    return merged;
}

/** The `m.fully_read` room account data, or `null` when never set. */
function readFullyRead(room: {
    getAccountData(type: string): { getContent(): Record<string, unknown> } | undefined;
}): string | null {
    try {
        const eventId = room.getAccountData(ROOM_FULLY_READ)?.getContent()?.["event_id"];
        return typeof eventId === "string" && eventId.length > 0 ? eventId : null;
    } catch {
        return null;
    }
}

/**
 * The `m.favourite` `favourite` flag: true when the room's `m.tag` account data
 * lists the `m.favourite` tag (per `setRoomTag(roomId, "m.favourite")`). Read
 * from room account data, so it follows sync, not the user's own sends.
 */
function readFavourite(room: {
    getAccountData(type: string): { getContent(): Record<string, unknown> } | undefined;
}): boolean {
    try {
        const tags = room
            .getAccountData(RTAGS)
            ?.getContent?.()["tags"] as Record<string, unknown> | undefined;
        const entry = tags?.["m.favourite"];
        // Presence is what matters: a room tagged `m.favourite` without an
        // explicit `order` is still a favourite (it sorts last); only a missing
        // tag counts as "not favourited".
        return entry !== undefined && entry !== null;
    } catch {
        return false;
    }
}

/**
 * The `m.favourite` tag's `order` for the room, or `null` when the room is not
 * favourited or the tag carried no order. Higher values sort first (Discord
 * semantics); rooms without an order sort last.
 */
function readFavouriteOrder(room: {
    getAccountData(type: string): { getContent(): Record<string, unknown> } | undefined;
}): number | null {
    try {
        const tags = room
            .getAccountData(RTAGS)
            ?.getContent()?.["tags"] as Record<string, { order?: unknown }> | undefined;
        const order = tags?.[FAVOURITES_TAG]?.order;
        return typeof order === "number" && Number.isFinite(order) ? order : null;
    } catch {
        return null;
    }
}

function readTopic(room: { currentState: { getStateEvents(t: string, k: string): unknown } }): string | null {
    try {
        const event = room.currentState.getStateEvents(ROOM_TOPIC, "") as {
            getContent(): Record<string, unknown>;
        } | null;
        const topic = event?.getContent()?.["topic"];
        return typeof topic === "string" && topic.length > 0 ? topic : null;
    } catch {
        return null;
    }
}

function readAvatar(room: {
    getMxcAvatarUrl(): string | null;
    getAvatarFallbackMember?(): { getMxcAvatarUrl(): string | undefined } | undefined;
}): string | null {
    // DMs usually have no room avatar; the SDK's fallback member is the one
    // other person in a 1:1, whose avatar is what every client shows.
    const mxc = room.getMxcAvatarUrl() ?? room.getAvatarFallbackMember?.()?.getMxcAvatarUrl() ?? null;
    return mxc && mxc.startsWith("mxc://") ? mxc : null;
}
