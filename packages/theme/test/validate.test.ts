import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateTheme } from "../src/validate/index.ts";

const base = {
    version: 0,
    name: "test",
    tokens: {
        "prim-indigo-3": "#5865f2",
        accent: "var(--prim-indigo-3)",
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
            tokens: { ...base.tokens, "button-primary-bg": "var(--prim-indigo-3)" },
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
                "button-primary-bg": "var(--prim-indigo-3)",
            },
        });
        const codes = new Set(r.issues.map((i) => i.code));
        assert.ok(codes.has("unknown-token"));
        assert.ok(codes.has("tier-violation"));
    });
});
