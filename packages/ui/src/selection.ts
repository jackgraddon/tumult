import { inject, type InjectionKey } from "vue";

export interface RoomSelection {
    view: "dms" | "guild" | "pane";
    guildId?: string | undefined;
    roomId?: string | undefined;
    /** The workspace pane's id — set only when `view` is `"pane"`. */
    paneId?: string | undefined;
}

export interface SelectionContext {
    current: RoomSelection;
    select(next: RoomSelection): void;
    hrefFor(next: RoomSelection): string;
}

export const SelectionKey: InjectionKey<SelectionContext> = Symbol("tumult/selection");
export function useSelection(): SelectionContext {
    const ctx = inject(SelectionKey);
    if (!ctx) throw new Error("useSelection() requires a SelectionContext provider (TumultShell provides one).");
    return ctx;
}
