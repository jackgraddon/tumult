import type { ThemeDensities, ThemeModes } from "../types.ts";

/** Theme overrides: only tokens the theme sets, on `:root[data-theme="…"]`. */
export function emitThemeCss(
    name: string,
    tokens: Record<string, string>,
    modes?: ThemeModes,
    densities?: ThemeDensities,
): string {
    const blocks: string[] = [block(`:root[data-theme="${name}"]`, tokens)];
    for (const [mode, modeTokens] of Object.entries(modes ?? {})) {
        blocks.push(block(`:root[data-theme="${name}"][data-mode="${mode}"]`, modeTokens));
    }
    for (const [density, densityTokens] of Object.entries(densities ?? {})) {
        blocks.push(block(`:root[data-theme="${name}"][data-density="${density}"]`, densityTokens));
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
