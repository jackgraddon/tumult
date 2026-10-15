import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseGallery } from "../../../apps/web/src/theme/gallery.ts";
import { validateTheme } from "../src/validate/index.ts";
import { TOKEN_CONTRACT_VERSION } from "../src/version.ts";

/**
 * The app ships the accent gallery (`apps/web/public/themes/`): an index the
 * Appearance tab renders and one document per row it installs. Nothing else
 * checks that the two agree, and a typo would only surface as a silent empty
 * gallery or a refused install — so they are pinned here.
 *
 * It lives in the theme package because the validator is source-only here
 * (`../src/validate`): the web app would have to build `dist` to import it.
 * `coverage.test.ts` reads the app's sources for the same reason.
 */
const here = dirname(fileURLToPath(import.meta.url));
const galleryDir = resolve(here, "..", "..", "..", "apps", "web", "public", "themes");

interface GalleryDocument {
    version: number;
    name: string;
    tokens: Record<string, string>;
    modes?: Record<string, Record<string, string>>;
}

describe("shipped theme gallery", () => {
    const index = JSON.parse(readFileSync(join(galleryDir, "index.json"), "utf8")) as unknown;
    const entries = parseGallery(index);

    it("parses into the entries the app will render", () => {
        assert.ok(entries.length >= 5, `expected the shipped accents, found ${entries.length}`);
        assert.equal(entries.length, (index as { themes: unknown[] }).themes.length);
    });

    it("keeps every id unique", () => {
        const ids = entries.map((entry) => entry.id);
        assert.deepEqual(new Set(ids).size, ids.length);
    });

    for (const entry of entries.length > 0 ? entries : []) {
        describe(entry.id, () => {
            const file = join(galleryDir, `${entry.id}.json`);

            it("has a document beside the index", () => {
                assert.ok(existsSync(file), `missing ${entry.id}.json`);
            });

            it("validates clean and installs under its own id", () => {
                const doc = JSON.parse(readFileSync(file, "utf8")) as GalleryDocument;
                const result = validateTheme(doc);
                assert.deepEqual(
                    result.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message),
                    [],
                );
                assert.equal(doc.version, TOKEN_CONTRACT_VERSION);
                assert.equal(doc.name, entry.id);
            });

            it("previews exactly the accent it installs", () => {
                // The swatch is a copy of the colour, so it can drift; this is
                // the assertion that stops a row from advertising the wrong hue.
                const doc = JSON.parse(readFileSync(file, "utf8")) as GalleryDocument;
                assert.deepEqual(entry.swatch, [doc.tokens["accent"], doc.tokens["accent-hover"]]);
            });

            it("overrides only the accent, dark and light", () => {
                // A gallery accent is a delta on the built-in theme; anything
                // else here would fight the default document it inherits from.
                const doc = JSON.parse(readFileSync(file, "utf8")) as GalleryDocument;
                assert.deepEqual(Object.keys(doc.tokens).sort(), ["accent", "accent-hover"]);
                assert.deepEqual(Object.keys(doc.modes ?? {}), ["light"]);
                assert.deepEqual(Object.keys(doc.modes?.["light"] ?? {}).sort(), ["accent", "accent-hover"]);
            });
        });
    }
});
