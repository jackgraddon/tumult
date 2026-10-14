import { TOKEN_MAP } from "@tumult/theme";

/**
 * Colour helpers for the theme editor's swatches. Pure and DOM-free: a picker
 * value is derived from the draft plus the registry defaults, never from
 * `getComputedStyle` — resolving a var() chain by hand is both deterministic and
 * cheap enough to do per rendered row.
 */

const HEX3 = /^#([0-9a-f]{3})$/i;
const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX8 = /^#([0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;
const VAR_REF = /var\(--([\w-]+)/;

function clampChannel(part: string): number {
    return Math.min(255, Math.max(0, Math.round(Number(part))));
}

function hex(parts: [number, number, number]): string {
    return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * `#rgb`, `#rrggbb`, `rgb()` and `rgba()` → `#rrggbb`, for `<input type="color">`.
 * `null` for anything a swatch cannot show: `var()` refs, keywords, `color-mix()`,
 * and any colour with transparency (a picker has no alpha channel, so offering
 * one would silently drop it).
 */
export function toHexColor(value: string): string | null {
    const text = value.trim();

    const short = HEX3.exec(text);
    if (short?.[1]) {
        const [r, g, b] = short[1].toLowerCase().split("");
        return `#${r}${r}${g}${g}${b}${b}`;
    }

    const long = HEX6.exec(text);
    if (long?.[1]) return `#${long[1].toLowerCase()}`;

    const eight = HEX8.exec(text);
    if (eight?.[1]) {
        const alpha = eight[1].slice(6).toLowerCase();
        return alpha === "ff" ? `#${eight[1].slice(0, 6).toLowerCase()}` : null;
    }

    const rgb = RGB.exec(text);
    if (rgb?.[1] && rgb[2] && rgb[3]) {
        const alpha = rgb[4];
        if (alpha !== undefined && alpha !== "1" && alpha !== "100%") return null;
        return hex([clampChannel(rgb[1]), clampChannel(rgb[2]), clampChannel(rgb[3])]);
    }

    return null;
}

/**
 * A token's effective value inside `tokens` (a theme draft), following `var()`
 * refs into the draft first and the registry defaults second — the same order
 * the browser resolves them in, minus the cascade.
 */
export function resolveTokenValue(name: string, tokens: Record<string, string>, depth = 8): string {
    let value = tokens[name] ?? TOKEN_MAP.get(name)?.value ?? "";
    const seen = new Set<string>([name]);
    for (let step = 0; step < depth; step++) {
        const ref = VAR_REF.exec(value)?.[1];
        if (ref === undefined || seen.has(ref)) break;
        seen.add(ref);
        const next = tokens[ref] ?? TOKEN_MAP.get(ref)?.value;
        if (next === undefined) break;
        value = next;
    }
    return value;
}

/**
 * The swatch value for a token row, or `null` when the current value cannot be
 * shown as an opaque hex (the row still offers a text field).
 */
export function tokenHex(name: string, tokens: Record<string, string>): string | null {
    return toHexColor(resolveTokenValue(name, tokens));
}
