import { ALL_TOKENS } from "../registry/index.ts";

/** Structural defaults: every semantic default is var(--prim), every component default is var(--semantic). */
export function emitBaseCss(): string {
    const lines: string[] = [":root {"];
    for (const t of [...ALL_TOKENS].sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`    --${t.name}: ${t.value};`);
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}
