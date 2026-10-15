export type TokenTier = "primitive" | "semantic" | "component";
export type TokenKind =
    | "color"
    | "spacing"
    | "radius"
    | "typography"
    | "motion"
    | "layout"
    | "size"
    | "shadow"
    | "z-index"
    | "line-height"
    | "letter-spacing"
    | "font-weight"
    | "border-width"
    | "opacity";

export interface TokenDef {
    /** CSS custom property name without the leading `--`, e.g. `prim-brand-3`. */
    name: string;
    tier: TokenTier;
    kind: TokenKind;
    /**
     * Structural default, when the tier has one: a `var(--…)` reference for a
     * semantic/component token. Primitives (the leaves) and tokens whose default
     * is a literal — an overlay wash, a dialog width — have no value at all;
     * their values live in the theme document (`themes/default.json`).
     */
    value?: string;
    description: string;
}

/** Optional light (or other non-default) mode override map inside a theme. */
export type ThemeModes = Record<string, Record<string, string>>;
export type ThemeDensities = Record<string, Record<string, string>>;

/** On-disk theme file envelope. */
export interface ThemeJson {
    version: number;
    name: string;
    tokens: Record<string, string>;
    /**
     * Per-mode token overrides (e.g. `light`). Applied on
     * `:root[data-theme="name"][data-mode="mode"]`. The base `tokens` map is the
     * default (dark) mode.
     */
    modes?: ThemeModes;
    /**
     * Per-density token overrides (e.g. `compact`, `cozy`, `spacious`). Applied on
     * `:root[data-theme="name"][data-density="density"]`.
     */
    densities?: ThemeDensities;
}
