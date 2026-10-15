import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isValidValue } from "../src/validate/values.ts";
import { validateTheme } from "../src/validate/index.ts";
import { serializeTheme } from "../src/emit/serialize.ts";
import { TOKEN_CONTRACT_VERSION } from "../src/version.ts";

describe("isValidValue", () => {
    it("accepts var() refs for every kind", () => {
        for (const kind of ["shadow", "z-index", "size", "opacity", "font-weight", "line-height"] as const) {
            assert.equal(isValidValue(kind, "var(--some-token)"), true, kind);
        }
    });

    it("validates shadows (including multi-layer)", () => {
        assert.equal(isValidValue("shadow", "none"), true);
        assert.equal(isValidValue("shadow", "0 1px 2px rgba(0, 0, 0, 0.3)"), true);
        assert.equal(isValidValue("shadow", "-8px 0 24px rgb(0 0 0 / 0.25)"), true);
        assert.equal(isValidValue("shadow", "0 1px 2px rgba(0,0,0,.3), 0 4px 8px rgba(0,0,0,.2)"), true);
        assert.equal(isValidValue("shadow", "inset 0 0 0 1px #fff"), true);
        assert.equal(isValidValue("shadow", "banana"), false);
    });

    it("validates z-index, opacity and weights", () => {
        assert.equal(isValidValue("z-index", "50"), true);
        assert.equal(isValidValue("z-index", "auto"), true);
        assert.equal(isValidValue("z-index", "50px"), false);
        assert.equal(isValidValue("opacity", "0.5"), true);
        assert.equal(isValidValue("opacity", "150%"), false);
        assert.equal(isValidValue("font-weight", "600"), true);
        assert.equal(isValidValue("font-weight", "semibold"), false);
    });

    it("validates signed sizes and border widths", () => {
        assert.equal(isValidValue("size", "-8px"), true);
        assert.equal(isValidValue("size", "32px"), true);
        assert.equal(isValidValue("size", "large"), false);
        assert.equal(isValidValue("border-width", "2px"), true);
        assert.equal(isValidValue("border-width", "thin"), true);
        assert.equal(isValidValue("border-width", "solid"), false);
    });
});

describe("theme modes", () => {
    const base = {
        version: TOKEN_CONTRACT_VERSION,
        name: "t",
        tokens: { accent: "var(--prim-brand-3)" },
    };

    it("accepts a valid light-mode override", () => {
        const r = validateTheme({
            ...base,
            modes: { light: { accent: "var(--prim-brand-4)" } },
        });
        assert.equal(r.valid, true);
    });

    it("errors on unknown token inside a mode, tagged with the mode", () => {
        const r = validateTheme({ ...base, modes: { light: { acceent: "#fff" } } });
        const issue = r.issues.find((i) => i.code === "unknown-token");
        assert.ok(issue);
        assert.equal(issue.mode, "light");
        assert.equal(r.valid, false);
    });

    it("errors on an invalid value inside a mode", () => {
        const r = validateTheme({ ...base, modes: { light: { accent: "not a color !!!" } } });
        assert.ok(r.issues.some((i) => i.code === "invalid-value" && i.mode === "light"));
        assert.equal(r.valid, false);
    });

    it("errors on tier violation inside a mode", () => {
        const r = validateTheme({
            ...base,
            modes: { light: { "button-primary-bg": "var(--prim-brand-3)" } },
        });
        assert.ok(r.issues.some((i) => i.code === "tier-violation" && i.mode === "light"));
    });

    it("does not report missing tokens for mode maps", () => {
        const r = validateTheme({ ...base, modes: { light: { accent: "#fff" } } });
        assert.ok(!r.issues.some((i) => i.code === "missing-token" && i.mode === "light"));
    });
});

