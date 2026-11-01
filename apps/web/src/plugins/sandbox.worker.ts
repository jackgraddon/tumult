/**
 * The sandbox's inner Worker entry.
 *
 * `vite.config.ts`'s `sandboxFrame` plugin bundles this into a self-contained
 * classic script and inlines it into the frame bootstrap (`sandbox.frame.ts`),
 * which starts it as a `blob:` Worker INSIDE the opaque-origin sandbox frame.
 * It is never a Worker of the app's own origin, and never part of the app
 * bundle. ALL the behaviour lives in `@tumult/ui`'s shim, which registers its
 * own `message` listener on import.
 *
 * Keeping the entry here (rather than pointing the build across into
 * `packages/ui/src/…`) means it resolves through the app's own dependency on
 * `@tumult/ui`, like the rest of the app.
 */

import "@tumult/ui/sandbox";

export {};
