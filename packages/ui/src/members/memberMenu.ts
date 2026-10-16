import type { MemberView, RoomPowerLevelsView } from "@tumult/core";

import { matrixUserLink } from "../links.ts";

/**
 * The member context menu, as data.
 *
 * The moderation half was previously computed inline in `MemberListItem`; it is
 * here so "who may do what to whom" is unit-tested against the same rule the
 * server applies (strictly below us, never ourselves) rather than by mounting a
 * virtualized row. The copy half needs no permissions at all.
 */

export type MemberMenuAction =
    | "copy-id"
    | "copy-link"
    | "set-power"
    | "kick"
    | "ban"
    | "unban";

export type MemberMenuEntry =
    | { kind: "separator"; id: string }
    | { kind: "item"; id: MemberMenuAction; label: string; danger?: boolean };

export interface MemberMenu {
    entries: readonly MemberMenuEntry[];
    /** `matrix.to` link for this user. */
    userLink: string;
}

export interface MemberMenuOptions {
    /** Power levels for the room, or null while unknown (then no moderation). */
    power: RoomPowerLevelsView | null;
}

function item(id: MemberMenuAction, label: string, danger = false): MemberMenuEntry {
    return { kind: "item", id, label, danger };
}

export function buildMemberMenu(member: MemberView, options: MemberMenuOptions): MemberMenu {
    const userLink = matrixUserLink(member.userId);

    // Moderation is the server's to enforce; these flags only spare the user an
    // obviously doomed action. Everything requires the target to be strictly
    // below us and not us: the same rule the server applies.
    const myPower = options.power?.myPowerLevel ?? 0;
    const belowMe = !member.isSelf && member.powerLevel < myPower;

    const moderation: MemberMenuEntry[] = [];
    if (options.power?.canSetPowerLevel && member.membership !== "ban" && belowMe) {
        moderation.push(item("set-power", "Change permissions…"));
    }
    if (options.power?.canKick && member.membership === "join" && belowMe) {
        moderation.push(item("kick", `Kick ${member.displayName}`, true));
    }
    if (options.power?.canBan && member.membership === "join" && belowMe) {
        moderation.push(item("ban", `Ban ${member.displayName}`, true));
    }
    if (options.power?.canBan && member.membership === "ban" && belowMe) {
        moderation.push(item("unban", `Unban ${member.displayName}`));
    }

    const entries: MemberMenuEntry[] = [
        item("copy-id", "Copy user ID"),
        item("copy-link", "Copy link"),
    ];
    // A banned or invited member has no profile to moderate, but is still a user
    // whose id is worth copying — so the copy pair stands on its own.
    if (moderation.length > 0) {
        entries.push({ kind: "separator", id: "separator-moderation" });
        entries.push(...moderation);
    }

    return { entries, userLink };
}
