/**
 * The built-in theme document, and the rule that it must be complete.
 *
 * Kept apart from `compile.ts` so both the docs generator and the guard test can
 * share the same paths and the same completeness check. Compiling is not a
 * precondition for reading: an incomplete `default.json` is an error here, so a
 * half-written theme can never reach `docs/` either.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_TOKENS } from "../registry/index.ts";
import { DEFAULT_THEME_NAME } from "../runtime.ts";

/**
 * `src/build` and `dist/build` sit at the same depth below the package root, so
 * these resolve identically whether the module is run from source (tests) or
 * compiled (the build CLI).
 */
const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = join(here, "..", "..");
export const themesDir = join(packageRoot, "themes");
export const repoRoot = join(packageRoot, "..", "..");
/** The authored docs this build step regenerates. */
export const docsDir = join(repoRoot, "docs");

/** A theme document as parsed, before validation. */
export interface RawTheme {
    name: string;
    tokens: Record<string, string>;
    modes?: Record<string, Record<string, string>>;
    densities?: Record<string, Record<string, string>>;
}

/**
 * The base stylesheet is compiled from the default theme document, not from
 * literals in code: primitives have no structural default, so a theme file is
 * the only place their values can live. An incomplete default theme therefore
 * fails the build instead of silently emitting `--x: undefined`.
 */
export function requireDefaultTheme(docs: readonly RawTheme[]): RawTheme {
    const def = docs.find((d) => d.name === DEFAULT_THEME_NAME);
    if (!def) {
        throw new Error(`themes/ has no "${DEFAULT_THEME_NAME}" theme, so base.css cannot be compiled`);
    }
    const missing = ALL_TOKENS.filter((t) => !(t.name in def.tokens)).map((t) => t.name);
    if (missing.length > 0) {
        throw new Error(
            `the default theme is incomplete; it must set every token (${missing.length} missing): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`,
        );
    }
    return def;
}

/** Read `themes/default.json` and assert it covers every registry token. */
export function readDefaultTheme(): RawTheme {
    const raw = readFileSync(join(themesDir, `${DEFAULT_THEME_NAME}.json`), "utf8");
    return requireDefaultTheme([JSON.parse(raw) as RawTheme]);
}
