import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findUnsafeValue, isValidValue } from "../src/validate/values.ts";
import { validateTheme } from "../src/validate/index.ts";
import { TOKEN_CONTRACT_VERSION } from "../src/version.ts";
import type { TokenKind } from "../src/types.ts";

/**
 * The colour grammar: themes author in oklch, so the validator accepts the CSS
 * Color 4 spaces — while the injection guard stays untouched in front of it
 * (a payload is unsafe because of `;`/`{}` regardless of grammar width).
 */
describe("colour grammar", () => {
    it("accepts oklch/oklab/lch/lab functional forms", () => {
        const ok: Array<[TokenKind, string]> = [
            ["color", "oklch(0% 0 0)"],
            ["color", "oklch(70.4% 0.191 165.23)"],
            ["color", "oklch(100% 0 0 / 0.08)"],
            ["color", "oklab(0.5 0.1 -0.1)"],
            ["color", "lch(50% 0.1 30)"],
            ["color", "lab(40 20 30)"],
        ];
        for (const [kind, value] of ok) {
            assert.equal(isValidValue(kind, value), true, `expected valid: ${value}`);
        }
    });

    it("keeps the existing forms working", () => {
        for (const value of ["#5865f2", "#fff", "rgba(0, 0, 0, 0.5)", "rgb(1 2 3)", "hsl(10 20% 30%)", "red", "color-mix(in oklab, red 50%, blue)"]) {
            assert.equal(isValidValue("color", value), true, `expected valid: ${value}`);
        }
        assert.equal(isValidValue("color", "#5865f2 extra"), false);
        assert.equal(isValidValue("color", "oklch("), false);
    });

    it("accepts an oklch colour inside a shadow", () => {
        assert.equal(isValidValue("shadow", "0 3px 3px oklch(0% 0 0 / 0.12)"), true);
        assert.equal(isValidValue("shadow", "inset 0 1px 2px lch(10% 0.01 30)"), true);
        assert.equal(isValidValue("shadow", "0 3px 3px #0000001f"), true);
        assert.equal(isValidValue("shadow", "garbage 0 3px 3px #000"), false);
    });

    it("still bans url() in any value", () => {
        const result = validateTheme({
            version: TOKEN_CONTRACT_VERSION,
            name: "url",
            tokens: { "surface-overlay": "url(https://evil.example/x)" },
        });
        assert.ok(result.issues.some((i) => i.code === "banned-url"));
    });

    it("the injection guard rejects oklch payloads before the grammar sees them", () => {
        assert.notEqual(findUnsafeValue("oklch(0% 0 0); html {}"), null);
        assert.notEqual(findUnsafeValue("oklch(0% 0 0)}"), null);
        assert.notEqual(findUnsafeValue("<script>"), null);
        assert.equal(findUnsafeValue("oklch(0% 0 0 / 0.08)"), null);
        assert.equal(findUnsafeValue("oklab(0.5 0.1 -0.1)"), null);
    });

    it("a full document in oklch validates clean", () => {
        const result = validateTheme({
            version: TOKEN_CONTRACT_VERSION,
            name: "oklch",
            tokens: { accent: "oklch(70.4% 0.191 165.23)" },
            modes: { light: { accent: "oklch(39.5% 0.081 206.6)" } },
        });
        // A sparse document legitimately reports missing tokens (severity info);
        // what matters is that no oklch value produces an error.
        assert.deepEqual(result.issues.filter((i) => i.severity === "error"), []);
        assert.equal(result.valid, true);
    });
});
