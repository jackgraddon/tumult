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

/**
 * Defense in depth, not the boundary. This Worker is created INSIDE the
 * sandbox frame (`frame.ts`), whose origin is opaque, so the browser already
 * refuses it the app's storage: IndexedDB, caches and storage APIs either throw
 * or open an empty per-opaque-origin store that nothing else can see, and a
 * `blob:` URL minted by the app cannot even be loaded here. The withdrawal
 * below is kept anyway, so a plugin never even holds those handles — if a
 * browser bug, a regression in how the frame is mounted (say, a stray
 * `allow-same-origin`) or a future transport ever put this Worker back on the
 * app's origin, the plugin still could not open the SDK's crypto store, forge
 * a trusted-lane record in the plugin store, start a nested Worker with an
 * unstripped global, or register a service worker. The browser smoke test
 * checks both layers: the origin is "null" AND these globals are gone.
 *
 * Network (fetch, WebSocket) stays: there is no token here, and what the plugin
 * can read through the app at all is the policed bridge's business (policy.ts).
 */
const WITHDRAWN_GLOBALS = ["indexedDB", "caches", "Worker", "SharedWorker", "BroadcastChannel", "webkitRequestFileSystem", "webkitRequestFileSystemSync", "webkitResolveLocalFileSystemURL", "webkitResolveLocalFileSystemSyncURL"];
const WITHDRAWN_NAVIGATOR = ["storage", "locks", "serviceWorker"];

/**
 * Delete `name` from `target` AND from every prototype it inherits from:
 * removing only the own property leaves the prototype's getter, and
 * `Object.getOwnPropertyDescriptor(proto, "indexedDB").get.call(self)` brings
 * it straight back (the smoke test checks exactly that route).
 */
function withdraw(target: object, name: string): void {
    for (let holder: object | null = target; holder !== null; holder = Object.getPrototypeOf(holder)) {
        if (Object.prototype.hasOwnProperty.call(holder, name)) delete (holder as Record<string, unknown>)[name];
    }
}

/** Remove the capabilities above, then fail CLOSED if any survived. */
function lockDown(): void {
    const global = self as unknown as Record<string, unknown>;
    for (const name of WITHDRAWN_GLOBALS) withdraw(global, name);
    const navigatorObject = global["navigator"];
    if (typeof navigatorObject === "object" && navigatorObject !== null) {
        for (const name of WITHDRAWN_NAVIGATOR) withdraw(navigatorObject, name);
    }
    const survivors = [
        ...WITHDRAWN_GLOBALS.filter((name) => name in global),
        ...WITHDRAWN_NAVIGATOR.filter((name) => typeof navigatorObject === "object" && navigatorObject !== null && name in navigatorObject),
    ];
    if (survivors.length > 0) {
        throw new Error(`the sandbox could not withdraw ${survivors.join(", ")}; refusing to run a plugin with them`);
    }
}

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

// Before anything can import a plugin: a failure here means no runtime, so no
// `init` is ever answered and the host's handshake fails the plugin closed.
lockDown();

// Constructing the runtime binds its message handler to the scope, so this is
// the whole entry point: the bridge is live as soon as `init` arrives.
createSandboxRuntime(scope);
