import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");

/**
 * `import { type X } from "y"` is NOT the same as `import type { X } from "y"`.
 *
 * With `verbatimModuleSyntax: true` (tsconfig.base.json) the inline form is
 * emitted verbatim as `import {} from "y"` — a side-effect import that keeps the
 * module in the graph. When `y` is `matrix-js-sdk` that means bundling the whole
 * 800 kB SDK for a type that is erased anyway, which silently broke the
 * "the fake build has no Matrix code in it" invariant.
 *
 * If every specifier in a braces import is a type, the statement must be an
 * `import type` statement.
 */
const BRACES_IMPORT = /(^|\n)\s*(import|export)\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g;

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

describe("type-only imports", () => {
    const sources = [
        ...walk(join(repo, "packages", "core", "src"), [".ts"]),
        ...walk(join(repo, "packages", "ui", "src"), [".ts", ".vue"]),
        ...walk(join(repo, "apps", "web", "src"), [".ts", ".vue"]),
    ];

    it("covers the app sources", () => {
        assert.ok(sources.length > 50, `expected sources, found ${sources.length}`);
    });

    it("uses `import type` when every specifier is a type", () => {
        const offenders: string[] = [];
        for (const file of sources) {
            const src = readFileSync(file, "utf8");
            for (const match of src.matchAll(BRACES_IMPORT)) {
                const keyword = match[2];
                const specifiers = match[3]
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                if (specifiers.length === 0) continue;
                if (!specifiers.every((s) => /^type\s/.test(s))) continue;
                const line = src.slice(0, match.index ?? 0).split("\n").length;
                offenders.push(`${relative(repo, file)}:${line}: ${keyword} { ${specifiers.join(", ")} }`);
            }
        }
        assert.deepEqual(
            offenders,
            [],
            "these keep their module in the bundle for nothing — use a whole-statement `import type`",
        );
    });
});
