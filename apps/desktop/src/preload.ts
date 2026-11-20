/**
 * The preload: the two declared native bridges the shell breaks its bridge-less
 * stance for (see `plugins/native-activity.ts` and `updater/bridge.ts`).
 *
 * It runs in an ISOLATED world (Electron `contextIsolation`, on by default), so
 * it is NOT a `script-src`-governed script and the app's CSP is untouched — the
 * page never `import`s anything here. It exposes exactly two things on `window`
 * through {@link contextBridge}: `window.tumultNative`, the
 * `NativeActivityFeed` the shell builds via `createNativeActivityFeed`; and
 * `window.tumultUpdater`, a narrow view of the main process's updater.
 *
 * The activity bridge is receive-only from the page: it reads a snapshot and
 * subscribes, and the producer is the RPC client on the desktop main side. The
 * updater bridge can carry three commands (check, download, install), but the
 * main process owns every decision: the page cannot name a feed, a path or a
 * process to launch.
 */

import { contextBridge, ipcRenderer } from "electron";

import { NATIVE_ACTIVITY_IPC, UPDATER_IPC } from "../../web/src/desktop.ts";

// The bridge value types, the same shapes the shell reads. `import type` only —
// esbuild erases them, so the renderer-side preload never pulls Vue or the RPC
// server's `node:net` module in.
import type { UpdateSnapshot } from "../../../packages/ui/src/updater/bridge.ts";
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

/** Mirror `DesktopUpdaterBridge`: a snapshot, a change event and three commands. */
interface TumultUpdaterBridge {
    snapshot: () => UpdateSnapshot;
    onUpdate: (callback: (snapshot: UpdateSnapshot) => void) => () => void;
    check: () => Promise<UpdateSnapshot>;
    download: () => Promise<UpdateSnapshot>;
    install: () => void;
}

// `sendSync` is deliberate and bounded: it runs once, before any page script,
// so the settings page can render the true state on its first frame without a
// loading flicker. Every later change arrives on the push channel.
let updateSnapshot: UpdateSnapshot = ipcRenderer.sendSync(UPDATER_IPC.snapshot) as UpdateSnapshot;
const updateSubscribers = new Set<(snapshot: UpdateSnapshot) => void>();

ipcRenderer.on(UPDATER_IPC.update, (_event, next: UpdateSnapshot) => {
    updateSnapshot = next;
    for (const callback of updateSubscribers) callback(next);
});

const updaterBridge: TumultUpdaterBridge = {
    snapshot: () => updateSnapshot,
    onUpdate(callback) {
        updateSubscribers.add(callback);
        callback(updateSnapshot);
        let done = false;
        return () => {
            if (done) return;
            done = true;
            updateSubscribers.delete(callback);
        };
    },
    check: () => ipcRenderer.invoke(UPDATER_IPC.check) as Promise<UpdateSnapshot>,
    download: () => ipcRenderer.invoke(UPDATER_IPC.download) as Promise<UpdateSnapshot>,
    install: () => ipcRenderer.send(UPDATER_IPC.install),
};

contextBridge.exposeInMainWorld("tumultUpdater", updaterBridge);
