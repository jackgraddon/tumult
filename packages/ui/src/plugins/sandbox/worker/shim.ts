/**
 * The Worker-side sandbox entry — thin, because `runtime.ts` holds the logic.
 *
 * This module exists to be the Worker's main script: it binds the testable
 * runtime factory to the real Worker globals (`self`, `URL`, dynamic `import()`)
 * and that is all it does. Everything the bridge actually does lives in
 * `runtime.ts`, which takes those as an injected `SandboxScope` so the entire
 * host↔worker protocol can be tested in-process without a browser.
 *
 * A sandbox plugin's `ctx` differs from the in-page one in five ways, each
 * forced by the boundary rather than chosen:
 *
 *   - **Subscriptions become pushes.** A feed's snapshot lives on the host, so
 *     each feed is opened once by key; `.get()` reads the latest pushed value.
 *   - **`media.resolve*` mints its own URL.** A `blob:` URL made on the host is
 *     unreachable in a Worker, so these fetch bytes through the client and build
 *     a Worker-local `blob:` URL — which is why they are async here.
 *   - **Functions do not cross.** A command's `run` stays in this Worker as a
 *     table entry; the contribution carries `{ kind: "callback", id }` instead,
 *     and the host calls back with `invoke`.
 *   - **The two synchronous members are cached.** `supportsThreads()` and
 *     `hasMoreRooms()` cannot await across a boundary, so their values arrive as
 *     a pushed snapshot (see `SandboxCapabilities`) rather than being guessed.
 *   - **Component permissions are refused.** A renderer/decoration/settings-tab
 *     is a live Vue component, which the lane rule already excludes; the stubs
 *     throw rather than register nothing.
 */

import { createSandboxRuntime, type SandboxScope } from "./runtime.ts";
import type { WorkerMessage } from "../protocol.ts";

/** The Worker global, narrowed to just what the runtime needs. */
interface WorkerGlobalScope {
    postMessage(message: WorkerMessage): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    close(): void;
    URL: {
        createObjectURL(blob: Blob): string;
        revokeObjectURL(url: string): void;
    };
}

const workerScope = self as unknown as WorkerGlobalScope;

const scope: SandboxScope = {
    postMessage: (message) => workerScope.postMessage(message),
    addEventListener: (type, listener) => workerScope.addEventListener(type, listener),
    close: () => workerScope.close(),
    createObjectUrl: (blob) => workerScope.URL.createObjectURL(blob),
    revokeObjectUrl: (url) => workerScope.URL.revokeObjectURL(url),
    // `import()` must be spelled literally for a bundler to leave it as a real
    // dynamic import; a variable holding it would be rewritten into a chunk
    // lookup that cannot see our runtime `blob:` URL.
    importModule: (url) => import(/* @vite-ignore */ url) as Promise<unknown>,
};

// Constructing the runtime binds its message handler to the scope, so this is
// the whole entry point: the bridge is live as soon as `init` arrives.
createSandboxRuntime(scope);
