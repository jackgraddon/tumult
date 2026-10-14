import type { TokenKind } from "../types.ts";

const NUMBER = "[0-9]*\\.?[0-9]+";
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|color-mix\([^)]*\)|[a-z]+|var\(--[\w-]+.*\))$/;
const LENGTH = new RegExp(`^${NUMBER}(px|rem|em|%|dvh|dvw|ch|ex)?$`);
const SIGNED_LENGTH = new RegExp(`^-?${NUMBER}(px|rem|em|%|dvh|dvw|ch|ex)?$`);
const SPACING = new RegExp(`^(0|var\\(--[\\w-]+.*\\)|${LENGTH.source}(\\s+${LENGTH.source}){0,3})$`);
const RADIUS = /^(0|9999px|var\(--[\w-]+.*\)|[0-9]*\.?[0-9]+(px|rem|em|%))$/;
const DURATION = /^([0-9]*\.?[0-9]+(ms|s)|var\(--[\w-]+.*\))$/;
const Z_INDEX = /^(auto|-?[0-9]+)$/;
const LINE_HEIGHT = new RegExp(`^(normal|${NUMBER}(%|px|rem|em)?)$`);
const LETTER_SPACING = new RegExp(`^(normal|-?${NUMBER}(px|rem|em))$`);
const FONT_WEIGHT = /^(normal|bold|bolder|lighter|[1-9]00)$/;
const BORDER_WIDTH = new RegExp(`^(0|thin|medium|thick|-?${NUMBER}(px|rem|em))$`);
const OPACITY = new RegExp(`^${NUMBER}$`);
// One shadow layer: optional `inset`, 1–4 lengths (unitless 0 allowed), optional colour.
const SHADOW_PART = new RegExp(
    `^(inset\\s+)?((0|-?${NUMBER}(px|rem|em))\\s+){1,4}(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\)|hsla?\\([^)]*\\))?$`,
);

/** Split on commas that are not inside parentheses (e.g. `rgba(0, 0, 0, .3)`). */
function splitTopLevel(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) {
            parts.push(value.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(value.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Lightweight per-kind grammar. `var()` refs always pass — resolution is checked separately. */
export function isValidValue(kind: TokenKind, value: string): boolean {
    const v = value.trim();
    if (v.length === 0) return false;
    if (v.includes("var(--")) return true;
    switch (kind) {
        case "color":
            return COLOR.test(v);
        case "spacing":
            return SPACING.test(v);
        case "radius":
            return RADIUS.test(v);
        case "layout":
            return SPACING.test(v) || new RegExp(`^${NUMBER}(px|rem|%)$`).test(v);
        case "size":
            return SIGNED_LENGTH.test(v);
        case "motion":
            return DURATION.test(v) || /^(ease|ease-out|ease-in|linear|cubic-bezier\([^)]*\))$/.test(v);
        case "typography":
            return v.length > 0 && v.length < 500;
        case "shadow":
            if (v === "none") return true;
            return splitTopLevel(v).every((part) => SHADOW_PART.test(part));
        case "z-index":
            return Z_INDEX.test(v);
        case "line-height":
            return LINE_HEIGHT.test(v);
        case "letter-spacing":
            return LETTER_SPACING.test(v);
        case "font-weight":
            return FONT_WEIGHT.test(v);
        case "border-width":
            return BORDER_WIDTH.test(v);
        case "opacity":
            return OPACITY.test(v);
        default:
            return false;
    }
}
