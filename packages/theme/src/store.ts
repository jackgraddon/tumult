/**
 * User-theme management: list, upsert, select, mode, density, advanced CSS,
 * reset — persisted through a `ThemeStorage`, so it is testable without a
 * browser and the app only supplies `localStorage`.
 *
 * Every write goes through the loader, which means the persisted `css` cache is
 * always emitted from a validated document and the boot path (`runtime.ts`) can
 * apply it without the registry. Nothing here is reactive: the app wraps it in
 * its own reactive snapshot.
 */
import { loadTheme, loadThemeText } from "./loader.ts";
import {
    DEFAULT_THEME_DENSITIES,
    DEFAULT_THEME_DENSITY,
    DEFAULT_THEME_MODE,
    DEFAULT_THEME_MODES,
    DEFAULT_THEME_NAME,
    EMPTY_THEME_STATE,
    SAFE_THEME_DENSITY,
    SAFE_THEME_MODE,
    activeThemeCss,
    activeThemeName,
    findExternalStylesheetReferences,
    readThemeState,
    writeThemeState,
} from "./runtime.ts";
import type { ThemeJson } from "./types.ts";
import type { ThemeDensity, ThemeMode, ThemeStorage, StoredTheme, StoredThemeState } from "./runtime.ts";
import type { ValidationIssue, ValidationResult } from "./validate/issues.ts";

/**
 * A theme as the UI sees it: the document, its emitted CSS (`""` when the
 * document has errors, in which case it cannot be selected) and the validation
 * result to explain either way.
 */
export interface ThemeEntry {
    name: string;
    json: ThemeJson;
    css: string;
    validation: ValidationResult;
}

export type ThemeSaveResult =
    | { ok: true; entry: ThemeEntry }
    | { ok: false; issues: ValidationIssue[] };

export type ThemeCssResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

const DEFAULT_THEME_ENTRY: ThemeEntry = {
    name: DEFAULT_THEME_NAME,
    json: { version: 0, name: DEFAULT_THEME_NAME, tokens: {} },
    css: "",
    validation: { valid: true, issues: [] },
};

function errorIssue(code: ValidationIssue["code"], message: string): ValidationIssue {
    return { code, severity: "error", message };
}

export class ThemeStore {
    private entries: ThemeEntry[];
    private activeName: string;
    private themeMode: ThemeMode;
    private themeDensity: ThemeDensity;
    private advanced = "";
    private readonly storage: ThemeStorage;

    public constructor(storage: ThemeStorage) {
        this.storage = storage;
        const persisted = readThemeState(storage);
        this.entries = persisted.themes.map((theme) => this.reconcile(theme));
        this.activeName = this.pickActive(persisted.active);
        this.themeMode = persisted.mode;
        this.themeDensity = persisted.density;
        this.advanced = persisted.advancedCss;

        // The cache is written by us, so a mismatch means the emitter (or the
        // contract) changed under it — rewrite rather than keep serving stale CSS.
        if (this.entries.some((entry, index) => entry.css !== persisted.themes[index]?.css)) {
            this.persist();
        }
    }

    /** Re-load a persisted theme; its cached CSS may predate this build. */
    private reconcile(theme: StoredTheme): ThemeEntry {
        // `loadTheme` never throws (the validator collects instead), so a stored
        // document that no longer validates becomes a listed entry with no CSS
        // and its issues — never a failed boot.
        const loaded = loadTheme(theme.json);
        if (loaded.css === null) {
            return { name: loaded.name || theme.name, json: loaded.json, css: "", validation: loaded.validation };
        }
        return { name: loaded.name, json: loaded.json, css: loaded.css, validation: loaded.validation };
    }

    /** A stored selection is only honoured while it still points at a usable theme. */
    private pickActive(name: string): string {
        if (name === DEFAULT_THEME_NAME) return DEFAULT_THEME_NAME;
        return this.entries.some((entry) => entry.name === name && entry.css !== "") ? name : DEFAULT_THEME_NAME;
    }

    private persist(): void {
        const state: StoredThemeState = {
            version: EMPTY_THEME_STATE.version,
            themes: this.entries.map((entry) => ({ name: entry.name, json: entry.json, css: entry.css })),
            active: this.activeName,
            mode: this.themeMode,
            density: this.themeDensity,
            advancedCss: this.advanced,
        };
        writeThemeState(this.storage, state);
    }

    /** Stored themes: the built-in default first, then everything the user added. */
    public list(): ThemeEntry[] {
        return [DEFAULT_THEME_ENTRY, ...this.entries];
    }

    public active(): string {
        return this.activeName;
    }

    public mode(): ThemeMode {
        return this.themeMode;
    }

    public density(): ThemeDensity {
        return this.themeDensity;
    }

    public advancedCss(): string {
        return this.advanced;
    }

    /** CSS for the active selection; `""` for the built-in theme. */
    public activeCss(): string {
        if (this.activeName === DEFAULT_THEME_NAME) return "";
        return this.entries.find((entry) => entry.name === this.activeName)?.css ?? "";
    }

    /** Modes the active theme declares, base mode first. */
    public activeModes(): string[] {
        const declared = Object.keys(this.activeJson()?.modes ?? {});
        const extra = this.activeName === DEFAULT_THEME_NAME ? DEFAULT_THEME_MODES : declared;
        return [DEFAULT_THEME_MODE, ...extra.filter((mode) => mode !== DEFAULT_THEME_MODE)];
    }

