import type { ThemeDensities, ThemeModes } from "../types.ts";
import type { ValidationResult } from "../validate/issues.ts";

export interface EmitInput {
    name: string;
    tokens: Record<string, string>;
    modes?: ThemeModes;
    densities?: ThemeDensities;
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
    const blocks: string[] = [block(`:root[data-theme="${input.name}"]`, input.tokens)];
    for (const [mode, tokens] of Object.entries(input.modes ?? {})) {
        blocks.push(block(`:root[data-theme="${input.name}"][data-mode="${mode}"]`, tokens));
    }
    for (const [density, tokens] of Object.entries(input.densities ?? {})) {
        blocks.push(block(`:root[data-theme="${input.name}"][data-density="${density}"]`, tokens));
    }
    return blocks.join("\n") + "\n";
}

function block(selector: string, tokens: Record<string, string>): string {
    const keys = Object.keys(tokens).sort();
    const lines: string[] = [`${selector} {`];
    for (const k of keys) {
        lines.push(`    --${k}: ${tokens[k]};`);
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}
