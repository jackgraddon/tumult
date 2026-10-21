import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";

/**
 * Build the plugin bundle.
 *
 * One ESM file, no externals — except `vue`, which is aliased to the shim
 * below. That indirection is load-bearing: a plugin must share the host's Vue
 * instance (`provide`/`inject` and reactivity are per-instance), so bundling a
 * second copy of Vue would produce a plugin that renders but cannot talk to the
 * shell. The shim forwards to `globalThis.__tumult.vue`, which Tumult installs
 * before it imports any plugin bundle.
 *
 * Vite is here because plugins are written as single-file components —
 * esbuild cannot compile an SFC, and a hand-written `render()` function for
 * anything beyond a slash command would be unreadable.
 *
 * Output name must match `entry` in `tumult.plugin.json` (and the copy in
 * `src/index.ts`). The release workflow hashes what this writes and attaches
 * that one file — so the build must not emit a sibling stylesheet: CSS travels
 * inside the bundle, injected with `ctx.injectStylesheet()`. The guard below
 * fails the build if one appears, because a stylesheet the release does not
 * attach is a silent loss.
 */
export default defineConfig({
    plugins: [vue(), refuseSiblingStylesheet()],
    resolve: {
        alias: [
            {
                // Exact match: `vue/jsx-runtime` is not the shim.
                find: /^vue$/,
                replacement: fileURLToPath(new URL("./src/shims/vue.ts", import.meta.url)),
            },
        ],
    },
    build: {
        lib: {
            entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
            formats: ["es"],
            fileName: () => "plugin.js",
        },
        outDir: "dist",
        emptyOutDir: true,
        target: "es2022",
        minify: "esbuild",
        sourcemap: false,
        cssCodeSplit: false,
    },
});

/**
 * Refuse a build that emitted a stylesheet beside the bundle.
 *
 * The release attaches `plugin.js` and `tumult.plugin.json` — and nothing else.
 * A `<style>` block in an SFC would be extracted into `dist/plugin.css` and
 * dropped on the floor, so the plugin would ship unstyled with no error
 * anywhere. Styles belong in the bundle: keep them in a TypeScript string and
 * hand them to `ctx.injectStylesheet()`.
 */
function refuseSiblingStylesheet(): Plugin {
    return {
        name: "tumult:refuse-sibling-stylesheet",
        enforce: "post",
        closeBundle() {
            const stray = fileURLToPath(new URL("./dist/plugin.css", import.meta.url));
            if (!existsSync(stray)) return;
            throw new Error(
                "The build emitted dist/plugin.css, which the release does not attach — " +
                    "the plugin would ship unstyled, silently. Keep your CSS in a string " +
                    "and inject it with ctx.injectStylesheet().",
            );
        },
    };
}
