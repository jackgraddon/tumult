/**
 * Doc builders — pure string functions, no filesystem, so both the build CLI
 * (via `emit-docs.ts`) and the drift-guard test (`test/docs.test.ts`) render
 * the authored docs from the same code and can never disagree.
 */
import { ALL_TOKENS, COMPONENT_TOKENS, PRIMITIVE_TOKENS, SEMANTIC_TOKENS } from "../registry/index.ts";
import type { TokenDef } from "../types.ts";
import { buildThemeSchema } from "./schema.ts";

const TIERS: ReadonlyArray<{ title: string; tokens: readonly TokenDef[] }> = [
    { title: "Primitives", tokens: PRIMITIVE_TOKENS },
    { title: "Semantic", tokens: SEMANTIC_TOKENS },
    { title: "Component", tokens: COMPONENT_TOKENS },
];

/** `|` would end a table cell; nothing else in these values needs escaping. */
function cell(text: string): string {
    return text.replaceAll("|", "\\|");
}

/**
 * Markdown reference of every token, with its value from the built-in theme
 * document. Pass `themes/default.json`'s `tokens` map: the values are the
 * theme's, never literals in code, so a token whose value only exists in the
 * theme file still documents the real default (and falls back to the
 * structural `var()` for tokens that have one).
 */
export function buildTokenDocs(defaults: Record<string, string> = {}): string {
    const counts = TIERS.map((tier) => `${tier.tokens.length} ${tier.title.toLowerCase()}`).join(", ");
    const lines = [
        "# Tumult token reference",
        "",
        "Generated — **do not edit by hand**. Structure comes from the registry",
        "(`packages/theme/src/registry/`); the values come from the built-in theme",
        "document (`packages/theme/themes/default.json`). Regenerate with",
        "`pnpm --filter @tumult/theme build`.",
        "",
        "The **built-in value** column is what a theme inherits when it does not set",
        "the token — an installed theme is a sparse overlay on this document (see",
        "[`themes.md`](./themes.md)). Semantic and component values are `var(…)`",
        "references rather than colours: overriding the primitive they point at moves",
        "everything built on it.",
        "",
        `**${ALL_TOKENS.length} tokens** — ${counts}.`,
        "",
    ];

    for (const tier of TIERS) {
        lines.push(`## ${tier.title}`, "", "| token | kind | built-in value | description |", "|---|---|---|---|");
        for (const token of tier.tokens) {
            const value = defaults[token.name] ?? token.value ?? "—";
            lines.push(
                `| \`--${token.name}\` | ${token.kind} | \`${cell(value)}\` | ${cell(token.description)} |`,
            );
        }
        lines.push("");
    }

    return lines.join("\n");
}

/** The theme document JSON Schema, serialized for the generated `docs/` file. */
export function buildThemeSchemaJson(): string {
    return `${JSON.stringify(buildThemeSchema(), null, 4)}\n`;
}
