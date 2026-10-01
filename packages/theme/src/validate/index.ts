import { TOKEN_MAP } from "../registry/index.ts";
import { parseDocument } from "./document.ts";
import { suggestToken } from "./suggest.ts";
import { isValidValue } from "./values.ts";
import { extractRefs, findCycle, hasUrl } from "./references.ts";
import type { ValidationIssue, ValidationResult } from "./issues.ts";

/**
 * Validate a theme document. Collects ALL issues in one pass and never throws —
 * the emitter must only accept input that passed through here.
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

    const names = [...TOKEN_MAP.keys()];

    // Unknown tokens: typo'd tokens are silently dropped by CSS, so this is an error.
    for (const key of Object.keys(doc.tokens)) {
        if (!TOKEN_MAP.has(key)) {
            const suggestion = suggestToken(key, names);
            issues.push({
                code: "unknown-token",
                severity: "error",
                token: key,
                message: `Unknown token "${key}".`,
                ...(suggestion ? { suggestion } : {}),
            });
        }
    }

    // Missing tokens: structural fallback covers them, so info only.
    for (const name of names) {
        if (!(name in doc.tokens)) {
            issues.push({
                code: "missing-token",
                severity: "info",
                token: name,
                message: `Token "${name}" not set; structural default applies.`,
            });
        }
    }

    // Build ref edges over the effective value (override ?? registry default).
    const edges = new Map<string, string[]>();
    for (const [name, def] of TOKEN_MAP) {
        const raw = doc.tokens[name] ?? def.value;
        edges.set(name, extractRefs(raw));
    }

    for (const [name, def] of TOKEN_MAP) {
        const raw = doc.tokens[name];
        if (raw === undefined) continue;

        if (hasUrl(raw)) {
            issues.push({
                code: "banned-url",
                severity: "error",
                token: name,
                message: `Token "${name}" uses url(), which is banned (exfiltration surface).`,
            });
        }

        if (!isValidValue(def.kind, raw)) {
            issues.push({
                code: "invalid-value",
                severity: "error",
                token: name,
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
                    message: `Component token "${name}" must not reference primitive "${r}"; go through a semantic token.`,
                });
            }
            if (def.tier === "semantic" && target.tier === "component") {
                issues.push({
                    code: "tier-violation",
                    severity: "error",
                    token: name,
                    message: `Semantic token "${name}" must not reference component "${r}".`,
                });
            }
            if (def.tier === "primitive" && target.tier !== "primitive") {
                issues.push({
                    code: "tier-violation",
                    severity: "error",
                    token: name,
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
                message: `Reference cycle: ${cycle.join(" -> ")}.`,
            });
        }
    }

    const valid = !issues.some((i) => i.severity === "error");
    return { valid, issues };
}
