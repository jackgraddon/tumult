import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { emitBaseCss } from "../src/emit/base-css.ts";
import { emitThemeCss } from "../src/emit/theme-css.ts";
import { serializeTheme } from "../src/emit/serialize.ts";
import { ALL_TOKENS } from "../src/registry/index.ts";
import { buildThemeSchema } from "../src/build/schema.ts";
import { validateTheme } from "../src/validate/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
// base.css is compiled from the default theme document — the registry has no
// primitive values to fall back on, so every test below feeds it the JSON.
const theme = JSON.parse(readFileSync(join(here, "..", "themes", "default.json"), "utf8")) as {
    tokens: Record<string, string>;
    modes?: Record<string, Record<string, string>>;
    densities?: Record<string, Record<string, string>>;
};

/** The `:root { … }` block alone: the mode/density blocks repeat token names. */
function rootBlock(css: string): string {
    const start = css.indexOf(":root {");
    const end = css.indexOf("}", start);
    return css.slice(start, end);
}

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
        const css = emitBaseCss(theme);
        const names = tokenNamesInBaseCss(rootBlock(css));
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
        const css = rootBlock(emitBaseCss(theme));
        const re = /^\s*--([\w-]+):/gm;
        const listed: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(css)) !== null) {
            listed.push(m[1]);
        }
        const sorted = [...ALL_TOKENS].map((t) => t.name).sort((a, b) => a.localeCompare(b));
        assert.deepEqual(listed, sorted);
    });

    it("emits the built-in mode maps for every theme to inherit", () => {
        // Attribute-presence selector, not the built-in theme's name: an
        // installed sparse theme inherits light mode from this block.
        const css = emitBaseCss(theme);
        assert.ok(css.includes(':root[data-theme][data-mode="light"] {'), "no inherited light block");
        const lightStart = css.indexOf(':root[data-theme][data-mode="light"] {');
        const lightBlock = css.slice(lightStart, css.indexOf("}", lightStart));
        const surface = theme.modes?.["light"]?.["surface-base"];
        assert.ok(surface, "the shipped default theme must declare a light surface");
        assert.ok(lightBlock.includes(`--surface-base: ${surface};`), "light block must carry the built-in values");
        assert.ok(css.includes(':root[data-theme][data-density="compact"] {'), "no inherited density block");
    });

    it("refuses a mode name that could escape the selector", () => {
        const modes = { 'light"] { --x': { "space-4": "1px" } };
        assert.throws(() => emitBaseCss({ tokens: theme.tokens, modes }));
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

