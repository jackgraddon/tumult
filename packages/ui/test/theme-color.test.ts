import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTokenValue, toHexColor, tokenHex } from "../src/theme/color.ts";

// The built-in theme document (the registry carries structure only): a draft
// resolves against it, exactly as the browser does against base.css.
const defaults = (
    JSON.parse(
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "theme", "themes", "default.json"), "utf8"),
    ) as { tokens: Record<string, string> }
).tokens;

describe("toHexColor", () => {
    it("normalizes the literal forms a swatch can show", () => {
        assert.equal(toHexColor("#ABC"), "#aabbcc");
        assert.equal(toHexColor("#7AA2F7"), "#7aa2f7");
        assert.equal(toHexColor("#7aa2f7ff"), "#7aa2f7");
        assert.equal(toHexColor("rgb(122, 162, 247)"), "#7aa2f7");
        assert.equal(toHexColor("rgba(122, 162, 247, 1)"), "#7aa2f7");
        assert.equal(toHexColor("  #7aa2f7  "), "#7aa2f7");
    });

    it("converts the CSS Color 4 spaces the default theme authors in", () => {
        assert.equal(toHexColor("oklch(100% 0 0)"), "#ffffff");
        assert.equal(toHexColor("oklch(0% 0 0)"), "#000000");
        assert.equal(toHexColor("oklab(1 0 0)"), "#ffffff");
        assert.equal(toHexColor("lab(100 0 0)"), "#ffffff");
        assert.equal(toHexColor("lch(100% 0 0)"), "#ffffff");
        // Mint: green channel dominates.
        const mint = toHexColor("oklch(70.4% 0.191 165.23)");
        assert.ok(mint && /^#[0-9a-f]{6}$/.test(mint), `expected a hex, got ${mint}`);
        const [r, g, b] = [mint.slice(1, 3), mint.slice(3, 5), mint.slice(5, 7)].map((p) => Number.parseInt(p, 16));
        assert.ok(g! > r! && g! > b!, `expected a green-dominant swatch, got ${mint}`);
    });

    it("refuses anything a colour input cannot represent", () => {
        // A picker has no alpha channel, so offering a translucent colour would
        // silently drop the transparency.
        assert.equal(toHexColor("rgba(122, 162, 247, 0.5)"), null);
        assert.equal(toHexColor("#7aa2f780"), null);
        assert.equal(toHexColor("oklch(70.4% 0.191 165.23 / 0.4)"), null);
        assert.equal(toHexColor("var(--accent)"), null);
        assert.equal(toHexColor("color-mix(in srgb, red, blue)"), null);
        assert.equal(toHexColor("transparent"), null);
        assert.equal(toHexColor(""), null);
        assert.equal(toHexColor("not a colour"), null);
    });
});

describe("resolveTokenValue", () => {
    it("follows var() chains into the built-in theme document", () => {
        // `accent` is a semantic token whose default is a primitive reference,
        // so an empty draft still resolves to a concrete value.
        const value = resolveTokenValue("accent", {}, defaults);
        assert.notEqual(value, "");
        assert.ok(!value.includes("var("), `expected a resolved value, got ${value}`);
        assert.equal(value, defaults["prim-brand-3"]);
    });

    it("prefers the draft over the document at every step", () => {
        const value = resolveTokenValue("accent", { "prim-brand-3": "#000000" }, defaults);
        assert.equal(value, "#000000");
        assert.equal(resolveTokenValue("accent", { accent: "#ff0000" }, defaults), "#ff0000");
    });

    it("stops on a cycle instead of looping", () => {
        const value = resolveTokenValue("a", { a: "var(--b)", b: "var(--a)" });
        assert.equal(typeof value, "string");
    });

    it("falls back to the raw value when a reference is unresolvable", () => {
        assert.equal(resolveTokenValue("x", { x: "var(--nope)" }), "var(--nope)");
    });
});

describe("tokenHex", () => {
    it("gives the picker a concrete hex for a color token", () => {
        const hex = tokenHex("accent", {}, defaults);
        assert.ok(hex && /^#[0-9a-f]{6}$/.test(hex), `expected a hex, got ${hex}`);
    });
});
