import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { TokenDef } from "../src/types.ts";
import { ALL_TOKENS } from "../src/registry/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");

const REF = /var\(--([\w-]+)/g;
const DECL = /(--[\w-]+)\s*:/g;

/** Token tiers the app consumes. Primitives are the palette: unused rungs are fine. */
const CONSUMED_TIERS = ["semantic", "component"] as const;

/**
 * Semantic *scales* ship complete even when the current UI does not use every
 * rung (a theme author needs the whole ramp). Everything else in the semantic
 * and component tiers has to be referenced, or it is dead weight.
 */
const SCALE_KINDS = new Set(["font-weight", "line-height", "letter-spacing", "shadow", "z-index", "motion"]);
const SCALE_PREFIXES: Array<[TokenDef["kind"], string]> = [
    ["spacing", "space-"],
    ["radius", "radius-"],
    ["typography", "text-"],
    ["size", "icon-"],
];

function isScaleRung(token: TokenDef): boolean {
    if (token.tier !== "semantic") return false;
    if (SCALE_KINDS.has(token.kind)) return true;
    return SCALE_PREFIXES.some(([kind, prefix]) => token.kind === kind && token.name.startsWith(prefix));
}

function walk(dir: string, exts: string[]): string[] {
    const out: string[] = [];
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(path, exts));
        else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(path);
    }
    return out;
}

/** Every file whose CSS can reference tokens. */
const sourceFiles = [
    ...walk(join(repo, "packages", "ui", "src"), [".vue", ".css"]),
    ...walk(join(repo, "apps", "web", "src"), [".vue", ".css"]),
];

const names = new Set(ALL_TOKENS.map((t) => t.name));
const referenced = new Set<string>();
for (const token of ALL_TOKENS) {
    for (const m of token.value.matchAll(REF)) referenced.add(m[1]);
}
for (const file of walk(join(repo, "packages", "theme", "themes"), [".json"])) {
    const raw = readFileSync(file, "utf8");
    for (const m of raw.matchAll(REF)) referenced.add(m[1]);
}
for (const file of sourceFiles) {
    const raw = readFileSync(file, "utf8");
    for (const m of raw.matchAll(REF)) referenced.add(m[1]);
}

describe("token coverage", () => {
    it("sees the UI sources", () => {
        assert.ok(sourceFiles.length > 20, `expected UI sources, found ${sourceFiles.length}`);
    });

    for (const tier of CONSUMED_TIERS) {
        it(`has no unused ${tier} token`, () => {
            const orphans = ALL_TOKENS.filter((t) => t.tier === tier && !referenced.has(t.name) && !isScaleRung(t));
            assert.deepEqual(orphans.map((t) => `--${t.name}`), []);
        });
    }

    it("leaves only palette and scale rungs unused", () => {
        const allowed = ALL_TOKENS.filter((t) => t.tier === "primitive" || isScaleRung(t)).map((t) => t.name);
        const allowedSet = new Set(allowed);
        const unexpected = ALL_TOKENS.filter((t) => !referenced.has(t.name) && !allowedSet.has(t.name));
        assert.deepEqual(unexpected.map((t) => `${t.tier}/${t.kind} --${t.name}`), []);
    });

    it("resolves every token reference in the UI", () => {
        const unresolved: string[] = [];
        for (const file of sourceFiles) {
            const raw = readFileSync(file, "utf8");
            const local = new Set([...raw.matchAll(DECL)].map((m) => m[1]));
            for (const m of raw.matchAll(REF)) {
                if (names.has(m[1]) || local.has(`--${m[1]}`)) continue;
                unresolved.push(`${relative(repo, file)}: --${m[1]}`);
            }
        }
        assert.deepEqual(unresolved, []);
    });
});

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g;
/** Colors, absolute lengths, and numeric font weights are token territory. */
const HARDCODED = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\d+(?:\.\d+)?(?:px|rem|em)\b|font-weight:\s*\d/i;

describe("token-complete styles", () => {
    it("has no hardcoded colors, lengths or font weights", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles) {
            const raw = readFileSync(file, "utf8");
            // An SFC carries CSS only inside `<style>`; a plain stylesheet *is*
            // CSS. App-level sheets are scanned too — that is how the placeholder
            // `apps/web/src/styles.css` (hardcoded colours) stayed invisible to
            // this gate until the auth surface was tokenized.
            const css = file.endsWith(".vue")
                ? [...raw.matchAll(STYLE_BLOCK)].map((block) => block[1]).join("\n")
                : raw;
            for (const line of css.split("\n")) {
                if (HARDCODED.test(line)) offenders.push(`${relative(repo, file)}: ${line.trim()}`);
            }
        }
        assert.deepEqual(offenders, []);
    });
});
