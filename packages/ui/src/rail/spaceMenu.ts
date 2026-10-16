/**
 * The space (guild rail) context menu, as data.
 *
 * A space is a room, but it has no timeline of its own, so nothing here is
 * per-event: what a tile can offer is its link, its id, and the way out.
 * "Mark as read" is deliberately absent — a space means "every channel in it",
 * which is a space-wide read action the shell does not have yet.
 */

import { matrixRoomLink } from "../links.ts";

export type SpaceMenuAction = "copy-link" | "copy-id" | "leave";

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

export function buildSpaceMenu(spaceId: string, canonicalAlias?: string | null): SpaceMenu {
    return {
        entries: [
            item("copy-link", "Copy link"),
            item("copy-id", "Copy space ID"),
            { kind: "separator", id: "separator-destructive" },
            item("leave", "Leave space", true),
        ],
        spaceLink: matrixRoomLink(spaceId, canonicalAlias),
    };
}
