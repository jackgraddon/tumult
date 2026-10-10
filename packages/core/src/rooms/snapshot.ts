import { NotificationCountType, type MatrixClient } from "matrix-js-sdk";

import type { RoomSummary } from "../contract.ts";
import { readSettingsFields } from "./settings.ts";
import type { UnreadCounts } from "./unread.ts";

const SPACE_CHILD = "m.space.child";
const ROOM_TOPIC = "m.room.topic";
const ROOM_FULLY_READ = "m.fully_read";

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
            room.parentSpaceIds.length === other.parentSpaceIds.length &&
            room.parentSpaceIds.every((p, j) => p === other.parentSpaceIds[j])
        );
    });
}
/** The `m.fully_read` room account data, or `null` when never set. */
function readFullyRead(room: { getAccountData(type: string): { getContent(): Record<string, unknown> } | undefined }): string | null {
    try {
        const eventId = room.getAccountData(ROOM_FULLY_READ)?.getContent()?.["event_id"];
        return typeof eventId === "string" && eventId.length > 0 ? eventId : null;
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
