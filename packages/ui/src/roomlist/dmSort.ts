import type { OrphanSort } from "@tumult/core/selectors";

/** Device-local preference; a sort order is a view choice, not Matrix state. */
const STORAGE_KEY = "tumult.dmSort";
const MODES: readonly OrphanSort[] = ["recency", "name", "unread"];

/** Recency is what chat apps do; anything else is an explicit choice. */
export function readDmSort(): OrphanSort {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return MODES.find((mode) => mode === raw) ?? "recency";
    } catch {
        return "recency";
    }
}

export function writeDmSort(sort: OrphanSort): void {
    try {
        localStorage.setItem(STORAGE_KEY, sort);
    } catch {
        // A blocked/full store must not break sorting for this session.
    }
}
