/**
 * The plugin-facing icon bridge: paths cross the boundary, the registry does
 * not, and an unknown name is a normal null rather than a rejection.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { IconRegistry } from "../src/icons/registry.ts";
import { installIconBridge } from "../src/plugins/iconBridge.ts";

interface TumultGlobals {
    icons?: unknown;
    [key: string]: unknown;
}

const globals = globalThis as typeof globalThis & { __tumult?: TumultGlobals };
const previous = globals.__tumult;

afterEach(() => {
    if (previous === undefined) delete globals.__tumult;
    else globals.__tumult = previous;
});

describe("plugin icon bridge", () => {
    it("publishes a resolver that returns only the SVG path and viewBox", async () => {
        const registry = new IconRegistry();
        registry.addPack("test", {
            resolve(name) {
                return name === "play" ? { path: "M8,5V19", viewBox: 32 } : undefined;
            },
        });

        const api = installIconBridge(registry);
        assert.equal(globals.__tumult?.icons, api);
        assert.deepEqual(await api.resolve("test:play"), { path: "M8,5V19", viewBox: 32 });
        assert.deepEqual(await api.resolve("test:pause"), null);
    });

    it("merges with the Vue bridge instead of replacing it", () => {
        const vue = { marker: true };
        globals.__tumult = { vue };
        const api = installIconBridge(new IconRegistry());
        assert.equal(globals.__tumult?.vue, vue);
        assert.deepEqual(Object.keys(globals.__tumult ?? {}).sort(), ["icons", "vue"]);
        assert.equal(globals.__tumult?.icons, api);
    });
});
