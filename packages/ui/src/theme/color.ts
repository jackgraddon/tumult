import { TOKEN_MAP } from "@tumult/theme";

/**
 * Colour helpers for the theme editor's swatches. Pure and DOM-free: a picker
 * value is derived from the draft plus the built-in theme document (`defaults`),
 * never from `getComputedStyle` — resolving a var() chain by hand is both
 * deterministic and cheap enough to do per rendered row.
 */

const HEX3 = /^#([0-9a-f]{3})$/i;
const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX8 = /^#([0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;
const COLOR_FN = /^(oklch|oklab|lch|lab)\(\s*([^)]*)\s*\)$/i;
const VAR_REF = /var\(--([\w-]+)/;

function clampChannel(part: string): number {
    return Math.min(255, Math.max(0, Math.round(Number(part))));
}

function hex(parts: [number, number, number]): string {
    return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/** One numeric component, honouring `%`, `deg`, `turn` and `rad`, and `none`. */
function component(token: string, percentScale: number): number {
    const text = token.trim().toLowerCase();
    if (text === "" || text === "none") return 0;
    if (text.endsWith("%")) return (Number.parseFloat(text) / 100) * percentScale;
    if (text.endsWith("deg")) return Number.parseFloat(text);
    if (text.endsWith("turn")) return Number.parseFloat(text) * 360;
    if (text.endsWith("rad")) return (Number.parseFloat(text) * 180) / Math.PI;
    return Number.parseFloat(text);
}

/** Gamma-encode one linear-light sRGB channel to 0–255, clamping out of gamut. */
function encode(linear: number): number {
    const gamma = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(gamma * 255)));
}

/**
 * OKLab → sRGB (CSS Color 4), so an `oklch()` value the default theme authors
 * in still renders in a picker. Out-of-gamut channels clamp; that is fine for a
 * visual swatch (the text field keeps the exact authored value).
 */
function oklabToHex(l: number, a: number, b: number): string {
    const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
    const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
    const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
    const lCube = lPrime ** 3;
    const mCube = mPrime ** 3;
    const sCube = sPrime ** 3;
    return hex([
        encode(4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube),
        encode(-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube),
        encode(-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube),
    ]);
}

/**
 * CIELAB (D65) → sRGB. `lab()`/`lch()` are a different space from OKLab, so
 * they get their own matrix rather than being fed through the OKLab one.
 */
function cielabToHex(l: number, a: number, b: number): string {
    const fy = (l + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const epsilon = 216 / 24389;
    const inverse = (t: number): number => (t ** 3 > epsilon ? t ** 3 : (116 * t - 16) / 903.2962962);
    const x = inverse(fx) * 0.95047;
    const y = l > 8 ? fy ** 3 : l / 903.2962962;
    const z = inverse(fz) * 1.08883;
    return hex([
        encode(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
        encode(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
        encode(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
    ]);
}

/** `oklch()/oklab()/lch()/lab()` → `#rrggbb`, or `null` when it has alpha. */
function functionalToHex(space: string, body: string): string | null {
    const [coordsPart, alphaPart] = body.split("/");
    if (alphaPart !== undefined) {
        const alpha = alphaPart.trim();
        if (alpha !== "1" && alpha !== "100%") return null;
    }
    const parts = (coordsPart ?? "").trim().split(/\s+/);
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;

    const isPolar = space === "oklch" || space === "lch";
    const isOklab = space === "oklab" || space === "oklch";

    // oklab/oklch lightness is 0–1 (also authored as a percentage); lab/lch is
    // 0–100. Chroma percentages are 0.4 (ok) and 150 (cielab).
    let lightness = component(parts[0], isOklab ? 1 : 100);
    if (isOklab) {
        if (lightness > 1.5) lightness /= 100;
    } else {
        lightness /= 100;
    }
    const chroma = component(parts[1], isOklab ? 0.4 : 150);
    const third = component(parts[2], isPolar ? 360 : 1);

    let a = chroma;
    let b = third;
    if (isPolar) {
        const radians = (third * Math.PI) / 180;
        a = chroma * Math.cos(radians);
        b = chroma * Math.sin(radians);
    }
    return isOklab ? oklabToHex(lightness, a, b) : cielabToHex(lightness * 100, a, b);
}

/**
 * `#rgb`, `#rrggbb`, `rgb()`, `rgba()` and the CSS Color 4 spaces
 * (`oklch()`/`oklab()`/`lch()`/`lab()`) → `#rrggbb`, for `<input type="color">`.
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

    const fn = COLOR_FN.exec(text);
    if (fn?.[1] && fn[2] !== undefined) return functionalToHex(fn[1].toLowerCase(), fn[2]);

    return null;
}

/**
 * A token's effective value inside `tokens` (a theme draft), following `var()`
 * refs into the draft first, the built-in theme document second (what the draft
 * inherits from, since the registry carries structure only) and the registry's
 * structural `var()` default last — the same order the browser resolves them
 * in, minus the cascade.
 */
export function resolveTokenValue(
    name: string,
    tokens: Record<string, string>,
    defaults: Record<string, string> = {},
    depth = 8,
): string {
    let value = tokens[name] ?? defaults[name] ?? TOKEN_MAP.get(name)?.value ?? "";
    const seen = new Set<string>([name]);
    for (let step = 0; step < depth; step++) {
        const ref = VAR_REF.exec(value)?.[1];
        if (ref === undefined || seen.has(ref)) break;
        seen.add(ref);
        const next = tokens[ref] ?? defaults[ref] ?? TOKEN_MAP.get(ref)?.value;
        if (next === undefined) break;
        value = next;
    }
    return value;
}

/**
 * The swatch value for a token row, or `null` when the current value cannot be
 * shown as an opaque hex (the row still offers a text field).
 */
export function tokenHex(
    name: string,
    tokens: Record<string, string>,
    defaults: Record<string, string> = {},
): string | null {
    return toHexColor(resolveTokenValue(name, tokens, defaults));
}