describe("theme densities", () => {
    const base = {
        version: TOKEN_CONTRACT_VERSION,
        name: "t",
        tokens: { "timeline-row-padding-y": "var(--space-1)" },
    };

    it("accepts a valid density override", () => {
        const r = validateTheme({
            ...base,
            densities: { compact: { "timeline-row-padding-y": "var(--space-0-5)" } },
        });
        assert.equal(r.valid, true);
    });

    it("errors on unknown token inside a density, tagged with the density", () => {
        const r = validateTheme({ ...base, densities: { compact: { "timeline-row-padding-yy": "#fff" } } });
        const issue = r.issues.find((i) => i.code === "unknown-token");
        assert.ok(issue);
        assert.equal(issue.density, "compact");
        assert.equal(r.valid, false);
    });

    it("tags a value error with the density, not the mode", () => {
        const r = validateTheme({
            ...base,
            densities: { spacious: { "timeline-row-padding-y": "not a length !!!" } },
        });
        const issue = r.issues.find((i) => i.code === "invalid-value");
        assert.ok(issue);
        assert.equal(issue.density, "spacious");
        assert.equal(issue.mode, undefined);
    });

    it("errors on a density key that could escape the selector", () => {
        const r = validateTheme({ ...base, densities: { 'x"] { display: none } .y': {} } });
        const issue = r.issues.find((i) => i.code === "invalid-density");
        assert.ok(issue);
        assert.equal(issue.density, 'x"] { display: none } .y');
        assert.equal(r.valid, false);
    });

    it("does not report missing tokens for density maps", () => {
        const r = validateTheme({ ...base, densities: { compact: { accent2: "#fff" } } });
        // Unknown tokens still error, but nothing should be reported *missing*
        // (a density is an override, not a replacement map).
        assert.ok(!r.issues.some((i) => i.code === "missing-token" && i.density !== undefined));
    });
});

describe("contract version", () => {
    it("warns (not errors) on an unsupported version", () => {
        const r = validateTheme({ version: 999, name: "t", tokens: { accent: "#fff" } });
        const issue = r.issues.find((i) => i.code === "unsupported-version");
        assert.ok(issue);
        assert.equal(issue.severity, "warning");
        assert.equal(r.valid, true);
    });

    it("accepts the current version without warning", () => {
        const r = validateTheme({ version: TOKEN_CONTRACT_VERSION, name: "t", tokens: { accent: "#fff" } });
        assert.ok(!r.issues.some((i) => i.code === "unsupported-version"));
    });
});

describe("serializeTheme modes", () => {
    it("emits base plus a [data-mode] block", () => {
        const input = {
            version: TOKEN_CONTRACT_VERSION,
            name: "default",
            tokens: { accent: "var(--prim-brand-3)" },
            modes: { light: { accent: "var(--prim-brand-4)" } },
        };
        const validation = validateTheme(input);
        const css = serializeTheme({ name: "default", tokens: input.tokens, modes: input.modes, validation });
        assert.match(css, /:root\[data-theme="default"\] \{/);
        assert.match(css, /:root\[data-theme="default"\]\[data-mode="light"\] \{/);
        assert.match(css, /--accent: var\(--prim-brand-4\);/);
    });

    it("refuses to emit an invalid theme", () => {
        const validation = validateTheme({ version: 2, name: "t", tokens: { nope: "#fff" } });
        assert.throws(() => serializeTheme({ name: "t", tokens: { nope: "#fff" }, validation }));
    });
});

describe("serializeTheme densities", () => {
    it("emits [data-density] blocks after the mode blocks", () => {
        const base = {
            version: TOKEN_CONTRACT_VERSION,
            name: "default",
            tokens: { "timeline-row-padding-y": "var(--space-1)" },
        };
        const input = {
            ...base,
            modes: { light: { "timeline-row-padding-y": "var(--space-2)" } },
            densities: {
                compact: { "timeline-row-padding-y": "var(--space-0-5)" },
                spacious: { "timeline-row-padding-y": "var(--space-2)" },
            },
        };
        const validation = validateTheme(input);
        const css = serializeTheme({
            name: "default",
            tokens: input.tokens,
            modes: input.modes,
            densities: input.densities,
            validation,
        });
        assert.match(css, /:root\[data-theme="default"\] \{/);
        assert.match(css, /:root\[data-theme="default"\]\[data-mode="light"\] \{/);
        assert.match(css, /:root\[data-theme="default"\]\[data-density="compact"\] \{/);
        assert.match(css, /:root\[data-theme="default"\]\[data-density="spacious"\] \{/);
        // Same specificity as a mode block, so the later (density) block wins a tie.
        assert.ok(css.indexOf("[data-density=") > css.indexOf("[data-mode="));
    });

    it("emits no density blocks when none are declared", () => {
        const input = { version: TOKEN_CONTRACT_VERSION, name: "t", tokens: { accent: "#fff" } };
        const validation = validateTheme(input);
        const css = serializeTheme({ name: "t", tokens: input.tokens, validation });
        assert.ok(!css.includes("data-density"));
    });
});
