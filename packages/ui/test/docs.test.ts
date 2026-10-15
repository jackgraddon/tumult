/**
 * Guards `docs/plugins.md` against API drift.
 *
 * The doc is hand-written prose with copied code, so it cannot be regenerated —
 * but the parts a plugin author copies (the permission names, the `ctx.*` calls,
 * the `@tumult/ui` imports) are checkable against the source. Each check fails
 * with the offending token, so the fix is either the code or the doc.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, "..", "..", "..", "docs");
const srcDir = join(here, "..", "src");

const pluginsDoc = readFileSync(join(docsDir, "plugins.md"), "utf8");
const typesSource = readFileSync(join(srcDir, "plugins", "types.ts"), "utf8");
const indexSource = readFileSync(join(srcDir, "index.ts"), "utf8");

/** The `Permission` union members, read out of the contract. */
function permissionNames(): string[] {
    const block = /export type Permission =([\s\S]*?);/.exec(typesSource);
    assert.ok(block, "could not find `export type Permission` in plugins/types.ts");
    return [...block[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/** The `PluginApi` method names, read out of the contract. */
function apiMethods(): string[] {
    const block = /export interface PluginApi \{([\s\S]*?)\n\}/.exec(typesSource);
    assert.ok(block, "could not find `export interface PluginApi` in plugins/types.ts");
    return [...block[1]!.matchAll(/^ {4}(\w+)\(/gm)].map((match) => match[1]!);
}

/** Every name exported from `@tumult/ui` (values and types). */
function exportedNames(): Set<string> {
    const names = new Set<string>();
    for (const match of indexSource.matchAll(/export (?:type )?\{([^}]*)\}/g)) {
        for (const part of match[1]!.split(",")) {
            const cleaned = part.trim().replace(/^type\s+/, "");
            if (!cleaned) continue;
            const alias = cleaned.split(/\s+as\s+/);
            names.add((alias[1] ?? alias[0]!).trim());
        }
    }
    return names;
}

/** Fenced ```ts blocks in a markdown document, parsed line-anchored: a closing
 * fence is a line of backticks only (a fence's *content* may contain ``` inline,
 * as the timeline-renderer example does in a regex). */
function fencedBlocks(markdown: string): string[] {
    const blocks: string[] = [];
    let current: string[] | null = null;
    for (const line of markdown.split("\n")) {
        if (current === null) {
            if (/^```[a-z]*\s*$/.test(line)) current = [];
            continue;
        }
        if (/^```\s*$/.test(line)) {
            blocks.push(current.join("\n"));
            current = null;
            continue;
        }
        current.push(line);
    }
    return blocks;
}

describe("docs/plugins.md", () => {
    it("only declares real permissions", () => {
        const known = new Set(permissionNames());
        const declared = new Set<string>();
        for (const block of fencedBlocks(pluginsDoc)) {
            for (const list of block.matchAll(/permissions:\s*\[([^\]]*)\]/g)) {
                for (const match of list[1]!.matchAll(/"([^"]+)"/g)) declared.add(match[1]!);
            }
        }
        assert.ok(declared.size > 0, "no manifest permissions found in the doc");
        for (const permission of declared) {
            assert.ok(known.has(permission), `the doc declares an unknown permission: "${permission}"`);
        }
    });

    it("documents every permission", () => {
        for (const permission of permissionNames()) {
            assert.ok(pluginsDoc.includes(`\`${permission}\``), `permission not documented: ${permission}`);
        }
    });

    it("only calls real context APIs", () => {
        const known = new Set(apiMethods());
        for (const block of fencedBlocks(pluginsDoc)) {
            for (const call of block.matchAll(/ctx\.(\w+)\(/g)) {
                assert.ok(known.has(call[1]!), `the doc calls a context API that does not exist: ctx.${call[1]}()`);
            }
        }
    });

    it("documents every context API", () => {
        for (const method of apiMethods()) {
            assert.ok(pluginsDoc.includes(`\`${method}(`) || pluginsDoc.includes(`ctx.${method}(`), `context API not documented: ${method}()`);
        }
    });

    it("only imports names @tumult/ui really exports", () => {
        const known = exportedNames();
        assert.ok(known.has("PluginRegistry") && known.has("Plugin"), "the export parser found nothing");
        for (const file of readdirSync(docsDir).filter((name) => name.endsWith(".md"))) {
            const markdown = readFileSync(join(docsDir, file), "utf8");
            for (const block of fencedBlocks(markdown)) {
                for (const statement of block.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@tumult\/ui"/g)) {
                    for (const part of statement[1]!.split(",")) {
                        const cleaned = part.trim().replace(/^type\s+/, "").replace(/\s+as\s+\w+$/, "");
                        if (!cleaned) continue;
                        assert.ok(known.has(cleaned), `docs/${file} imports "${cleaned}", which @tumult/ui does not export`);
                    }
                }
            }
        }
    });
});
