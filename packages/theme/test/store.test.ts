import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_THEME_NAME,
    THEME_STORAGE_KEY,
    activeThemeCss,
    activeThemeName,
    readThemeState,
    writeThemeState,
} from "../src/runtime.ts";
import { ThemeStore } from "../src/store.ts";
import { TOKEN_CONTRACT_VERSION } from "../src/version.ts";
import type { ThemeStorage } from "../src/runtime.ts";

function fakeStorage(initial?: string): ThemeStorage & { raw(): string | null } {
    const map = new Map<string, string>();
    if (initial !== undefined) map.set(THEME_STORAGE_KEY, initial);
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => void map.set(key, value),
        removeItem: (key) => void map.delete(key),
        raw: () => map.get(THEME_STORAGE_KEY) ?? null,
    };
}

const theme = (name: string, tokens: Record<string, string> = { accent: "#7aa2f7" }) => ({
    version: TOKEN_CONTRACT_VERSION,
    name,
    tokens,
});

describe("ThemeStore", () => {
    it("starts on the built-in theme with no persisted state", () => {
        const store = new ThemeStore(fakeStorage());
        assert.equal(store.active(), DEFAULT_THEME_NAME);
        assert.equal(store.mode(), "dark");
        assert.deepEqual(
            store.list().map((entry) => entry.name),
            [DEFAULT_THEME_NAME],
        );
        assert.equal(store.activeCss(), "");
        assert.equal(store.advancedCss(), "");
    });

    it("saves a valid theme, makes it active and persists it", () => {
        const storage = fakeStorage();
        const store = new ThemeStore(storage);

        const result = store.save(theme("night-owl"));
        assert.equal(result.ok, true);
        assert.equal(store.active(), "night-owl");
        assert.ok(store.activeCss().includes(':root[data-theme="night-owl"]'));
        assert.ok(storage.raw());

        // A fresh store (next page load) restores the same selection and CSS.
        const reloaded = new ThemeStore(storage);
        assert.equal(reloaded.active(), "night-owl");
        assert.ok(reloaded.activeCss().includes(':root[data-theme="night-owl"]'));
    });

    it("accepts raw JSON text", () => {
        const store = new ThemeStore(fakeStorage());
        const result = store.save(JSON.stringify(theme("pasted")));
        assert.equal(result.ok, true);
        assert.equal(store.active(), "pasted");
    });

    it("refuses the reserved name even when the document is valid", () => {
        const store = new ThemeStore(fakeStorage());
        const result = store.save(theme("default"));
        assert.equal(result.ok, false);
        if (result.ok) throw new Error("unreachable");
        assert.ok(result.issues.some((issue) => issue.code === "invalid-name"));
        assert.equal(store.active(), DEFAULT_THEME_NAME);
        assert.equal(store.list().length, 1);
    });

    it("refuses an invalid document and stores nothing", () => {
        const storage = fakeStorage();
        const store = new ThemeStore(storage);
        const result = store.save(theme("broken", { accent: "not a colour !!!" }));
        assert.equal(result.ok, false);
        if (result.ok) throw new Error("unreachable");
        assert.ok(result.issues.length > 0);
        assert.equal(store.list().length, 1);
        assert.equal(storage.raw(), null, "a refused theme must not be persisted");
    });

    it("upserts by name instead of duplicating", () => {
        const store = new ThemeStore(fakeStorage());
        store.save(theme("night-owl"));
        store.save(theme("night-owl", { accent: "#111111" }));
        const entries = store.list();
        assert.equal(entries.length, 2);
        assert.ok(store.activeCss().includes("#111111"));
    });

    it("selects the built-in theme and rejects unknown names", () => {
        const store = new ThemeStore(fakeStorage());
        store.save(theme("night-owl"));
        assert.equal(store.select(DEFAULT_THEME_NAME), true);
        assert.equal(store.activeCss(), "");
        assert.equal(store.select("nope"), false);
        assert.equal(store.active(), DEFAULT_THEME_NAME);
    });

    it("falls back to the built-in theme when the active one is removed", () => {
        const storage = fakeStorage();
        const store = new ThemeStore(storage);
        store.save(theme("night-owl"));
        assert.equal(store.remove("night-owl"), true);
        assert.equal(store.active(), DEFAULT_THEME_NAME);
        assert.equal(store.remove(DEFAULT_THEME_NAME), false);
        assert.equal(new ThemeStore(storage).active(), DEFAULT_THEME_NAME);
    });

    it("moves the mode back to the base when a theme does not implement it", () => {
        const store = new ThemeStore(fakeStorage());
        assert.equal(store.setMode("light"), true);
        assert.deepEqual(store.activeModes(), ["dark", "light"], "built-in themes report their modes");
        assert.equal(store.mode(), "light");

        store.save(theme("flattened"));
        assert.deepEqual(store.activeModes(), ["dark"]);
        assert.equal(store.mode(), "dark");
        assert.equal(store.setMode("no spaces allowed"), false);
    });

    it("reports the modes a stored theme declares", () => {
        const store = new ThemeStore(fakeStorage());
        store.save({ ...theme("moody"), modes: { light: { accent: "#fff" }, dim: { accent: "#888" } } });
        assert.deepEqual(store.activeModes(), ["dark", "light", "dim"]);
    });

    it("starts on the base density and reports the built-in theme's densities", () => {
        const store = new ThemeStore(fakeStorage());
        assert.equal(store.density(), "cozy");
        assert.deepEqual(store.activeDensities(), ["cozy", "compact", "spacious"]);
    });

    it("persists the selected density across a reload", () => {
        const storage = fakeStorage();
        const store = new ThemeStore(storage);
        assert.equal(store.setDensity("compact"), true);
        assert.equal(store.density(), "compact");
        assert.equal(new ThemeStore(storage).density(), "compact");
    });

    it("rejects a density name that could escape the selector", () => {
        const store = new ThemeStore(fakeStorage());
        assert.equal(store.setDensity('x"] { display: none } .y'), false);
        assert.equal(store.density(), "cozy");
    });

    it("falls back to the base density when a theme does not implement it", () => {
        const store = new ThemeStore(fakeStorage());
        store.setDensity("spacious");

        // A theme that declares only `compact` cannot honour `spacious`.
        store.save({ ...theme("tight"), densities: { compact: { accent: "#111" } } });
        assert.deepEqual(store.activeDensities(), ["cozy", "compact"]);
        assert.equal(store.density(), "cozy");

        // Switching back to the built-in theme re-offers every density, but the
        // selection stays at the base — it was normalized, not remembered.
        assert.equal(store.select(DEFAULT_THEME_NAME), true);
        assert.deepEqual(store.activeDensities(), ["cozy", "compact", "spacious"]);
        assert.equal(store.density(), "cozy");
    });

    it("reports the densities a stored theme declares, base density first", () => {
        const store = new ThemeStore(fakeStorage());
        store.save({ ...theme("airy"), densities: { roomy: { accent: "#fff" } } });
        assert.deepEqual(store.activeDensities(), ["cozy", "roomy"]);
    });

    it("resets the density too", () => {
        const store = new ThemeStore(fakeStorage());
        store.setDensity("spacious");
        store.reset();
        assert.equal(store.density(), "cozy");
    });

    it("refuses advanced CSS that could fetch a third-party resource", () => {
        const store = new ThemeStore(fakeStorage());
        for (const css of ["@import url(https://evil.example/x.css);", ".x { background: url('https://x/y.png'); }"]) {
            const result = store.setAdvancedCss(css);
            assert.equal(result.ok, false, css);
            assert.equal(store.advancedCss(), "");
        }
        assert.equal(store.setAdvancedCss(".x { background: url(data:image/png;base64,AAA); }").ok, true);
        assert.match(store.advancedCss(), /data:image/);
    });

    it("resets everything to the built-in theme", () => {
        const storage = fakeStorage();
        const store = new ThemeStore(storage);
        store.save(theme("night-owl"));
        store.setMode("light");
        store.setAdvancedCss(".x { color: red; }");
        store.reset();
        assert.equal(store.active(), DEFAULT_THEME_NAME);
        assert.equal(store.mode(), "dark");
        assert.equal(store.advancedCss(), "");
        assert.equal(store.list().length, 1);

        const reloaded = new ThemeStore(storage);
        assert.equal(reloaded.active(), DEFAULT_THEME_NAME);
        assert.equal(reloaded.list().length, 1);
    });

    it("keeps a stored theme that no longer validates, without an active selection", () => {
        // What a contract bump could leave behind: a persisted document whose
        // tokens this build no longer accepts.
        const storage = fakeStorage();
        writeThemeState(storage, {
            version: 1,
            themes: [
                { name: "legacy", json: { version: 1, name: "legacy", tokens: {} }, css: "" },
                {
                    name: "jury",
                    json: { version: 1, name: "jury", tokens: { accent: "1px; } body { color: red" } },
                    css: "",
                },
            ],
            active: "jury",
            mode: "dark",
            advancedCss: "",
        });

        const store = new ThemeStore(storage);
        const names = store.list().map((entry) => entry.name);
        assert.deepEqual(names, [DEFAULT_THEME_NAME, "legacy", "jury"]);
        const jury = store.list().find((entry) => entry.name === "jury");
        assert.equal(jury?.css, "");
        assert.ok(jury?.validation.issues.some((issue) => issue.code === "unsafe-value"));
        assert.equal(store.select("jury"), false, "an unusable theme cannot be selected");
        assert.equal(store.active(), DEFAULT_THEME_NAME);
        assert.equal(store.remove("jury"), true);
    });

    it("rewrites the CSS cache when the emitter changes under it", () => {
        const storage = fakeStorage();
        writeThemeState(storage, {
            version: 1,
            themes: [{ name: "stale", json: theme("stale"), css: "/* stale cache */" }],
            active: "stale",
            mode: "dark",
            advancedCss: "",
        });
        const store = new ThemeStore(storage);
        assert.ok(store.activeCss().includes(':root[data-theme="stale"]'));
        const persisted = JSON.parse(storage.raw() ?? "{}") as { themes: Array<{ css: string }> };
        assert.ok(persisted.themes[0]?.css.includes(':root[data-theme="stale"]'));
    });
});

describe("boot helpers", () => {
    it("returns the built-in theme when nothing is stored", () => {
        const state = readThemeState(fakeStorage());
        assert.equal(activeThemeName(state), DEFAULT_THEME_NAME);
        assert.equal(activeThemeCss(state), "");
    });

    it("does not trust an unsafe or missing active name", () => {
        const storage = fakeStorage(
            JSON.stringify({
                themes: [{ name: 'x"', json: theme('x"'), css: ':root[data-theme="x"]' }],
                active: 'x"] body { display: none',
                mode: "dark",
                advancedCss: "",
            }),
        );
        const state = readThemeState(storage);
        assert.equal(activeThemeName(state), DEFAULT_THEME_NAME);
        assert.equal(activeThemeCss(state), "");
    });

    it("survives malformed storage", () => {
        for (const raw of ["", "null", "[]", "{oops", '{"themes":"nope","active":42}']) {
            const state = readThemeState(fakeStorage(raw));
            assert.equal(activeThemeName(state), DEFAULT_THEME_NAME, raw);
            assert.deepEqual(state.themes, []);
        }
    });
});
