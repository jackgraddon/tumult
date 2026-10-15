import { inject, type InjectionKey, type Ref } from "vue";
import type { ThemeDensity, ThemeEntry, ThemeMode, ValidationIssue } from "@tumult/theme";

/**
 * The theme seam between the app and the UI.
 *
 * `@tumult/ui` renders the Appearance settings tab (and the token editor), but
 * it must not know where themes are stored or how the DOM is themed — that is
 * app business (localStorage, `data-theme`, injected `<style>` elements). So the
 * app implements this interface (see `apps/web/src/theme/controller.ts`),
 * provides it above the shell, and the tab talks only to it. A host that does
 * not provide one simply gets no Appearance tab.
 */
export interface ThemeState {
    /** Active theme name; `DEFAULT_THEME_NAME` for the built-in theme. */
    active: string;
    mode: ThemeMode;
    /** Modes the active theme implements, base mode first. */
    modes: string[];
    density: ThemeDensity;
    /** Densities the active theme implements, base density first. */
    densities: string[];
    /** Built-in theme first, then user themes (including unusable ones). */
    themes: ThemeEntry[];
    /** Raw advanced CSS the user opted into, `""` when unused. */
    advancedCss: string;
}

export interface ThemeResult {
    ok: boolean;
    /** Errors when refused; warnings and infos when accepted. */
    issues: ValidationIssue[];
}

/**
 * One installable theme from the gallery the app ships (`public/themes/`).
 * Presentation only: the document itself is fetched at install time, so the
 * gallery index carries a title, a blurb and swatch colours, never the tokens.
 */
export interface ThemeGalleryEntry {
    /** Slug, and the `name` of the document it installs. */
    id: string;
    title: string;
    description: string;
    /** Swatch colours (e.g. the accent and its hover) to preview the row. */
    swatch: string[];
}

export interface ThemeControls {
    /** Reactive snapshot; re-read on every mutation. */
    state: Ref<ThemeState>;
    /**
     * The built-in theme's token values (`themes/default.json`): the complete
     * document every sparse draft inherits from. Read-only — used to resolve
     * swatches and to show a token's default as a placeholder; the registry
     * itself carries structure only.
     */
    readonly defaults: Record<string, string>;
    /** Shipped gallery themes; empty until `loadGallery` resolves, or on failure. */
    readonly gallery: Ref<ThemeGalleryEntry[]>;
    select(name: string): void;
    setMode(mode: ThemeMode): void;
    setDensity(density: ThemeDensity): void;
    /** Validate + store a document (JSON text or a parsed value) and activate it. */
    install(input: unknown): ThemeResult;
    /**
     * Fetch the shipped gallery index once (idempotent; a failure is silent and
     * leaves `gallery` empty). The tab calls this on mount so the app does not
     * pay for a gallery nobody opened.
     */
    loadGallery(): void;
    /** Fetch and install one gallery theme by its `id`. */
    installGallery(id: string): Promise<ThemeResult>;
    remove(name: string): void;
    /**
     * Live preview: apply an unsaved document to the document without storing
     * it. The last valid preview stays applied while the draft is broken, and
     * `endPreview` restores the stored selection.
     */
    preview(input: unknown): ThemeResult;
    endPreview(): void;
    setAdvancedCss(css: string): ThemeResult;
    /** Back to the built-in theme: no user themes, no advanced CSS. */
    reset(): void;
}

export const ThemeKey: InjectionKey<ThemeControls> = Symbol("tumult/theme");

export function useTheme(): ThemeControls {
    const controls = inject(ThemeKey, null);
    if (!controls) throw new Error("[tumult] no theme controller was provided above this component");
    return controls;
}

/**
 * Like `useTheme`, but `null` instead of a throw. The shell uses it to decide
 * whether to offer the Appearance tab at all.
 */
export function tryUseTheme(): ThemeControls | null {
    return inject(ThemeKey, null);
}
