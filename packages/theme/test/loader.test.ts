import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { loadTheme, loadThemeText } from "../src/loader.ts";
import { TOKEN_CONTRACT_VERSION } from "../src/version.ts";

const validTheme = {
    version: TOKEN_CONTRACT_VERSION,
    name: "night-owl",
    tokens: { accent: "#7aa2f7", "text-primary": "var(--prim-neutral-1)" },
    modes: { light: { accent: "#3d59a1" } },
};

describe("loadTheme", () => {
    it("emits CSS for a valid document and normalizes the JSON", () => {
        const loaded = loadTheme(validTheme);
        assert.ok(loaded.css);
        assert.ok(loaded.css.includes(':root[data-theme="night-owl"]'));
        assert.ok(loaded.css.includes('[data-mode="light"]'));
        assert.equal(loaded.name, "night-owl");
        assert.equal(loaded.json.version, TOKEN_CONTRACT_VERSION);
        assert.deepEqual(loaded.json.tokens, validTheme.tokens);
        assert.deepEqual(loaded.json.modes, validTheme.modes);
    });

    it("withholds CSS for a document with errors but still returns its JSON", () => {
        const loaded = loadTheme({ ...validTheme, tokens: { ...validTheme.tokens, acceent: "#fff" } });
        assert.equal(loaded.css, null);
        assert.equal(loaded.validation.valid, false);
        assert.ok(loaded.validation.issues.some((issue) => issue.code === "unknown-token"));
        // The editor can still load and repair it.
        assert.equal(loaded.json.tokens["acceent"], "#fff");
    });

    it("refuses a theme whose name could escape the selector", () => {
        const loaded = loadTheme({ ...validTheme, name: 'x"] body { display: none } .y {' });
        assert.equal(loaded.css, null);
        assert.ok(loaded.validation.issues.some((issue) => issue.code === "invalid-name"));
    });

    it("warns about an unknown contract version but still emits", () => {
        const loaded = loadTheme({ ...validTheme, version: 99 });
        assert.ok(loaded.css);
        const issue = loaded.validation.issues.find((i) => i.code === "unsupported-version");
        assert.ok(issue);
        assert.equal(issue.severity, "warning");
    });

    it("handles a non-object payload", () => {
        const loaded = loadTheme("not a theme");
        assert.equal(loaded.css, null);
        assert.equal(loaded.name, "");
        assert.ok(loaded.validation.issues.some((i) => i.code === "invalid-envelope"));
    });
});

describe("loadThemeText", () => {
    it("parses JSON and loads it", () => {
        const loaded = loadThemeText(JSON.stringify(validTheme));
        assert.ok(loaded.css);
        assert.equal(loaded.name, "night-owl");
    });

    it("turns a syntax error into a validation issue instead of throwing", () => {
        const loaded = loadThemeText("{ not json");
        assert.equal(loaded.css, null);
        const issue = loaded.validation.issues.find((i) => i.code === "invalid-envelope");
        assert.ok(issue);
        assert.match(issue.message, /Not valid JSON/);
    });
});
