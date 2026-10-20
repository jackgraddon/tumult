/**
 * Guards the generated plugin type declarations against drift.
 *
 * `templates/plugin/types/plugin.d.ts` is what a plugin author typechecks
 * against, and it is generated — not hand-written — from
 * `packages/ui/src/plugins/authoring.ts` by `scripts/build-plugin-types.ts`.
 * This test runs the same builder the `emit:types` script runs and fails when
 * the committed file differs, so the vendored surface can only change when
 * someone regenerates and commits it.
 *
 * The point is that a hand-maintained copy drifts SILENTLY: the workspace
 * example (`tsconfig.workspace.json`) only pins what that one example happens
 * to touch. Generating the file removes the class of drift entirely — the
 * committed bytes are a function of the real sources.
 *
 * Also asserted: the two properties that keep the file usable in a bare plugin
 * checkout (it must not grow imports beyond `vue`, and it must carry the real
 * version constants rather than stale literals).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildPluginTypes, PLUGIN_TYPES_TARGET } from "../scripts/build-plugin-types.ts";
import { PLUGIN_API_VERSION } from "../src/plugins/compat.ts";
import { CONTRACT_VERSION } from "@tumult/core/contract";

const committed = readFileSync(PLUGIN_TYPES_TARGET, "utf8");

describe("generated plugin types", () => {
    it("the committed file is exactly what the generator produces", () => {
        assert.equal(
            committed,
            buildPluginTypes(),
            "templates/plugin/types/plugin.d.ts is stale — run: pnpm --filter @tumult/ui emit:types",
        );
    });

    it("imports only `vue` (a plugin checkout has no Tumult packages)", () => {
        const imports = [...committed.matchAll(/^import .* from '([^']+)';$/gm)].map(
            (match) => match[1],
        );
        assert.deepEqual(imports, ["vue"], "the vendored file may only import `vue` for types");
    });

    it("has no `declare module` blocks (it is one flat, self-contained file)", () => {
        assert.ok(
            !/^declare module /m.test(committed),
            "an external module block would not resolve in a plugin checkout",
        );
    });

    it("pins the live API and contract versions, not stale literals", () => {
        assert.ok(
            committed.includes(`export declare const PLUGIN_API_VERSION = "${PLUGIN_API_VERSION}"`),
            "the generated file must carry the current PLUGIN_API_VERSION",
        );
        assert.ok(
            committed.includes(`export declare const CONTRACT_VERSION = "${CONTRACT_VERSION}"`),
            "the generated file must carry the current CONTRACT_VERSION",
        );
    });

    it("covers the whole author surface, every extension point included", () => {
        for (const name of [
            "Plugin",
            "PluginContext",
            "PluginManifest",
            "PluginApi",
            "ChatClient",
            "RendererEntry",
            "ComposerAction",
            "Command",
            "MemberDecoration",
            "SettingsTab",
            "deriveLane",
            "PLUGIN_PERMISSIONS",
        ]) {
            assert.ok(
                new RegExp(`\\b${name}\\b`).test(committed),
                `the author surface must export ${name}`,
            );
        }
    });
});
