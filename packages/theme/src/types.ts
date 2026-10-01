export type TokenTier = "primitive" | "semantic" | "component";
export type TokenKind = "color" | "spacing" | "radius" | "typography" | "motion" | "layout";

export interface TokenDef {
    /** CSS custom property name without the leading `--`, e.g. `prim-indigo-3`. */
    name: string;
    tier: TokenTier;
    kind: TokenKind;
    /** Default value. Semantic/component defaults are `var(--…)` refs (structural). */
    value: string;
    description: string;
}

/** On-disk theme file envelope. */
export interface ThemeJson {
    version: number;
    name: string;
    tokens: Record<string, string>;
}
