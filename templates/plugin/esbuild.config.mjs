/**
 * Build the plugin bundle.
 *
 * One ESM file, no externals — except `vue`, which is aliased to the shim
 * below. That indirection is load-bearing: a plugin must share the host's Vue
 * instance (`provide`/`inject` and reactivity are per-instance), so bundling a
 * second copy of Vue would produce a plugin that renders but cannot talk to
 * the shell. The shim forwards to `globalThis.__tumult.vue`, which Tumult sets
 * before it installs anything.
 *
 * Output name must match `entry` in `tumult.plugin.json` (and the copy in
 * `src/index.ts`). The release workflow hashes what this writes.
 */
import { build } from "esbuild";

await build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/plugin.js",
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    alias: { vue: "./src/shims/vue.ts" },
    logLevel: "info",
});
