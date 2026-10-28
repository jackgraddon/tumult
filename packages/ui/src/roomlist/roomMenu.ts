import type { RoomSummary } from "@tumult/core";

import { matrixRoomLink } from "../links.ts";

/**
 * The room context menu, as data.
 *
 * Same split as the message menu: this file decides what a room row may offer
 * (and what it must not), `RoomListItem` renders the list and maps an id back
 * to the request it was given. Keeps the permission-adjacent logic — "no point
 * marking a room read that has nothing unread" — unit-testable without
 * mounting a row.
 */

export type RoomMenuAction = "mark-read" | "pin" | "unpin" | "mute" | "unmute" | "copy-link" | "copy-id" | "leave" | "set-avatar" | "set-alias";

export type RoomMenuEntry =
    | { kind: "separator"; id: string }
    | { kind: "item"; id: RoomMenuAction; label: string; danger?: boolean };

export interface RoomMenu {
    /** Items in render order, separators included. */
    entries: readonly RoomMenuEntry[];
    /** `matrix.to` link for this room (its canonical alias when it has one). */
    roomLink: string;
}

function item(id: RoomMenuAction, label: string, danger = false): RoomMenuEntry {
    return { kind: "item", id, label, danger };
}

export function buildRoomMenu(room: RoomSummary): RoomMenu {
    const roomLink = matrixRoomLink(room.id, room.canonicalAlias);

    // Read state, then the link/id pair, then the way out. Marking a room read
    // that has nothing unread is a no-op, so the item is absent rather than
    // sitting there doing nothing.
    const entries: RoomMenuEntry[] = [];
    if (room.unreadCount > 0 || room.highlightCount > 0) entries.push(item("mark-read", "Mark as read"));
    // Pin and mute are toggles, so the label is the state we would move to.
    entries.push(item(room.favourite ? "unpin" : "pin", room.favourite ? "Unpin" : "Pin to top"));
    entries.push(item(room.muted ? "unmute" : "mute", room.muted ? "Unmute" : "Mute"));
    entries.push({ kind: "separator", id: "separator-copy" });
    entries.push(item("copy-link", "Copy link"));
    entries.push(item("copy-id", "Copy room ID"));
    entries.push({ kind: "separator", id: "separator-destructive" });
    entries.push(item("leave", "Leave room", true));

    return { entries, roomLink };
}
