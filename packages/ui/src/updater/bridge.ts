/**
 * The desktop update bridge: the second narrow native surface, alongside the
 * native activity feed.
 *
 * The web has no installer to talk to, so there is no updater there. On desktop
 * the preload exposes `window.tumultUpdater`; the shell provides it to its own
 * settings page and registers the Updates tab only when it is present. The main
 * process owns every decision: the page can ask for a check, a download and an
 * install, and observe snapshots. It cannot name a feed, a file path or a
 * process to launch.
 *
 * Nothing here imports Electron or `electron-updater`: this is the shape the
 * renderer compiles against, and it degrades to absence on web exactly like the
 * native activity bridge.
 */

import type { InjectionKey } from "vue";

/** The states an installable desktop build can be in. */
export type UpdatePhase =
    | "unsupported"
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error";

/**
 * One immutable snapshot. Errors are already UI-safe sentences (the main
 * process logs the raw failure with the same context), so the renderer never
 * has to translate an updater exception.
 */
export interface UpdateSnapshot {
    readonly phase: UpdatePhase;
    /** The version found by the last successful check, once there is one. */
    readonly version?: string;
    /** Download progress, 0–1, while `phase === "downloading"`. */
    readonly progress?: number;
    /** A sentence to show when `phase === "error"` or `"unsupported"`. */
    readonly message?: string;
}

/** The whole surface the renderer has to the main process's updater. */
export interface DesktopUpdaterBridge {
    /** The current state, immediately available before subscribing. */
    readonly snapshot: () => UpdateSnapshot;
    /** Subscribe to state changes. Returns an unsubscribe for teardown. */
    readonly onUpdate: (callback: (snapshot: UpdateSnapshot) => void) => () => void;
    /** Ask the main process to check the published feed. */
    readonly check: () => Promise<UpdateSnapshot>;
    /** Download the version the last check found. */
    readonly download: () => Promise<UpdateSnapshot>;
    /**
     * Close the app and apply the downloaded update. This may never resolve:
     * the process exits while the replacement is made.
     */
    readonly install: () => void;
}

/** The shell provides the bridge (or null on web) to the Updates settings page. */
export const DesktopUpdaterKey: InjectionKey<DesktopUpdaterBridge | null> = Symbol("tumult/desktop-updater");

declare global {
    interface Window {
        /** Present only in the desktop main window, set by the preload. */
        tumultUpdater?: DesktopUpdaterBridge;
    }
}
