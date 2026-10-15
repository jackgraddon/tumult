/**
 * Guards the generated authored docs.
 *
 * `docs/tokens.md` and `docs/theme.schema.json` are build output (see
 * `src/build/cli.ts`); they are committed so GitHub renders them, which means
 * they can rot. These tests re-render them from the same builders the build
 * uses and fail on any drift — the fix is always to re-run the build.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { buildThemeSchemaJson, buildTokenDocs } from "../src/build/docs.ts";
import { docsDir, readDefaultTheme } from "../src/build/default-theme.ts";
import { ALL_TOKENS } from "../src/registry/index.ts";

const theme = readDefaultTheme();
const REGENERATE = "run `pnpm --filter @tumult/theme build`";

function committed(file: string): string {
    const path = join(docsDir, file);
    assert.ok(existsSync(path), `docs/${file} is missing — ${REGENERATE}`);
    return readFileSync(path, "utf8");
}

describe("buildTokenDocs", () => {
    it("lists every token once, grouped by tier", () => {
        const doc = buildTokenDocs(theme.tokens);
        const rows = doc.split("\n").filter((line) => line.startsWith("| `--"));
        assert.equal(rows.length, ALL_TOKENS.length, "every token must have exactly one row");
        for (const token of ALL_TOKENS) {
            assert.ok(doc.includes(`\`--${token.name}\``), `missing token: ${token.name}`);
            assert.ok(doc.includes(token.description), `missing description: ${token.name}`);
        }
        for (const tier of ["## Primitives", "## Semantic", "## Component"]) {
            assert.ok(doc.includes(tier), `missing tier heading: ${tier}`);
        }
        assert.ok(doc.startsWith("# Tumult token reference"), "the file needs a title");
        assert.ok(doc.includes(`${ALL_TOKENS.length} tokens`), "the header must state the token count");
    });

    it("takes values from the theme document, and names the built-in default", () => {
        const doc = buildTokenDocs(theme.tokens);
        assert.ok(doc.includes(`\`${theme.tokens["prim-brand-3"]}\``), "must show the theme file's value");
        assert.ok(doc.includes("prim-brand-3"), "brand primitive missing");
        // A change to the document changes the output: the docs are not source.
        const changed = buildTokenDocs({ ...theme.tokens, "prim-brand-3": "oklch(1 0 0)" });
        assert.ok(changed.includes("`oklch(1 0 0)`"), "the built-in value must come from the document");
        assert.ok(!changed.includes(`\`${theme.tokens["prim-brand-3"]}\``), "the old value must be gone");
    });

    it("keeps every row a well-formed markdown table row", () => {
        for (const line of buildTokenDocs(theme.tokens).split("\n")) {
            if (!line.startsWith("| `--")) continue;
            // Four columns (token | kind | value | description) → five pipes,
            // with any pipe inside the content escaped.
            assert.equal((line.match(/(?<!\\)\|/g) ?? []).length, 5, `broken table row: ${line}`);
        }
    });
});

describe("generated docs are in sync", () => {
    it("docs/tokens.md matches the builder", () => {
        assert.equal(committed("tokens.md"), buildTokenDocs(theme.tokens), `docs/tokens.md is stale — ${REGENERATE}`);
    });

    it("docs/theme.schema.json matches the builder", () => {
        assert.equal(
            committed("theme.schema.json"),
            buildThemeSchemaJson(),
            `docs/theme.schema.json is stale — ${REGENERATE}`,
        );
    });
});