    /**
     * Densities the active theme declares, base density (`cozy`) first.
     *
     * A theme need not declare `cozy`: like the base mode it is the theme's
     * unmodified `tokens` map, so it is always a real choice. Other names are
     * the theme's own `densities.*` overrides.
     */
    public activeDensities(): string[] {
        const declared = Object.keys(this.activeJson()?.densities ?? {});
        const extra = this.activeName === DEFAULT_THEME_NAME ? DEFAULT_THEME_DENSITIES : declared;
        return [DEFAULT_THEME_DENSITY, ...extra.filter((density) => density !== DEFAULT_THEME_DENSITY)];
    }

    private activeJson(): ThemeJson | undefined {
        if (this.activeName === DEFAULT_THEME_NAME) return undefined;
        return this.entries.find((entry) => entry.name === this.activeName)?.json;
    }

    /**
     * Validate + upsert a document (raw JSON text or a parsed value). A document
     * with errors is refused and nothing is stored — `issues` is the whole
     * explanation. A valid document becomes the active theme.
     */
    public save(input: unknown): ThemeSaveResult {
        const loaded = typeof input === "string" ? loadThemeText(input) : loadTheme(input);

        // `css` is null exactly when the document has errors, and it is the
        // emitter's own gate — refuse on it rather than re-deriving the rule.
        if (loaded.css === null) {
            return { ok: false, issues: loaded.validation.issues };
        }
        if (loaded.name === DEFAULT_THEME_NAME) {
            // Reserved: the built-in theme's CSS is compiled at build time, and
            // two `:root[data-theme="default"]` blocks would be indistinguishable.
            return {
                ok: false,
                issues: [
                    errorIssue(
                        "invalid-name",
                        `"${DEFAULT_THEME_NAME}" is reserved for the built-in theme; pick another name.`,
                    ),
                ],
            };
        }

        const entry: ThemeEntry = {
            name: loaded.name,
            json: loaded.json,
            css: loaded.css,
            validation: loaded.validation,
        };
        const at = this.entries.findIndex((existing) => existing.name === entry.name);
        if (at >= 0) this.entries[at] = entry;
        else this.entries.push(entry);

        this.activeName = entry.name;
        this.normalizeMode();
        this.normalizeDensity();
        this.persist();
        return { ok: true, entry };
    }

    /** Remove every entry with this name. Returns whether anything was removed. */
    public remove(name: string): boolean {
        if (name === DEFAULT_THEME_NAME) return false;
        const before = this.entries.length;
        this.entries = this.entries.filter((entry) => entry.name !== name);
        if (this.entries.length === before) return false;
        if (this.activeName === name) this.activeName = DEFAULT_THEME_NAME;
        this.persist();
        return true;
    }

    /** Select the built-in theme or a usable stored one. */
    public select(name: string): boolean {
        if (name !== DEFAULT_THEME_NAME && !this.entries.some((entry) => entry.name === name && entry.css !== "")) {
            return false;
        }
        this.activeName = name;
        this.normalizeMode();
        this.normalizeDensity();
        this.persist();
        return true;
    }

    /**
     * A mode only means something if the active theme implements it; otherwise
     * the base map applies and the label would be a lie. Called whenever the
     * active theme changes.
     */
    private normalizeMode(): void {
        if (!this.activeModes().includes(this.themeMode)) this.themeMode = DEFAULT_THEME_MODE;
    }

    public setMode(mode: ThemeMode): boolean {
        if (!SAFE_THEME_MODE.test(mode)) return false;
        this.themeMode = mode;
        this.persist();
        return true;
    }

    /**
     * A density only means something if the active theme implements it; a stale
     * value would apply a block that does not exist and relabel the choice.
     * Called whenever the active theme changes.
     */
    private normalizeDensity(): void {
        if (!this.activeDensities().includes(this.themeDensity)) this.themeDensity = DEFAULT_THEME_DENSITY;
    }

    public setDensity(density: ThemeDensity): boolean {
        if (!SAFE_THEME_DENSITY.test(density)) return false;
        this.themeDensity = density;
        this.persist();
        return true;
    }

    /**
     * Store advanced CSS. The opt-in is explicit in the UI; what is enforced
     * here is that it cannot become a third-party request (`@import`, remote
     * `url()`), the same rule plugin stylesheets live under.
     */
    public setAdvancedCss(css: string): ThemeCssResult {
        const external = findExternalStylesheetReferences(css);
        if (external.length > 0) {
            return {
                ok: false,
                issues: [
                    errorIssue(
                        "banned-url",
                        `Advanced CSS cannot reference external resources (${external.join(", ")}). ` +
                            `Inline images as data: URLs.`,
                    ),
                ],
            };
        }
        this.advanced = css;
        this.persist();
        return { ok: true };
    }

    /** Back to the built-in theme: no user themes, no advanced CSS, dark mode. */
    public reset(): void {
        this.entries = [];
        this.activeName = DEFAULT_THEME_NAME;
        this.themeMode = DEFAULT_THEME_MODE;
        this.themeDensity = DEFAULT_THEME_DENSITY;
        this.advanced = "";
        this.persist();
    }
}

export { DEFAULT_THEME_MODE, DEFAULT_THEME_DENSITY, DEFAULT_THEME_NAME, activeThemeCss, activeThemeName };
export type { ThemeDensity, ThemeMode, ThemeStorage, StoredTheme, StoredThemeState };
