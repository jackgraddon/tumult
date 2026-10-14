/**
 * The registry-free runtime half of theming.
 *
 * Applying a stored theme has to happen *before* the first paint, and the
 * 271-token registry plus the validator are ~50 kB — too much to put in the
 * entry chunk for a `JSON.parse` and a `<style>` append. So the persisted
 * shape, its readers/writers and the injected-CSS guard live in this module,
 * which the app imports as `@tumult/theme/runtime`. The full entry point adds
 * the registry, the validator, the loader and the store — that half only runs
 * once the UI (which owns the theme editor) is on screen.
 *
 * The persisted CSS is a *cache*: it is written by `ThemeStore` (the only
 * writer), so it is emitted from a validated document. The boot path applies
 * it verbatim; re-validating would cost the registry.
 */
import { findExternalStylesheetReferences } from "./css-guard.ts";
import type { ThemeJson } from "./types.ts";

export { findExternalStylesheetReferences };

/**
 * A theme mode is a `data-mode` value: `"dark"` is the base mode and means "no
 * attribute" — every other value selects that theme's `modes.<name>` override
 * block. Themes declare their own modes, so this stays a string.
 */
export type ThemeMode = string;

/** The built-in theme, compiled at build time from `themes/default.json`. */
export const DEFAULT_THEME_NAME = "default";
/** Mode used when `data-mode` is absent, i.e. a theme's base `tokens` map. */
export const DEFAULT_THEME_MODE = "dark";
/**
 * Non-base modes the built-in theme implements. Mirrors `modes` in
 * `themes/default.json`, and `themes.test.ts` fails if the two drift: the app
 * offers these as mode choices, so a stale list would offer a mode the built-in
 * theme does not implement, or hide one it does.
 */
export const DEFAULT_THEME_MODES: readonly string[] = ["light"];

/** One localStorage key holds the whole theme state — one read at boot. */
export const THEME_STORAGE_KEY = "tumult.themes";
/** Storage envelope version; bump when the persisted shape changes. */
export const THEME_STATE_VERSION = 1;

/**
 * A `data-theme` value goes into a CSS selector (`:root[data-theme="…"]`), so a
 * name that could escape the quotes is an error, not a nicety. Mirrored by the
 * validator (`invalid-name`), which is what keeps unvalidated names out of the
 * emitter at all.
 */
export const SAFE_THEME_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Same rule for `data-mode` values. */
export const SAFE_THEME_MODE = /^[A-Za-z0-9-]{1,32}$/;

/** Minimal storage surface (localStorage-shaped), so the store is testable. */
export interface ThemeStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** One persisted theme: the document plus the CSS emitted for it. */
export interface StoredTheme {
    /** Validated theme name (the `data-theme` value this theme scopes). */
    name: string;
    json: ThemeJson;
    /** Cached emission — applied verbatim by the boot path. */
    css: string;
}

export interface StoredThemeState {
    version: number;
    themes: StoredTheme[];
    /** `DEFAULT_THEME_NAME` for the built-in theme, else a stored theme's name. */
    active: string;
    mode: ThemeMode;
    /** Raw advanced CSS (an explicit opt-in), applied after every theme. */
    advancedCss: string;
}

export const EMPTY_THEME_STATE: StoredThemeState = {
    version: THEME_STATE_VERSION,
    themes: [],
    active: DEFAULT_THEME_NAME,
    mode: DEFAULT_THEME_MODE,
    advancedCss: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the persisted state. Never throws and never trusts the payload: a
 * hand-edited or half-written key degrades to the built-in theme rather than
 * breaking boot. Entries are kept even when malformed — the store re-validates
 * them and the UI needs something to show and delete.
 */
export function readThemeState(storage: ThemeStorage): StoredThemeState {
    let raw: string | null = null;
    try {
        raw = storage.getItem(THEME_STORAGE_KEY);
    } catch {
        return { ...EMPTY_THEME_STATE };
    }
    if (raw === null || raw.trim() === "") return { ...EMPTY_THEME_STATE };

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ...EMPTY_THEME_STATE };
    }
    if (!isRecord(parsed)) return { ...EMPTY_THEME_STATE };

    const themes: StoredTheme[] = [];
    if (Array.isArray(parsed["themes"])) {
        for (const entry of parsed["themes"]) {
            const theme = readStoredTheme(entry);
            if (theme) themes.push(theme);
        }
    }

    const active = typeof parsed["active"] === "string" ? parsed["active"] : DEFAULT_THEME_NAME;
    const mode =
        typeof parsed["mode"] === "string" && SAFE_THEME_MODE.test(parsed["mode"])
            ? parsed["mode"]
            : DEFAULT_THEME_MODE;
    const advancedCss = typeof parsed["advancedCss"] === "string" ? parsed["advancedCss"] : "";

    return { version: THEME_STATE_VERSION, themes, active, mode, advancedCss };
}

/** Accepts both the persisted envelope and a bare `ThemeJson` (older data). */
function readStoredTheme(entry: unknown): StoredTheme | null {
    if (!isRecord(entry)) return null;

    if (isRecord(entry["json"])) {
        const json = entry["json"];
        const name = typeof entry["name"] === "string" ? entry["name"] : typeof json["name"] === "string" ? json["name"] : "";
        return { name, json: json as unknown as ThemeJson, css: typeof entry["css"] === "string" ? entry["css"] : "" };
    }

    if (isRecord(entry["tokens"])) {
        const json = entry as unknown as ThemeJson;
        return { name: typeof json.name === "string" ? json.name : "", json, css: "" };
    }
    return null;
}

/**
 * Persist the state. Best-effort: a full or unavailable localStorage is a
 * reason to keep the theme for this session, not to break the settings UI, so
 * the failure is reported as `false` rather than thrown.
 */
export function writeThemeState(storage: ThemeStorage, state: StoredThemeState): boolean {
    try {
        storage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch {
        return false;
    }
}

/**
 * CSS for the active theme: `""` for the built-in theme (its CSS is compiled
 * into the bundle) and for anything the boot path cannot trust — an unsafe name
 * or a theme that was stored without an emission. Callers fall back to
 * `DEFAULT_THEME_NAME`, which is always present.
 */
export function activeThemeCss(state: StoredThemeState): string {
    if (state.active === DEFAULT_THEME_NAME || !SAFE_THEME_NAME.test(state.active)) return "";
    const entry = state.themes.find((theme) => theme.name === state.active);
    return entry?.css ?? "";
}

/** The `data-theme` value the boot path may safely set. */
export function activeThemeName(state: StoredThemeState): string {
    if (state.active === DEFAULT_THEME_NAME) return DEFAULT_THEME_NAME;
    return activeThemeCss(state) === "" ? DEFAULT_THEME_NAME : state.active;
}
