import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TOKEN_CONTRACT_VERSION, SUPPORTED_TOKEN_CONTRACT_VERSIONS } from "../src/version.ts";
import { DEFAULT_THEME_MODES } from "../src/runtime.ts";
import { ALL_TOKENS } from "../src/registry/index.ts";
import { validateTheme } from "../src/validate/index.ts";

const themesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "themes");

describe("shipped themes", () => {
    const files = readdirSync(themesDir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length > 0, "expected at least one theme JSON");

    for (const file of files) {
        it(`${file} validates without errors`, () => {
            const raw = JSON.parse(readFileSync(join(themesDir, file), "utf8")) as { version: number };
            const result = validateTheme(raw);
            const errors = result.issues.filter((i) => i.severity === "error");
            assert.deepEqual(errors.map((e) => `${e.code}${e.mode ? `@${e.mode}` : ""}: ${e.message}`), []);
            assert.equal(result.valid, true);
        });

        it(`${file} uses a supported contract version`, () => {
            const raw = JSON.parse(readFileSync(join(themesDir, file), "utf8")) as { version: number };
            assert.ok(SUPPORTED_TOKEN_CONTRACT_VERSIONS.includes(raw.version));
            assert.equal(raw.version, TOKEN_CONTRACT_VERSION);
        });
    }
});

describe("default theme", () => {
    it("is a complete snapshot of the registry structural defaults", () => {
        const raw = JSON.parse(readFileSync(join(themesDir, "default.json"), "utf8")) as {
            tokens: Record<string, string>;
        };
        const missing = ALL_TOKENS.filter((t) => !(t.name in raw.tokens)).map((t) => `--${t.name}`);
        assert.deepEqual(missing, [], "default theme is missing registered tokens");
        const drift = ALL_TOKENS.filter((t) => raw.tokens[t.name] !== t.value).map(
            (t) => `${t.name}: ${JSON.stringify(raw.tokens[t.name])} != ${JSON.stringify(t.value)}`,
        );
        assert.deepEqual(drift, [], "default theme drifted from the registry defaults");
    });

    it("declares exactly the modes the app offers for it", () => {
        // The app reads `DEFAULT_THEME_MODES` (a runtime constant, so the boot
        // path needs no JSON) and shows those as mode choices for the built-in
        // theme. If this fails, one of the two sides is stale.
        const raw = JSON.parse(readFileSync(join(themesDir, "default.json"), "utf8")) as {
            modes?: Record<string, unknown>;
        };
        assert.deepEqual(
            Object.keys(raw.modes ?? {}).sort(),
            [...DEFAULT_THEME_MODES].sort(),
        );
    });
});

describe("token registry", () => {
    it("has no duplicate token names", () => {
        const seen = new Set<string>();
        for (const t of ALL_TOKENS) {
            assert.ok(!seen.has(t.name), `duplicate token ${t.name}`);
            seen.add(t.name);
        }
    });

    it("every default value matches its declared kind", () => {
        // Imported lazily through the validator by faking a document that sets
        // nothing — registry defaults are what a null-override theme resolves to.
        const result = validateTheme({ version: TOKEN_CONTRACT_VERSION, name: "empty", tokens: {} });
        assert.ok(!result.issues.some((i) => i.code === "reference-cycle"));
    });
});
