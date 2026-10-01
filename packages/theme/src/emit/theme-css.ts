/** Theme overrides: only tokens the theme sets, on `:root[data-theme="…"]`. */
export function emitThemeCss(name: string, tokens: Record<string, string>): string {
    const keys = Object.keys(tokens).sort();
    const lines: string[] = [`:root[data-theme="${name}"] {`];
    for (const k of keys) {
        lines.push(`    --${k}: ${tokens[k]};`);
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}
