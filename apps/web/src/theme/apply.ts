/**
 * DOM application of the theme.
 *
 * This module is deliberately registry-free: it imports only
 * `@tumult/theme/runtime` (the persisted shape plus the CSS guard), so
 * `main.ts` can apply the stored theme before the first paint without pulling
 * the 271-token registry or `@tumult/ui` into the entry chunk.
 *
 * Two dataset attributes plus three ordered `<style>` slots carry the whole
 * state. Attribute `data-theme` scopes the emitted theme CSS
 * (`:root[data-theme="…"]`); `data-mode` selects a mode override block and is
 * *absent* for the base mode; `data-density` selects a density override block
 * and is *absent* for the base density. The slots are ordered so a later one
 * wins:
 *
 *   active   — the stored theme's emitted CSS
 *   preview  — an unsaved draft from the editor
 *   advanced — the user's raw advanced CSS (explicit opt-in, guarded)
 *
 * Everything here is a plain DOM write, so the boot path can call it and the
 * reactive controller can call it again on every change.
 */
import {
    DEFAULT_THEME_DENSITY,
    DEFAULT_THEME_MODE,
    activeThemeCss,
    activeThemeName,
    findExternalStylesheetReferences,
    readThemeState,
} from "@tumult/theme/runtime";
import type { ThemeDensity, ThemeMode } from "@tumult/theme/runtime";

/** The three stylesheet slots, in cascade order (last wins). */
export type ThemeSlot = "active" | "preview" | "advanced";

const SLOT_ORDER: readonly ThemeSlot[] = ["active", "preview", "advanced"];

const elements = new Map<ThemeSlot, HTMLStyleElement>();

/**
 * Set (or clear, with `""`) one slot. Slots are re-appended in `SLOT_ORDER`
 * every time, because a stylesheet's position in `<head>` is what decides which
 * slot wins — a slot created late must not land before one it should override.
 */
export function setThemeSlot(name: ThemeSlot, css: string): void {
    const existing = elements.get(name);
    if (css === "") {
        if (existing) {
            existing.remove();
            elements.delete(name);
        }
        return;
    }

    let element = existing;
    if (!element) {
        element = document.createElement("style");
        element.dataset["tumultTheme"] = name;
        elements.set(name, element);
    }
    element.textContent = css;

    for (const slot of SLOT_ORDER) {
        const current = elements.get(slot);
        if (current) document.head.append(current);
    }
}

/**
 * Scope a theme to the document. The base mode (and base density) means no
 * attribute at all.
 */
export function setDocumentTheme(name: string, mode: ThemeMode, density: ThemeDensity): void {
    const root = document.documentElement;
    root.dataset["theme"] = name;
    if (mode === DEFAULT_THEME_MODE) delete root.dataset["mode"];
    else root.dataset["mode"] = mode;
    if (density === DEFAULT_THEME_DENSITY) delete root.dataset["density"];
    else root.dataset["density"] = density;
}

/**
 * Apply advanced CSS, refusing anything that could fetch a remote resource.
 * Returns the offending declarations (empty when applied). The store in the UI
 * half rejects these before they are persisted; this is the second gate, for
 * CSS that arrived by a hand-edited localStorage key.
 */
export function applyAdvancedCss(css: string): string[] {
    const external = findExternalStylesheetReferences(css);
    if (external.length > 0) return external;
    setThemeSlot("advanced", css);
    return [];
}

/**
 * The pre-paint path: apply whatever is persisted. Never throws — a malformed
 * key just means the built-in theme, which is always present in the bundle.
 */
export function bootTheme(): void {
    const state = readThemeState(localStorage);
    setDocumentTheme(activeThemeName(state), state.mode, state.density);
    setThemeSlot("active", activeThemeCss(state));

    const rejected = applyAdvancedCss(state.advancedCss);
    if (rejected.length > 0) {
        // Unreachable through the UI — `ThemeStore.setAdvancedCss` refuses these
        // — so it can only be a hand-edited key. Say so instead of applying it.
        console.warn(`[tumult] ignoring stored advanced CSS with external references: ${rejected.join(", ")}`);
    }
}
