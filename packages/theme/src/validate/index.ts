import { TOKEN_MAP } from "../registry/index.ts";
import { SUPPORTED_TOKEN_CONTRACT_VERSIONS } from "../version.ts";
import { SAFE_THEME_MODE, SAFE_THEME_NAME } from "../runtime.ts";
import { parseDocument } from "./document.ts";
import { suggestToken } from "./suggest.ts";
import { findUnsafeValue, isValidValue } from "./values.ts";
import { extractRefs, findCycle, hasUrl } from "./references.ts";
import type { ValidationIssue, ValidationResult } from "./issues.ts";

/**
 * Validate a theme document. Collects ALL issues in one pass and never throws —
 * the emitter must only accept input that passed through here.
 *
 * Base (default-mode) tokens AND every `modes.*` override map are validated.
 * Mode maps are overrides, so a missing token is not reported for them.
 *
 * Beyond token values this also gates the two things the *selector* is built
 * from (the theme name and each mode key). Themes are now user-supplied at
 * runtime, so a name that could close `:root[data-theme="…"]` is an error
 * rather than an escape hatch — and because `serializeTheme` refuses an invalid
 * result, unvalidated names can never reach a stylesheet.
 */
export function validateTheme(input: unknown): ValidationResult {
    const issues: ValidationIssue[] = [];
    const { doc, error } = parseDocument(input);

    if (!doc) {
        issues.push({
            code: "invalid-envelope",
            severity: "error",
            message: error ?? "Invalid theme envelope.",
        });
        return { valid: false, issues };
    }

    if (!SAFE_THEME_NAME.test(doc.name)) {
        issues.push({
            code: "invalid-name",
            severity: "error",
            message:
                `Theme name "${doc.name}" is not usable: use letters, digits, dots, dashes and ` +
                `underscores, starting with a letter or digit (at most 64 characters).`,
        });
    }

    for (const mode of Object.keys(doc.modes)) {
        if (!SAFE_THEME_MODE.test(mode)) {
            issues.push({
                code: "invalid-mode",
                severity: "error",
                mode,
                message:
                    `Mode name "${mode}" is not usable: use letters, digits and dashes ` +
                    `(at most 32 characters).`,
            });
        }
    }

    if (!SUPPORTED_TOKEN_CONTRACT_VERSIONS.includes(doc.version)) {
        issues.push({
            code: "unsupported-version",
            severity: "warning",
            message: `Theme version ${doc.version} is not supported by this build (${SUPPORTED_TOKEN_CONTRACT_VERSIONS.join(", ")}).`,
        });
    }

    const names = [...TOKEN_MAP.keys()];

    validateScope(doc.tokens, { reportMissing: true }, names, issues);
    for (const [mode, tokens] of Object.entries(doc.modes)) {
        validateScope(tokens, { reportMissing: false, mode, base: doc.tokens }, names, issues);
    }

    const valid = !issues.some((i) => i.severity === "error");
    return { valid, issues };
}

interface ScopeOptions {
    reportMissing: boolean;
    mode?: string;
    base?: Record<string, string>;
}

function validateScope(
    tokens: Record<string, string>,
    opts: ScopeOptions,
    names: readonly string[],
    issues: ValidationIssue[],
): void {
    const mode = opts.mode;
    const at = { ...(mode ? { mode } : {}) };

    // Unknown tokens: typo'd tokens are silently dropped by CSS, so this is an error.
    for (const key of Object.keys(tokens)) {
        if (!TOKEN_MAP.has(key)) {
            const suggestion = suggestToken(key, names);
            issues.push({
                code: "unknown-token",
                severity: "error",
                token: key,
                ...at,
                message: `Unknown token "${key}"${mode ? ` in mode "${mode}"` : ""}.`,
                ...(suggestion ? { suggestion } : {}),
            });
        }
    }

    if (opts.reportMissing) {
        for (const name of names) {
            if (!(name in tokens)) {
                issues.push({
                    code: "missing-token",
                    severity: "info",
                    token: name,
                    message: `Token "${name}" not set; structural default applies.`,
                });
            }
        }
    }

    // Effective values in this scope: scope override ?? base override ?? registry default.
    const effective = new Map<string, string>();
    for (const [name, def] of TOKEN_MAP) {
        effective.set(name, tokens[name] ?? opts.base?.[name] ?? def.value);
    }
    const edges = new Map<string, string[]>();
    for (const [name, value] of effective) edges.set(name, extractRefs(value));

    for (const [name, def] of TOKEN_MAP) {
        const raw = tokens[name];
        if (raw === undefined) continue;

        // Before anything else: a value that can close its declaration is not a
        // bad value of its kind, it is an escape from the stylesheet. Report it
        // alone — every other check below would just pile on.
        const unsafe = findUnsafeValue(raw);
        if (unsafe !== null) {
            issues.push({
                code: "unsafe-value",
                severity: "error",
                token: name,
                ...at,
                message: `Token "${name}" value contains ${unsafe}, which can escape its declaration.`,
            });
            continue;
        }

        if (hasUrl(raw)) {
            issues.push({
                code: "banned-url",
                severity: "error",
                token: name,
                ...at,
                message: `Token "${name}" uses url(), which is banned (exfiltration surface).`,
            });
        }

        if (!isValidValue(def.kind, raw)) {
            issues.push({
                code: "invalid-value",
                severity: "error",
                token: name,
                ...at,
                message: `Token "${name}" has invalid ${def.kind} value "${raw}".`,
            });
        }

        const refs = extractRefs(raw);
        for (const r of refs) {
            if (!TOKEN_MAP.has(r)) {
                const suggestion = suggestToken(r, names);
                issues.push({
                    code: "unknown-reference",
                    severity: "error",
                    token: name,
                    ...at,
                    message: `Token "${name}" references unknown token "${r}".`,
                    ...(suggestion ? { suggestion } : {}),
                });
            }
        }

        // Tier direction: components may only ref semantic/component; semantic may not ref component.
        for (const r of refs) {
            const target = TOKEN_MAP.get(r);
            if (!target) continue;
            if (def.tier === "component" && target.tier === "primitive") {
                issues.push({
                    code: "tier-violation",
                    severity: "error",
                    token: name,
                    ...at,
                    message: `Component token "${name}" must not reference primitive "${r}"; go through a semantic token.`,
                });
            }
            if (def.tier === "semantic" && target.tier === "component") {
                issues.push({
                    code: "tier-violation",
                    severity: "error",
                    token: name,
                    ...at,
                    message: `Semantic token "${name}" must not reference component "${r}".`,
                });
            }
            if (def.tier === "primitive" && target.tier !== "primitive") {
                issues.push({
                    code: "tier-violation",
                    severity: "error",
                    token: name,
                    ...at,
                    message: `Primitive token "${name}" must not reference non-primitive "${r}".`,
                });
            }
        }

        const cycle = findCycle(name, edges);
        if (cycle) {
            issues.push({
                code: "reference-cycle",
                severity: "error",
                token: name,
                ...at,
                message: `Reference cycle: ${cycle.join(" -> ")}.`,
            });
        }
    }
}
