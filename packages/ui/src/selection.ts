import { inject, type InjectionKey } from "vue";

export interface RoomSelection {
    view: "dms" | "guild";
    guildId?: string | undefined;
    roomId?: string | undefined;
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
