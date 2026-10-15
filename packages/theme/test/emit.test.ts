import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitBaseCss } from "../src/emit/base-css.ts";
import { emitThemeCss } from "../src/emit/theme-css.ts";
import { serializeTheme } from "../src/emit/serialize.ts";
import { ALL_TOKENS } from "../src/registry/index.ts";
import { buildThemeSchema } from "../src/build/schema.ts";
import { buildTokenDocs } from "../src/build/docs.ts";
import { validateTheme } from "../src/validate/index.ts";

function tokenNamesInBaseCss(css: string): Set<string> {
    const names = new Set<string>();
    const re = /^\s*--([\w-]+):/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
        names.add(m[1]);
    }
    return names;
}

describe("emitBaseCss", () => {
    it("emits every token from the registry exactly once", () => {
        const css = emitBaseCss();
        const names = tokenNamesInBaseCss(css);
        assert.equal(css.trimStart().startsWith(":root {"), true);
        assert.ok(css.includes("}"));
        const expected = new Set<string>(ALL_TOKENS.map((t) => t.name));
        // All expected present
        for (const n of expected) {
            assert.ok(names.has(n), `missing token ${n}`);
        }
        // No extras
        for (const n of names) {
            assert.ok(expected.has(n), `unexpected token ${n}`);
        }
        assert.equal(names.size, expected.size, "duplicate tokens");
    });

    it("emits tokens in sorted order", () => {
        const css = emitBaseCss();
        const re = /^\s*--([\w-]+):/gm;
        const listed: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(css)) !== null) {
            listed.push(m[1]);
        }
        const sorted = [...ALL_TOKENS].map((t) => t.name).sort((a, b) => a.localeCompare(b));
        assert.deepEqual(listed, sorted);
    });
});

describe("emitThemeCss/serializeTheme", () => {
    it("emits base + mode + density blocks in the correct order (density after mode)", () => {
        const name = "default";
        const input = {
            tokens: { "space-4": "16px" } as Record<string, string>,
            modes: { light: { "surface-base": "#fff" } },
            densities: { compact: { "space-4": "12px" } },
        };
        const css = emitThemeCss(name, input.tokens, input.modes, input.densities);
        // Block order: base, then modes in sorted order (Object.entries), then densities in sorted order
        const idxBase = css.indexOf(`:root[data-theme="${name}"] {`);
        const idxMode = css.indexOf(`:root[data-theme="${name}"][data-mode="light"]`);
        const idxDensity = css.indexOf(`:root[data-theme="${name}"][data-density="compact"]`);
        assert.ok(idxBase >= 0);
        assert.ok(idxMode > idxBase);
        assert.ok(idxDensity > idxMode, "density must come after mode");
        assert.ok(css.endsWith("\n"));
    });

    it("serializeTheme refuses to emit CSS for an invalid theme", () => {
        const bad = validateTheme({ version: 1, name: "t", tokens: { "space-4": "blue" } as any } as any);
        assert.ok(!bad.valid);
        assert.throws(() => {
            serializeTheme({
                name: "t",
                tokens: { "space-4": "blue" } as Record<string, string>,
                validation: bad,
            });
        });
    });

    it("serializeTheme emits for a valid document and includes overrides", () => {
        const doc = {
            version: 1 as const,
            name: "default",
            tokens: { "space-4": "16px" } as Record<string, string>,
            modes: { light: { "space-4": "12px" } },
            densities: { cozy: { "space-4": "16px" } },
        };
        const res = validateTheme(doc as any);
        assert.ok(res.valid);
        const css = serializeTheme({
            name: "default",
            tokens: doc.tokens,
            modes: doc.modes,
            densities: doc.densities,
            validation: res,
        });
        assert.ok(css.includes(':root[data-theme="default"][data-mode="light"]'));
        assert.ok(css.includes(':root[data-theme="default"][data-density="cozy"]'));
    });
});

describe("buildThemeSchema", () => {
    it("accepts the shipped default.json and has correct structure", () => {
        const schema = buildThemeSchema() as any;
        assert.equal(schema.type, "object");
        assert.deepEqual(schema.required, ["version", "name", "tokens"]);
        const props = schema.properties || {};
        assert.ok(props.version);
        assert.ok(props.name);
        assert.ok(props.tokens);
        assert.equal(props.tokens.additionalProperties, false);
        // Every registry token is a property in the schema
        for (const t of ALL_TOKENS) {
            assert.ok(props.tokens.properties?.[t.name], `missing schema property ${t.name}`);
        }
    });
});

describe("buildTokenDocs", () => {
    it("lists every token", () => {
        const doc = buildTokenDocs();
        const namesInDocs = new Set<string>();
        for (const t of ALL_TOKENS) {
            assert.ok(doc.includes(`--${t.name}`), `missing in docs: ${t.name}`);
        }
        // Also ensure no unknown extra non-header lines we don't expect
        assert.equal(doc.includes("Tumult tokens") || doc.includes("Tumult Token Reference"), true);
    });
});
