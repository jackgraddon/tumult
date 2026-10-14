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

export interface ThemeControls {
    /** Reactive snapshot; re-read on every mutation. */
    state: Ref<ThemeState>;
    select(name: string): void;
    setMode(mode: ThemeMode): void;
    setDensity(density: ThemeDensity): void;
    /** Validate + store a document (JSON text or a parsed value) and activate it. */
    install(input: unknown): ThemeResult;
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
