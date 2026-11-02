/**
 * The native activity feed, and the one native bridge the shell wires it from.
 *
 * A browser tab cannot observe the operating system, so a "what app am I using"
 * signal simply does not exist on the web. On desktop the shell breaks the
 * bridge-less stance — deliberately, as one narrow, declared exception — by
 * having the Electron main process accept a loopback RPC connection (a
 * `SET_ACTIVITY` / `CLEAR` from a native app) and broadcast it to its windows
 * over a `contextBridge` preload that exposes `window.tumultNative`. The preload
 * runs in an isolated world, so it is NOT a `script-src`-governed script: the
 * application's CSP is untouched. This module is web-only in *shape*: it builds
 * the feed from the bridge when the bridge is present (desktop) and an empty
 * feed otherwise (web, or desktop before a native app has pushed anything), so a
 * plugin that consumes `ctx.nativeActivity()` degrades cleanly to "nothing to
 * show".
 *
 * The bridge is the single, narrow surface the page can reach: a start snapshot
 * and one change event. It is receive-only — there is no command back into
 * native from the page; the producer is the RPC client on the desktop side.
 */

import type { NativeActivity, NativeActivityFeed } from "./types.ts";

/**
 * The preload's bridge into the renderer. The main process is the only writer
 * (it relays a native `SET_ACTIVITY` / `CLEAR`); the web shell reads it through
 * this shape and never the other way round. Kept intentionally tiny: a snapshot
 * and an event handler, no handles, no reach beyond itself.
 */
export interface NativeActivityBridge {
    /** The most recent native activity, or null when none is active. */
    readonly snapshot: () => NativeActivity | null;
    /**
     * Subscribe to native changes; the handler receives the new value (or null
     * for a clear). Returns an unsubscribe the caller runs on teardown.
     */
    readonly onActivity: (
        callback: (activity: NativeActivity | null) => void,
    ) => () => void;
}

/** Declare the bridge on the global `window` so the shell can read it. */
declare global {
    interface Window {
        /** Present only on desktop, set by the preload before the page's JS runs. */
        tumultNative?: NativeActivityBridge;
    }
}

/**
 * A feed with no native source: the web, a desktop with no producer active, or a
 * bridge not yet set. `current` is always null; a subscriber is delivered a
 * single null at subscription time so a consumer settles to "nothing active"
 * rather than waiting forever on an undelivered value.
 */
export function emptyNativeActivityFeed(): NativeActivityFeed {
    return {
        current: () => null,
        subscribe: (callback) => {
            callback(null);
            return () => {};
        },
    };
}

/**
 * The live pair a shell owns: the feed a plugin sees, plus the disposer that
 * tears the feed's own bridge subscription down on shell stop. The disposer is
 * separate from `NativeActivityFeed` on purpose — a plugin gets only the feed
 * (an object every plugin shares through `ctx.nativeActivity()`), so it cannot
 * cut the bridge out from under anyone else by disposing it.
 */
export interface NativeActivityFeedController {
    /** The feed to hand out through `ctx.nativeActivity()` / `PluginDeps`. */
    readonly feed: NativeActivityFeed;
    /** Tear the bridge subscription down and drop every subscriber. */
    dispose(): void;
}

/**
 * Build the shell's native activity feed. When a bridge is present the feed
 * tracks the latest value from `snapshot()` and every native change; otherwise
 * it is the empty feed. The feed is shell-owned and outlives any single plugin,
 * so a plugin's `subscribe` is NOT registry-tracked: the plugin tears its own
 * subscription down through the disposable `subscribe` returns.
 */
export function createNativeActivityFeed(bridge: NativeActivityBridge | null | undefined): NativeActivityFeedController {
    if (!bridge) {
        const empty = emptyNativeActivityFeed();
        return { feed: empty, dispose: () => {} };
    }

    let last: NativeActivity | null = bridge.snapshot() ?? null;
    const subscribers = new Set<(activity: NativeActivity | null) => void>();
    // The bridge subscription is the feed's, not any one plugin's: it survives
    // every plugin install/uninstall and is torn down only by `dispose`.
    const unsubscribeBridge = bridge.onActivity((activity) => {
        last = activity;
        for (const callback of subscribers) callback(activity);
    });

    let disposed = false;
    return {
        feed: {
            current: () => last,
            subscribe: (callback) => {
                subscribers.add(callback);
                // Deliver the current value immediately, so a plugin that starts
                // after an activity is already set still sees it.
                callback(last);
                let done = false;
                return () => {
                    if (done) return;
                    done = true;
                    subscribers.delete(callback);
                };
            },
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribeBridge();
            subscribers.clear();
        },
    };
}
