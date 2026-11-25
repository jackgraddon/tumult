import type { RoomSelection } from "../selection.ts";

/**
 * Which rail "tab" a selection belongs to. DMs and each guild keep their own
 * last-opened room, so switching spaces and coming back preserves that space's
 * place instead of reopening whichever room was touched last globally.
 * A workspace pane has no room memory.
 */
export function viewKey(selection: RoomSelection): string | null {
    if (selection.view === "pane") return null;
    return selection.view === "guild" ? `guild:${selection.guildId ?? ""}` : "dms";
}

/** The memory itself lives in the shell's setup: page lifetime, never storage. */
export type LastRooms = Map<string, string>;

export function rememberRoom(memory: LastRooms, selection: RoomSelection): void {
    const key = viewKey(selection);
    if (key !== null && selection.roomId) memory.set(key, selection.roomId);
}

/**
 * Only recall when the route itself names no room. `available` is the shell's
 * check that the remembered id still names a room in this same view — after a
 * leave or a recency change the memory must not resurrect a stale room.
 */
export function recallRoom(
    memory: LastRooms,
    selection: RoomSelection,
    available: (roomId: string) => boolean,
): string | undefined {
    const key = viewKey(selection);
    if (key === null || selection.roomId) return undefined;
    const id = memory.get(key);
    return id !== undefined && available(id) ? id : undefined;
}

export function forgetRoom(memory: LastRooms, roomId: string): void {
    for (const [key, id] of memory) if (id === roomId) memory.delete(key);
}
