/**
 * The preload: the one declared native bridge the shell breaks its bridge-less
 * stance for (see `plugins/native-activity.ts`).
 *
 * It runs in an ISOLATED world (Electron `contextIsolation`, on by default), so
 * it is NOT a `script-src`-governed script and the app's CSP is untouched — the
 * page never `import`s anything here. It exposes exactly one thing on `window`
 * through {@link contextBridge}: `window.tumultNative`, the
 * `NativeActivityFeed` the shell builds via `createNativeActivityFeed`. It holds
 * the latest activity and a subscriber set, and the main process drives it over
 * {@link NATIVE_ACTIVITY_IPC}: a native `SET_ACTIVITY`/`CLEAR` the RPC server
 * accepted becomes an `ipcRenderer` send the preload turns into a feed change.
 *
 * The bridge is receive-only from the page: it reads a snapshot and subscribes.
 * The producer is the RPC client on the desktop main side, never a callback into
 * native from the renderer.
 */

import { contextBridge, ipcRenderer } from "electron";

import { NATIVE_ACTIVITY_IPC } from "../../web/src/desktop.ts";

// The bridge's value type, the same shape the shell's `NativeActivityBridge`
// reads. `import type` only — esbuild erases it, so the renderer-side preload
// never pulls the RPC server's `node:net` module in.
import type { NativeActivity } from "./native-activity.ts";

/**
 * Mirror the `NativeActivityBridge` the shell expects on `window`: a start
 * snapshot plus an event handler. Built here (not by re-importing the UI module,
 * which would drag Vue in) but kept in lock-step with it — the smoke test reads
 * `window.tumultNative` directly, so a drift between this shape and the feed's
 * is caught end-to-end.
 */
interface TumultNativeBridge {
    /** The most recent native activity, or `null` when none is active. */
    snapshot: () => NativeActivity | null;
    /**
     * Subscribe to native changes — a new activity, an update, or a clear
     * (`null`) — delivered the current value immediately, so a consumer that
     * starts after an activity is already set still sees it. Returns an
     * unsubscribe the caller runs on teardown.
     */
    onActivity: (callback: (activity: NativeActivity | null) => void) => () => void;
}

let latest: NativeActivity | null = null;
const subscribers = new Set<(activity: NativeActivity | null) => void>();

ipcRenderer.on(NATIVE_ACTIVITY_IPC, (_event, activity: NativeActivity | null) => {
    latest = activity ?? null;
    for (const callback of subscribers) callback(latest);
});

const bridge: TumultNativeBridge = {
    snapshot: () => latest,
    onActivity(callback) {
        subscribers.add(callback);
        // Deliver the current value at subscription time, mirroring the feed a
        // plugin receives: a subscriber that joins after a set still sees it.
        callback(latest);
        let done = false;
        return () => {
            if (done) return;
            done = true;
            subscribers.delete(callback);
        };
    },
};

contextBridge.exposeInMainWorld("tumultNative", bridge);