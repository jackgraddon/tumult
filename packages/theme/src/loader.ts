/**
 * The runtime half of the JSON pipeline: untrusted document in, validated
 * document plus emitted CSS (or a refusal) out. Never throws.
 *
 * The plan called this "validate against schema (Zod), version check, unknown
 * token warnings, cycle/var resolution checks". There is no Zod dependency:
 * `validate/` is the hand-rolled validator that already collects every issue in
 * one pass, with did-you-mean suggestions, per-mode scoping, reference-cycle
 * detection, tier rules, value grammars and the selector/escape guards. What
 * was missing for *user* themes is this seam — one call that turns pasted JSON
 * into either CSS or the list of reasons it cannot be applied — plus the store
 * in `store.ts` that persists the result.
 */
import { serializeTheme } from "./emit/serialize.ts";
import { parseDocument, toThemeJson } from "./validate/document.ts";
import { validateTheme } from "./validate/index.ts";
import { TOKEN_CONTRACT_VERSION } from "./version.ts";
import type { ThemeJson } from "./types.ts";
import type { ValidationResult } from "./validate/issues.ts";

export interface LoadedTheme {
    /** Validated name; `""` when the document had no usable one. */
    name: string;
    /** Normalized document — safe to edit, export and reload. */
    json: ThemeJson;
    validation: ValidationResult;
    /**
     * Emitted CSS, or `null` when the document has errors. `null` is the
     * contract callers key off: nothing may be injected for a refused theme.
     */
    css: string | null;
}

/** Errors are what make a document unusable; warnings and infos are advisory. */
export function hasErrors(result: ValidationResult): boolean {
    return result.issues.some((issue) => issue.severity === "error");
}

function emptyDocument(name = ""): ThemeJson {
    return { version: TOKEN_CONTRACT_VERSION, name, tokens: {} };
}

/**
 * Validate + normalize an untrusted theme document.
 *
 * A refused document still returns its normalized `json` (so an editor can load
 * and fix it) and its validation result (so the UI can explain the refusal);
 * only `css` is withheld.
 */
export function loadTheme(input: unknown): LoadedTheme {
    const validation = validateTheme(input);
    const { doc } = parseDocument(input);

    if (!doc) {
        return { name: "", json: emptyDocument(), validation, css: null };
    }

    const json = toThemeJson(doc);
    const css = hasErrors(validation)
        ? null
        : serializeTheme({ name: doc.name, tokens: doc.tokens, modes: doc.modes, densities: doc.densities, validation });

    return { name: doc.name, json, validation, css };
}

/** `loadTheme` for the paste path: JSON syntax errors become validation issues. */
export function loadThemeText(text: string): LoadedTheme {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return {
            name: "",
            json: emptyDocument(),
            validation: {
                valid: false,
                issues: [{ code: "invalid-envelope", severity: "error", message: `Not valid JSON: ${message}` }],
            },
            css: null,
        };
    }
    return loadTheme(parsed);
}
