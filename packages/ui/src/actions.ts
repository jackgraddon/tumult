import { inject, type InjectionKey } from "vue";

/** The thing a leave is about: room id plus enough display state to say so. */
export interface LeaveTarget {
    id: string;
    name: string;
    isSpace: boolean;
}

/**
 * Slice 20's one cross-pane action channel: a ContextMenu inside a list item
 * can't reach the shell that owns the confirm dialog, so it asks instead.
 *
 * Only `requestLeave` lives here — everything else (create/join/dm/invite)
 * opens from a header button the shell already owns, so it needs no channel.
 */
export interface ActionsContext {
    requestLeave(target: LeaveTarget): void;
}

export const ActionsKey: InjectionKey<ActionsContext> = Symbol("tumult/actions");
export function useActions(): ActionsContext {
    const ctx = inject(ActionsKey);
    if (!ctx) throw new Error("useActions() requires an ActionsContext provider (TumultShell provides one).");
    return ctx;
}
