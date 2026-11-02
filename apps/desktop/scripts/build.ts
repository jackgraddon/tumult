/**
 * Compile the main process: `src/main.ts` → `dist/main.cjs`, one CommonJS
 * bundle with `electron` external. Bundled (esbuild) rather than emitted per
 * file (tsc) because the main process imports from `apps/web` — the plugin-asset
 * proxy, `vercel.json`'s rules and the shared desktop constants — and a bundle
 * is what lets the packaged app carry no `node_modules` at all.
 *
 * A second bundle, the one native bridge the shell breaks its bridge-less
 * stance for: `src/preload.ts` → `dist/preload.cjs`, the context-isolated
 * `window.tumultNative` the main window loads (the auth child window loads none).
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { loadEnv } from "vite";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(appRoot, "..", "..");

// The same env files the web build reads (`apps/web/vite.config.ts`'s envDir),
// so the call frame the CSP allows is the call frame the permission policy
// trusts.
const env = loadEnv("production", repoRoot, "VITE_");

await mkdir(join(appRoot, "dist"), { recursive: true });
await build({
    entryPoints: [join(appRoot, "src", "main.ts")],
    outfile: join(appRoot, "dist", "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
    logLevel: "warning",
    define: {
        __TUMULT_ELEMENT_CALL_URL__: JSON.stringify(env.VITE_ELEMENT_CALL_URL ?? ""),
    },
});

/**
 * The native bridge the shell breaks its bridge-less stance for: the main
 * window's `preload.cjs` (a sandbox, context-isolated `contextBridge` exposing
 * `window.tumultNative`), built alongside `main.cjs` from the same source.
 */
await build({
    entryPoints: [join(appRoot, "src", "preload.ts")],
    outfile: join(appRoot, "dist", "preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
    logLevel: "warning",
});

// The window icon (Linux/X11 reads it from the BrowserWindow; packages carry
// their own copies from build/icons).
await copyFile(join(appRoot, "build", "icons", "512x512.png"), join(appRoot, "dist", "icon.png"));
console.log("built dist/main.cjs");
console.log("built dist/preload.cjs");
