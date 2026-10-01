import type { TokenKind } from "../types.ts";

const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|color-mix\([^)]*\)|[a-z]+|var\(--[\w-]+.*\))$/;
const LENGTH = /^[0-9]*\.?[0-9]+(px|rem|em|%|dvh|dvw|ch|ex)?$/;
const SPACING = new RegExp(`^(0|var\\(--[\\w-]+.*\\)|${LENGTH.source}(\\s+${LENGTH.source}){0,3})$`);
const RADIUS = /^(0|9999px|var\(--[\w-]+.*\)|[0-9]*\.?[0-9]+(px|rem|em|%))$/;
const DURATION = /^([0-9]*\.?[0-9]+(ms|s)|var\(--[\w-]+.*\))$/;

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
            return SPACING.test(v) || /^[0-9]*\.?[0-9]+(px|rem|%)$/.test(v);
        case "motion":
            return DURATION.test(v) || /^(ease|ease-out|ease-in|linear|cubic-bezier\([^)]*\))$/.test(v);
        case "typography":
            return v.length > 0 && v.length < 500;
        default:
            return false;
    }
}
