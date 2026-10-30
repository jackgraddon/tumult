import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeTheme } from "../src/emit/serialize.ts";
import { validateTheme } from "../src/validate/index.ts";
import type { ThemeJson } from "../src/types.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const defaultTheme = join(repoRoot, "packages", "theme", "themes", "default.json");

function parseCss(css: string): {
    base: Record<string, string>;
    modes: Record<string, Record<string, string>>;
    densities: Record<string, Record<string, string>>;
} {
    const base: Record<string, string> = {};
    const modes: Record<string, Record<string, string>> = {};
    const densities: Record<string, Record<string, string>> = {};

    // Split by blocks: find :root[data-theme=...] { ... }
    const re = /:root\[data-theme="([^"]+)"\](?:\[data-(mode|density)="([^"]+)"\])?\s*\{\s*([^}]*)\}/gs;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
        const kind = m[2]; // "mode" or "density" or undefined
        const name = m[3]; // the mode/density name
        const body = m[4];
        const declarations = body.split(/\n/).map((s) => s.trim()).filter((s) => s && s.startsWith("--"));
        const tokens: Record<string, string> = {};
        for (const line of declarations) {
            // format: --name: value; (value may not contain ;)
            const mm = line.match(/^--([\w-]+):\s*(.+?);?$/);
            if (mm) {
                tokens[mm[1]] = mm[2].trim();
            }
        }
        if (!kind) {
            // base block
            for (const k of Object.keys(tokens)) {
                base[k] = tokens[k];
            }
        } else if (kind === "mode") {
            modes[name] = tokens;
        } else if (kind === "density") {
            densities[name] = tokens;
        }
    }
    return { base, modes, densities };
}

describe("theme v2 roundtrip", () => {
    it("roundtrips the default theme: validate → serialize → parse → deep-equal", () => {
        const json = readFileSync(defaultTheme, "utf8");
        const doc = JSON.parse(json) as ThemeJson;
        const res = validateTheme(doc as any);
        assert.ok(res.valid, "default theme should validate");
        const css = serializeTheme({
            name: doc.name,
            tokens: doc.tokens,
            modes: doc.modes,
            densities: doc.densities,
            validation: res,
        });
        const parsed = parseCss(css);
        assert.deepEqual(parsed.base, doc.tokens || {}, "base tokens roundtrip");
        assert.deepEqual(parsed.modes, doc.modes || {}, "modes roundtrip");
        assert.deepEqual(parsed.densities, doc.densities || {}, "densities roundtrip");
    });

    it("is idempotent: serialize(parse(serialize(x))) equals serialize(x) for fixtures", () => {
        const doc = {
            version: 1 as const,
            name: "default",
            tokens: { "space-4": "16px", "text-primary": "#111827" } as Record<string, string>,
            modes: { light: { "surface-base": "#ffffff" } },
            densities: { compact: { "space-4": "12px" } },
        };
        const res = validateTheme(doc as any);
        assert.ok(res.valid);
        const css1 = serializeTheme({ name: doc.name, tokens: doc.tokens, modes: doc.modes, densities: doc.densities, validation: res });
        const parsed = parseCss(css1);
        const res2 = validateTheme({ version: 1, name: "default", tokens: parsed.base, modes: parsed.modes, densities: parsed.densities } as any);
        const css2 = serializeTheme({ name: doc.name, tokens: parsed.base, modes: parsed.modes, densities: parsed.densities, validation: res2 });
        assert.equal(css2, css1);
    });

    it("roundtrips a theme with only base tokens", () => {
        const doc = {
            version: 1 as const,
            name: "default",
            tokens: { "space-4": "16px", "radius-sm": "4px" } as Record<string, string>,
        };
        const res = validateTheme(doc as any);
        assert.ok(res.valid);
        const css = serializeTheme({ name: doc.name, tokens: doc.tokens, validation: res });
        const parsed = parseCss(css);
        assert.deepEqual(parsed.base, doc.tokens);
        assert.deepEqual(parsed.modes, {});
        assert.deepEqual(parsed.densities, {});
    });
});
