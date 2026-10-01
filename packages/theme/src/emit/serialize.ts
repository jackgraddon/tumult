import type { ValidationResult } from "../validate/issues.ts";

export interface EmitInput {
    name: string;
    tokens: Record<string, string>;
    validation: ValidationResult;
}

/**
 * Serialize validated theme tokens to CSS. Accepts ONLY a ValidationResult —
 * the discriminated-union gate so unvalidated input cannot reach the emitter.
 */
export function serializeTheme(input: EmitInput): string {
    if (!input.validation.valid) {
        throw new Error("Refusing to emit CSS for an invalid theme.");
    }
    const keys = Object.keys(input.tokens).sort();
    const lines: string[] = [`:root[data-theme="${input.name}"] {`];
    for (const k of keys) {
        lines.push(`    --${k}: ${input.tokens[k]};`);
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}
