import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { densityRowDelta } from "../src/theme/density.ts";

/**
 * The estimates are a mirror of the built-in theme's density blocks
 * (`packages/theme/themes/default.json`), so these are the numbers the browser
 * smoke test's row-height assertions ride on.
 */
describe("densityRowDelta", () => {
    it("is zero for the base (cozy) density", () => {
        assert.equal(densityRowDelta("cozy"), 0);
    });

    it("is zero for an unknown density name and for no density", () => {
        assert.equal(densityRowDelta("mystery"), 0);
        assert.equal(densityRowDelta(undefined), 0);
    });

    it("shrinks a row for compact and grows it for spacious", () => {
        assert.ok(densityRowDelta("compact") < 0, "compact must be tighter than cozy");
        assert.ok(densityRowDelta("spacious") > 0, "spacious must be looser than cozy");
    });
});
