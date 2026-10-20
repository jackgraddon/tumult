/**
 * The app's sandbox Worker entry.
 *
 * Vite needs a real module path inside the app to turn into a Worker chunk, and
 * `@tumult/ui` ships sources rather than a built file — so this one-line module
 * is the seam: it exists only to give `new Worker(new URL(…))` a local target.
 * ALL the behaviour lives in `@tumult/ui`'s shim, which registers its own
 * `message` listener on import.
 *
 * Keeping the path here (rather than pointing the URL across into
 * `packages/ui/src/…`) means the Worker stays inside the app's module graph, so
 * the app's aliases and the `@tumult/ui` tsconfig mapping both apply to it.
 */

import "@tumult/ui/sandbox";

export {};
