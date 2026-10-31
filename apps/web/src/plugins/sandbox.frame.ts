/**
 * The sandbox frame's bootstrap — served as `/sandbox.js` by `/sandbox.html`.
 *
 * NOT part of the app bundle: `vite.config.ts`'s `sandboxFrame` plugin builds it
 * on its own as a CLASSIC (IIFE) script, because the frame's origin is opaque
 * and an opaque-origin document fetches module scripts in CORS mode — a
 * `type="module"` script from our own server would be refused for lacking
 * `Access-Control-Allow-Origin`. The inner Worker's code (`sandbox.worker.ts`,
 * i.e. `@tumult/ui/sandbox`) is built first and inlined here as a string, then
 * started from a `blob:` URL minted INSIDE the frame: a Worker script URL must
 * be same-origin with the opaque document, which only its own blobs are.
 *
 * All the logic is `startSandboxFrame` in `@tumult/ui` (tested there); this file
 * only binds it to the frame's real globals.
 */

import { startSandboxFrame } from "@tumult/ui/sandbox/frame";
import type { InnerWorker, PortLike } from "@tumult/ui/sandbox/frame";

declare const __TUMULT_SANDBOX_WORKER__: string;

startSandboxFrame({
    parent: window.parent,
    listen: (listener) =>
        window.addEventListener("message", (event) => {
            listener({ source: event.source, ports: event.ports as readonly PortLike[] });
        }),
    createWorker: () => {
        const url = URL.createObjectURL(new Blob([__TUMULT_SANDBOX_WORKER__], { type: "text/javascript" }));
        try {
            return new Worker(url, { name: "tumult-plugin-sandbox" }) as unknown as InnerWorker;
        } finally {
            // The Worker has captured the blob by now; the URL is not needed again.
            URL.revokeObjectURL(url);
        }
    },
});
