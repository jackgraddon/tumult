import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateTheme } from "../src/validate/index.ts";

const base = {
    version: 0,
    name: "test",
    tokens: {
        "prim-brand-3": "#5865f2",
        accent: "var(--prim-brand-3)",
        "button-primary-bg": "var(--accent)",
    },
};

describe("validateTheme", () => {
    it("accepts a valid theme", () => {
        const r = validateTheme(base);
        assert.equal(r.valid, true);
        assert.ok(!r.issues.some((i) => i.severity === "error"));
    });

    it("errors on unknown token with did-you-mean", () => {
        const r = validateTheme({ ...base, tokens: { ...base.tokens, acceent: "#fff" } });
        const issue = r.issues.find((i) => i.code === "unknown-token");
        assert.ok(issue);
        assert.equal(issue.severity, "error");
        assert.equal(issue.suggestion, "accent");
        assert.equal(r.valid, false);
    });

    it("infos on missing tokens", () => {
        const r = validateTheme(base);
        assert.ok(r.issues.some((i) => i.code === "missing-token" && i.severity === "info"));
    });

    it("errors on tier violation (component -> primitive)", () => {
        const r = validateTheme({
            ...base,
            tokens: { ...base.tokens, "button-primary-bg": "var(--prim-brand-3)" },
        });
        assert.ok(r.issues.some((i) => i.code === "tier-violation"));
        assert.equal(r.valid, false);
    });

    it("errors on reference cycle", () => {
        const r = validateTheme({
            version: 0,
            name: "t",
            tokens: {
                accent: "var(--button-primary-bg)",
                "button-primary-bg": "var(--accent)",
            },
        });
        assert.ok(r.issues.some((i) => i.code === "reference-cycle"));
    });

    it("errors on url() values", () => {
        const r = validateTheme({
            ...base,
            tokens: { ...base.tokens, accent: "url(https://evil.example/x.css)" },
        });
        assert.ok(r.issues.some((i) => i.code === "banned-url"));
    });

    it("errors on invalid envelope", () => {
        const r = validateTheme({ nope: true });
        assert.equal(r.valid, false);
        assert.ok(r.issues.some((i) => i.code === "invalid-envelope"));
    });

    it("errors on invalid value + unknown reference", () => {
        const badValue = validateTheme({ ...base, tokens: { ...base.tokens, accent: "not a color !!!" } });
        assert.ok(badValue.issues.some((i) => i.code === "invalid-value"));
        const badRef = validateTheme({ ...base, tokens: { ...base.tokens, accent: "var(--nope-missing)" } });
        assert.ok(badRef.issues.some((i) => i.code === "unknown-reference"));
    });

    it("collects multiple errors in one pass", () => {
        const r = validateTheme({
            version: 0,
            name: "t",
            tokens: {
                acceent: "url(http://x)",
                "button-primary-bg": "var(--prim-brand-3)",
            },
        });
        const codes = new Set(r.issues.map((i) => i.code));
        assert.ok(codes.has("unknown-token"));
        assert.ok(codes.has("tier-violation"));
    });

    // Themes are user-supplied at runtime, so the name and the mode keys are
    // interpolated into selectors (`:root[data-theme="…"][data-mode="…"]`).
    // These are the escape hatches the emitter must never see. (An empty name
    // is refused earlier, as an `invalid-envelope`.)
    it("errors on a name that could escape the selector", () => {
        for (const name of ['x"] { display: none } .y {', "with space", "-leading-dash", "a".repeat(65)]) {
            const r = validateTheme({ version: 0, name, tokens: {} });
            assert.ok(
                r.issues.some((i) => i.code === "invalid-name"),
                `should reject name ${JSON.stringify(name)}`,
            );
            assert.equal(r.valid, false);
        }
    });

    it("accepts a conservative name", () => {
        for (const name of ["a", "my-theme", "My.Theme_2", "0", "a".repeat(64)]) {
            const r = validateTheme({ version: 0, name, tokens: {} });
            assert.ok(!r.issues.some((i) => i.code === "invalid-name"), name);
        }
    });

    it("errors on a mode key that could escape the selector", () => {
        const r = validateTheme({
            version: 0,
            name: "t",
            tokens: {},
            modes: { 'light"] * { color: red } .x {': {} },
        });
        const issue = r.issues.find((i) => i.code === "invalid-mode");
        assert.ok(issue);
        assert.equal(issue.severity, "error");
        assert.equal(r.valid, false);
    });

    it("errors on a density key that could escape the selector", () => {
        const r = validateTheme({
            version: 0,
            name: "t",
            tokens: {},
            densities: { 'compact"] * { color: red } .x {': {} },
        });
        const issue = r.issues.find((i) => i.code === "invalid-density");
        assert.ok(issue);
        assert.equal(issue.severity, "error");
        assert.equal(issue.density, 'compact"] * { color: red } .x {');
        assert.equal(r.valid, false);
    });

    it("errors when densities is not an object", () => {
        const r = validateTheme({ version: 0, name: "t", tokens: {}, densities: [] });
        const issue = r.issues.find((i) => i.code === "invalid-envelope");
        assert.ok(issue);
        assert.equal(r.valid, false);
    });

    describe("unsafe values", () => {
        // A token value is emitted as `--name: <value>;`. `var(--…)` used to
        // short-circuit value validation, so `var(--accent); } html { … }` was
        // accepted and escaped its declaration.
        const escapes = [
            'var(--accent); } html { display: none } .x { color: var(--accent',
            "1px; } body { background: red",
            "red /*",
            "var(--accent) @import 'x'",
            "1px}",
        ];
        for (const value of escapes) {
            it(`rejects ${JSON.stringify(value)}`, () => {
                const r = validateTheme({ version: 0, name: "t", tokens: { accent: value } });
                const issue = r.issues.find((i) => i.code === "unsafe-value");
                assert.ok(issue, "expected an unsafe-value error");
                assert.equal(issue.token, "accent");
                assert.equal(r.valid, false);
                // Reported alone: no pile-on from the kind grammar.
                assert.ok(!r.issues.some((i) => i.code === "invalid-value" || i.code === "unknown-reference"));
            });
        }

        it("still accepts plain var() references and fallbacks", () => {
            const r = validateTheme({
                version: 0,
                name: "t",
                tokens: { accent: "var(--prim-brand-3)", "text-primary": "var(--prim-neutral-1, #fff)" },
            });
            assert.ok(!r.issues.some((i) => i.code === "unsafe-value"));
        });

        it("applies inside mode maps too", () => {
            const r = validateTheme({
                version: 0,
                name: "t",
                tokens: {},
                modes: { light: { accent: "#fff; } body { color: red" } },
            });
            const issue = r.issues.find((i) => i.code === "unsafe-value");
            assert.ok(issue);
            assert.equal(issue.mode, "light");
        });

        it("applies inside density maps too", () => {
            const r = validateTheme({
                version: 0,
                name: "t",
                tokens: {},
                densities: { compact: { accent: "#fff; } body { color: red" } },
            });
            const issue = r.issues.find((i) => i.code === "unsafe-value");
            assert.ok(issue);
            assert.equal(issue.density, "compact");
            assert.equal(issue.mode, undefined);
        });
    });
});
