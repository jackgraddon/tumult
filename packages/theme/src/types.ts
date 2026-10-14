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
    /** CSS custom property name without the leading `--`, e.g. `prim-indigo-3`. */
    name: string;
    tier: TokenTier;
    kind: TokenKind;
    /** Default value. Semantic/component defaults are `var(--…)` refs (structural). */
    value: string;
    description: string;
}

/** Optional light (or other non-default) mode override map inside a theme. */
export type ThemeModes = Record<string, Record<string, string>>;

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
}
