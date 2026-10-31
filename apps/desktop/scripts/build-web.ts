/**
 * Build `apps/web` for the desktop: the web app's own Vite config, with
 * `VITE_DESKTOP=1` (the one behavioural difference — see `apps/web/vite.config.ts`)
 * and the output written here, where the main process serves it from.
 *
 *   node scripts/build-web.ts          → web/       (real client; needs VITE_CLIENT_URI)
 *   node scripts/build-web.ts --fake   → web-fake/  (fake client, for the smoke test)
 *
 * The real build is what `dev` runs and what electron-builder packages; the
 * fake build is only ever served through `TUMULT_WEB_ROOT`, which a packaged
 * app ignores.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot = join(appRoot, "..", "web");
const fake = process.argv.includes("--fake");

// Read by vite.config.ts's loadEnv (which merges process.env) and exposed to
// the bundle as import.meta.env.VITE_DESKTOP.
process.env.VITE_DESKTOP = "1";

await build({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    mode: fake ? "fake" : "production",
    logLevel: "warn",
    build: { outDir: join(appRoot, fake ? "web-fake" : "web"), emptyOutDir: true },
});
console.log(`built ${fake ? "web-fake" : "web"}/ (VITE_DESKTOP=1)`);
