import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveTokenValue, toHexColor, tokenHex } from "../src/theme/color.ts";

describe("toHexColor", () => {
    it("normalizes the literal forms a swatch can show", () => {
        assert.equal(toHexColor("#ABC"), "#aabbcc");
        assert.equal(toHexColor("#7AA2F7"), "#7aa2f7");
        assert.equal(toHexColor("#7aa2f7ff"), "#7aa2f7");
        assert.equal(toHexColor("rgb(122, 162, 247)"), "#7aa2f7");
        assert.equal(toHexColor("rgba(122, 162, 247, 1)"), "#7aa2f7");
        assert.equal(toHexColor("  #7aa2f7  "), "#7aa2f7");
    });

    it("refuses anything a colour input cannot represent", () => {
        // A picker has no alpha channel, so offering a translucent colour would
        // silently drop the transparency.
        assert.equal(toHexColor("rgba(122, 162, 247, 0.5)"), null);
        assert.equal(toHexColor("#7aa2f780"), null);
        assert.equal(toHexColor("var(--accent)"), null);
        assert.equal(toHexColor("color-mix(in srgb, red, blue)"), null);
        assert.equal(toHexColor("transparent"), null);
        assert.equal(toHexColor(""), null);
        assert.equal(toHexColor("not a colour"), null);
    });
});

describe("resolveTokenValue", () => {
    it("follows var() chains into the registry defaults", () => {
        // `accent` is a semantic token whose default is a primitive reference,
        // so an empty draft still resolves to a concrete colour.
        const value = resolveTokenValue("accent", {});
        assert.notEqual(value, "");
        assert.ok(!value.includes("var("), `expected a resolved value, got ${value}`);
    });

    it("prefers the draft over the registry at every step", () => {
        const value = resolveTokenValue("accent", { "prim-indigo-3": "#000000" });
        assert.equal(value, "#000000");
        assert.equal(resolveTokenValue("accent", { accent: "#ff0000" }), "#ff0000");
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
        const hex = tokenHex("accent", {});
        assert.ok(hex && /^#[0-9a-f]{6}$/.test(hex), `expected a hex, got ${hex}`);
    });
});
