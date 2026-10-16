import type { MessageView, RoomPowerLevelsView } from "@tumult/core";

import { matrixEventLink } from "../links.ts";

/**
 * The message context menu, as data.
 *
 * Keeping the menu a plain list makes the permission logic — which depends on
 * the message, the room's power levels and which handlers the row was given —
 * unit-testable without mounting a virtualized row. `TimelineRow` renders
 * whatever comes back and dispatches the `id`; no "who may do what" lives in
 * the template.
 */

/** Fixed palette; the OS picker covers the long tail. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👀", "🚀"] as const;

/** How many palette entries the inline row offers before the submenu. */
const INLINE_REACTIONS = 4;

/** What an item does. `TimelineRow` owns the handlers behind each one. */
export type MessageMenuAction =
    | "reply"
    | "edit"
    | "thread"
    | "copy-text"
    | "copy-link"
    | "copy-id"
    | "view-source"
    | "delete";

export type MessageMenuEntry =
    | { kind: "separator"; id: string }
    | { kind: "submenu"; id: "add-reaction"; label: string; emojis: readonly string[] }
    | { kind: "item"; id: MessageMenuAction; label: string; danger: boolean };

export interface MessageMenuOptions {
    /** The room the message lives in: the room half of the `matrix.to` link. */
    roomId: string;
    /** Our user id, or null while signed out (then nothing is "someone else's"). */
    selfId: string | null;
    /** The room's power levels, or null while unknown (then no moderation). */
    power: RoomPowerLevelsView | null;
    /** Replies hanging off this message; labels the thread item. */
    threadReplyCount: number;
    /** A reaction handler is wired; absent disables reacting (fake-safe). */
    canReact: boolean;
    /** The row's own reply gate: handler + real, decrypted server id. */
    canReply: boolean;
    /** The row's own edit gate: handler + our own live, decrypted message. */
    canEdit: boolean;
    /** The row's own delete gate: handler + our own live, decrypted message. */
    canDeleteOwn: boolean;
    /** Any redact handler is wired — a moderation delete needs one too. */
    canDelete: boolean;
    /** A thread handler is wired and the server supports threads. */
    canOpenThread: boolean;
}

export interface MessageMenu {
    /** Emoji offered inline at the top; empty when we cannot react. */
    quickReactions: readonly string[];
    /** Full palette for the "Add reaction" submenu. */
    reactions: readonly string[];
    /** Items in render order, separators included. */
    entries: readonly MessageMenuEntry[];
    /** Canonical `matrix.to` link, or null when there is no server id to link. */
    matrixLink: string | null;
}

function item(id: MessageMenuAction, label: string, danger = false): MessageMenuEntry {
    return { kind: "item", id, label, danger };
}

/**
 * Whether the menu should offer Delete on this message.
 *
 * Our own live message always can be; someone else's only when we sit strictly
 * above them — the same rule the server applies, so the menu never offers an
 * action the server is about to refuse.
 */
function deletable(message: MessageView, options: MessageMenuOptions): boolean {
    // A tombstone cannot die twice, and an unsent echo has no server event yet.
    if (message.redacted || message.status !== "sent") return false;
    if (options.canDeleteOwn) return true;

    const { power, selfId } = options;
    if (!power || selfId === null) return false;
    if (message.senderId === selfId) return false;
    const senderLevel = power.users[message.senderId] ?? power.usersDefault;
    return power.myPowerLevel >= power.redact && senderLevel < power.myPowerLevel;
}

export function buildMessageMenu(message: MessageView, options: MessageMenuOptions): MessageMenu {
    const decrypted = message.decryption === "ok";
    // A tombstone has no payload left: nothing to copy, edit or inspect.
    const readable = decrypted && !message.redacted;
    // Only a message the server has accepted has an id worth linking.
    const serverId = message.status === "sent";

    const reactions = options.canReact && decrypted ? QUICK_REACTIONS : [];
    const matrixLink = serverId && readable ? matrixEventLink(options.roomId, message.id) : null;

    const conversation: MessageMenuEntry[] = [];
    if (options.canReply) conversation.push(item("reply", "Reply"));
    if (options.canEdit) conversation.push(item("edit", "Edit message"));
    if (options.canOpenThread && decrypted) {
        conversation.push(item("thread", options.threadReplyCount > 0 ? "View thread" : "Create thread"));
    }

    const clipboard: MessageMenuEntry[] = [];
    if (readable && message.body.length > 0) clipboard.push(item("copy-text", "Copy text"));
    if (matrixLink !== null) clipboard.push(item("copy-link", "Copy link"));
    if (matrixLink !== null) clipboard.push(item("copy-id", "Copy message ID"));
    if (readable) clipboard.push(item("view-source", "View source"));

    const destructive: MessageMenuEntry[] = [];
    if (options.canDelete && deletable(message, options)) {
        destructive.push(item("delete", "Delete message", true));
    }

    // Related actions, separated so a destructive item never sits right next to
    // a copy item. Empty groups drop out (and take their separator with them).
    const entries: MessageMenuEntry[] = [];
    for (const [index, group] of [conversation, clipboard, destructive].entries()) {
        if (group.length === 0) continue;
        if (entries.length > 0) entries.push({ kind: "separator", id: `separator-${index}` });
        entries.push(...group);
    }

    // The reaction submenu belongs with the inline row at the very top.
    if (reactions.length > 0) {
        entries.unshift({
            kind: "submenu",
            id: "add-reaction",
            label: "Add reaction",
            emojis: reactions,
        });
    }

    return {
        quickReactions: reactions.slice(0, INLINE_REACTIONS),
        reactions,
        entries,
        matrixLink,
    };
}
