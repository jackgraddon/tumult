/**
 * The space (guild rail) context menu, as data.
 *
 * A space is a room, but it has no timeline of its own, so nothing here is
 * per-event: what a tile can offer is its link, its id, and the way out.
 * "Mark as read" means "every channel in it" (the shell walks the subtree), and
 * like the room menu it is absent when the tile shows nothing unread. The
 * management items (channel, invite, settings) are always offered: the rail
 * holds no power levels, so the server is the arbiter, as with the gear.
 */

import { matrixRoomLink } from "../links.ts";

export type SpaceMenuAction =
    | "mark-read"
    | "create-channel"
    | "invite"
    | "settings"
    | "copy-link"
    | "copy-id"
    | "leave";

export type SpaceMenuEntry =
    | { kind: "separator"; id: string }
    | { kind: "item"; id: SpaceMenuAction; label: string; danger?: boolean };

export interface SpaceMenu {
    entries: readonly SpaceMenuEntry[];
    /** `matrix.to` link for the space (its canonical alias when it has one). */
    spaceLink: string;
}

function item(id: SpaceMenuAction, label: string, danger = false): SpaceMenuEntry {
    return { kind: "item", id, label, danger };
}

export function buildSpaceMenu(
    spaceId: string,
    canonicalAlias?: string | null,
    hasUnread = false,
): SpaceMenu {
    const entries: SpaceMenuEntry[] = [];
    if (hasUnread) {
        entries.push(item("mark-read", "Mark as read"));
        entries.push({ kind: "separator", id: "separator-read" });
    }
    entries.push(
        item("create-channel", "Create channel"),
        item("invite", "Invite people"),
        item("settings", "Space settings"),
        { kind: "separator", id: "separator-manage" },
        item("copy-link", "Copy link"),
        item("copy-id", "Copy space ID"),
        { kind: "separator", id: "separator-destructive" },
        item("leave", "Leave space", true),
    );
    return { entries, spaceLink: matrixRoomLink(spaceId, canonicalAlias) };
}
