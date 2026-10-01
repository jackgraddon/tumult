import { ALL_TOKENS } from "../registry/index.ts";

/** Markdown reference of every token. */
export function buildTokenDocs(): string {
    const lines = ["# Tumult tokens", ""];
    for (const t of ALL_TOKENS) {
        lines.push(`- \`--${t.name}\` (${t.tier}/${t.kind}): \`${t.value}\` — ${t.description}`);
    }
    return lines.join("\n") + "\n";
}
