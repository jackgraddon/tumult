import type { ThemeGalleryEntry } from "@tumult/ui";

/**
 * Parse the shipped gallery index (`public/themes/index.json`).
 *
 * Pure and dependency-free so a test can hold the shipped file to the same
 * contract the app reads it by. Entries are skipped rather than the whole list
 * failing: one typo in the index should cost one row, not the gallery. The
 * document itself is not in the index — it is fetched per install, so a
 * gallery entry can never smuggle tokens the validator did not see.
 */
export function parseGallery(data: unknown): ThemeGalleryEntry[] {
    if (typeof data !== "object" || data === null) return [];
    const themes = (data as { themes?: unknown }).themes;
    if (!Array.isArray(themes)) return [];

    const entries: ThemeGalleryEntry[] = [];
    const seen = new Set<string>();
    for (const item of themes) {
        if (typeof item !== "object" || item === null) continue;
        const { id, title, description, swatch } = item as Record<string, unknown>;
        if (typeof id !== "string" || id === "" || seen.has(id)) continue;
        if (typeof title !== "string" || typeof description !== "string") continue;
        if (!Array.isArray(swatch) || swatch.some((colour) => typeof colour !== "string")) continue;
        seen.add(id);
        entries.push({ id, title, description, swatch: [...swatch] as string[] });
    }
    return entries;
}
