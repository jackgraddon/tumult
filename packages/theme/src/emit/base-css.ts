import { ALL_TOKENS } from "../registry/index.ts";
import { SAFE_THEME_DENSITY, SAFE_THEME_MODE } from "../runtime.ts";

/**
 * The built-in theme document, as much of it as the base sheet needs: the base
 * `tokens` map plus the optional per-mode and per-density overrides.
 */
export interface BaseTheme {
    tokens: Record<string, string>;
    modes?: Record<string, Record<string, string>>;
    densities?: Record<string, Record<string, string>>;
}

/**
 * `:root` — the values every other selector inherits from — plus the built-in
 * theme's mode and density maps.
 *
 * The registry is structure only, so the values come from the default theme
 * document: primitives (which have no structural default at all) and any
 * token whose default is a literal. A token that only needs its structural
 * `var()` reference (the semantic/component web) falls back to it, so the
 * emitted sheet is complete even if the document stops spelling a reference
 * out. `compileThemes` refuses to build when the document is incomplete.
 *
 * The mode and density blocks are scoped to *any* theme
 * (`:root[data-theme][data-mode="…"]` — note the attribute-presence selector)
 * rather than to the built-in one. An installed theme is a sparse document over
 * this base, so it has to inherit the built-in light mode the same way it
 * inherits the built-in base values; otherwise `data-mode="light"` could only
 * ever flip colours for the built-in theme. The extra attribute also makes an
 * inherited mode block outrank a theme's own *base* block
 * (`:root[data-theme="x"]`, one attribute), which is what keeps a dark value
 * from bleeding into light mode. A theme's own
 * `[data-theme="x"][data-mode="light"]` block ties on specificity and wins on
 * order, because the store appends its `<style>` after this sheet.
 */
export function emitBaseCss(base: BaseTheme): string {
    const structural = new Map(ALL_TOKENS.map((token) => [token.name, token.value]));

    const lines: string[] = [":root {"];
    for (const name of [...structural.keys()].sort((a, b) => a.localeCompare(b))) {
        const resolved = base.tokens[name] ?? structural.get(name);
        if (resolved === undefined) {
            throw new Error(`base.css: no value for --${name} (neither the default theme nor a structural default)`);
        }
        lines.push(`    --${name}: ${resolved};`);
    }
    lines.push("}");

    for (const [mode, tokens] of checkedEntries(base.modes, SAFE_THEME_MODE, "mode")) {
        lines.push(...attributeBlock(`:root[data-theme][data-mode="${mode}"]`, tokens));
    }
    for (const [density, tokens] of checkedEntries(base.densities, SAFE_THEME_DENSITY, "density")) {
        lines.push(...attributeBlock(`:root[data-theme][data-density="${density}"]`, tokens));
    }

    return lines.join("\n") + "\n";
}

/**
 * Sorted mode/density entries, each name checked before it lands in a selector
 * (the same guard the validator applies). The base mode and base density are
 * not expected here: the base IS the `tokens` map, so it means no attribute.
 */
function checkedEntries(
    map: Record<string, Record<string, string>> | undefined,
    safeName: RegExp,
    kind: string,
): Array<[string, Record<string, string>]> {
    const entries = Object.entries(map ?? {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [name] of entries) {
        if (!safeName.test(name)) throw new Error(`base.css: unsafe ${kind} name "${name}"`);
    }
    return entries;
}

function attributeBlock(selector: string, tokens: Record<string, string>): string[] {
    const lines: string[] = [`${selector} {`];
    for (const name of Object.keys(tokens).sort()) {
        lines.push(`    --${name}: ${tokens[name]};`);
    }
    lines.push("}");
    return lines;
}
