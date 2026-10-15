import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractRefs, hasUrl, findCycle } from "../src/validate/references.ts";

describe("extractRefs", () => {
    it("extracts simple var references", () => {
        assert.deepEqual(extractRefs("var(--foo)"), ["foo"]);
    });

    it("extracts nested references in a fallbacks", () => {
        assert.deepEqual(extractRefs("var(--a, var(--b, var(--c)))"), ["a", "b", "c"]);
    });

    it("handles whitespace and multiple refs", () => {
        assert.deepEqual(extractRefs("var(--x) 10px var(--y)"), ["x", "y"]);
    });
});

describe("hasUrl", () => {
    it("detects url()", () => {
        assert.equal(hasUrl("url(https://example.com/foo.png)"), true);
        assert.equal(hasUrl("var(--x) no-repeat url(data:image/png;base64,...)"), true);
    });

    it("detects @import", () => {
        assert.equal(hasUrl("@import url('styles.css')"), true);
        assert.equal(hasUrl("@import 'styles.css'"), true);
    });

    it("returns false for safe values", () => {
        assert.equal(hasUrl("#fff"), false);
        assert.equal(hasUrl("var(--space-4, 16px)"), false);
        assert.equal(hasUrl("color-mix(in oklab, var(--accent), white 10%)"), false);
    });
});

describe("findCycle", () => {
    it("detects a self-cycle", () => {
        const edges = new Map([["a", ["a"]] as const]);
        const cycle = findCycle("a", edges);
        assert.ok(cycle, "should detect cycle");
        assert.deepEqual(cycle, ["a", "a"]);
    });

    it("detects a long cycle", () => {
        const edges = new Map([
            ["a", ["b"]],
            ["b", ["c"]],
            ["c", ["a"]],
        ] as const);
        const cycle = findCycle("a", edges);
        assert.ok(cycle);
        // Returns [a, b, c, a] or similar
        assert.equal(cycle[0], "a");
        assert.equal(cycle[3], "a");
    });

    it("returns null for acyclic graphs", () => {
        const edges = new Map([
            ["a", ["b"]],
            ["b", ["c"]],
        ] as const);
        assert.equal(findCycle("a", edges), null);
        assert.equal(findCycle("b", edges), null);
    });
});
