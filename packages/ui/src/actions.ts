import { inject, type InjectionKey } from "vue";
import type { MemberView } from "@tumult/core";

/** The thing a leave is about: room id plus enough display state to say so. */
export interface LeaveTarget {
    id: string;
    name: string;
    isSpace: boolean;
}

/** What a member row can ask the shell to do. */
export type MemberModerationKind = "kick" | "ban" | "unban" | "set-power";

/** A moderation request from a member row, scoped to the room it came from. */
export interface MemberModeration {
    kind: MemberModerationKind;
    roomId: string;
    member: MemberView;
}

/**
 * Slice 20's one cross-pane action channel: a ContextMenu inside a list item
 * can't reach the shell that owns the confirm dialog, so it asks instead.
 *
 * Leave and moderation live here because both originate in list rows;
 * everything else (create/join/dm/invite) opens from a header button the shell
 * already owns, so it needs no channel.
 */
export interface ActionsContext {
    requestLeave(target: LeaveTarget): void;
    requestModeration(action: MemberModeration): void;
    /**
     * Mark a room read from a list row (the room list pane holds no client).
     * `markRead` is a plain client call, not a dialog: the shell runs it and
     * the resulting sync clears the badge.
     */
    requestMarkRead(roomId: string): void;
}

export const ActionsKey: InjectionKey<ActionsContext> = Symbol("tumult/actions");
export function useActions(): ActionsContext {
    const ctx = inject(ActionsKey);
    if (!ctx) throw new Error("useActions() requires an ActionsContext provider (TumultShell provides one).");
    return ctx;
}
