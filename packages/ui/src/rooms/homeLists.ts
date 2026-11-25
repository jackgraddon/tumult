import type { RoomSummary } from "@tumult/core";

/** Short, deliberately bounded: the empty pane is a springboard, not a room list. */
export const HOME_LIST_LIMIT = 3;

function byRecency(a: RoomSummary, b: RoomSummary): number {
    return b.lastActivityTs - a.lastActivityTs;
}

/** Spaces are not conversations — they have no timeline to open. */
function conversations(rooms: readonly RoomSummary[]): RoomSummary[] {
    return rooms.filter((room) => !room.isSpace);
}

export function recentChats(rooms: readonly RoomSummary[], limit = HOME_LIST_LIMIT): RoomSummary[] {
    return conversations(rooms).sort(byRecency).slice(0, limit);
}

/** Highlights are unread too; the badge the rows show treats them the same way. */
export function unreadChats(rooms: readonly RoomSummary[], limit = HOME_LIST_LIMIT): RoomSummary[] {
    return conversations(rooms)
        .filter((room) => room.unreadCount > 0 || room.highlightCount > 0)
        .sort(byRecency)
        .slice(0, limit);
}

/**
 * The rail-level guild a conversation hangs under, walking through nested
 * spaces. Undefined means the room belongs in DMs (an orphan, or a favourite
 * with no space parent) — the same rule `selectSpaceTree` uses.
 */
export function topSpaceId(rooms: readonly RoomSummary[], room: RoomSummary): string | undefined {
    if (room.isSpace || room.parentSpaceIds.length === 0) return undefined;
    const byId = new Map(rooms.map((r) => [r.id, r]));
    const seen = new Set<string>([room.id]);
    let current = room;
    let top: string | undefined;
    while (true) {
        const parentId = current.parentSpaceIds.find(
            (id) => !seen.has(id) && byId.get(id)?.isSpace === true,
        );
        if (parentId === undefined) break;
        seen.add(parentId);
        top = parentId;
        const parent = byId.get(parentId);
        if (!parent) break;
        current = parent;
    }
    return top;
}
