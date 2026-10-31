import { SyncState } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";

import type { ConnectionState } from "../contract.ts";
import type { Observable } from "../observable.ts";

/**
 * Map the SDK's sync lifecycle onto the coarser state the UI cares about.
 *
 * `Prepared` and `Catchup` both mean "we have a usable timeline" as far as the
 * UI is concerned, so both collapse to `syncing`. `Prepared` can be served
 * entirely from the IndexedDB cache, which is exactly why the listener has to
 * be attached before `startClient()` — otherwise a warm start emits it before
 * anyone is listening and the UI hangs on `starting` forever.
 */
export function toConnectionState(state: SyncState | null): ConnectionState {
    switch (state) {
        case SyncState.Prepared:
        case SyncState.Syncing:
        case SyncState.Catchup:
            return "syncing";
        case SyncState.Reconnecting:
            return "reconnecting";
        case SyncState.Error:
            return "error";
        case SyncState.Stopped:
            return "stopped";
        default:
            return "starting";
    }
}

/** The slice of `window` that {@link watchNetwork} needs. */
export interface NetworkTarget {
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
}

/**
 * Follow the browser's own view of the network. Left to the sync loop, an
 * outage is noticed only when the current long-poll fails — measured at
 * 0–30 s by the network-outage test — and recovery waits out the SDK's
 * retry back-off. The browser knows at once: on `offline` say so
 * ("reconnecting"), on `online` restart the sync now.
 *
 * Returns the unwatch closure, or `null` outside a browser (no
 * `addEventListener` on the target), where it is a no-op. The client's stop()
 * calls the closure.
 */
export function watchNetwork(
    client: Pick<MatrixClient, "retryImmediately">,
    connection: Observable<ConnectionState>,
    target: NetworkTarget = globalThis as NetworkTarget,
): (() => void) | null {
    if (typeof target.addEventListener !== "function") return null;
    const onOffline = (): void => {
        if (connection.get() === "syncing") connection.set("reconnecting");
    };
    const onOnline = (): void => {
        client.retryImmediately();
    };
    target.addEventListener("offline", onOffline);
    target.addEventListener("online", onOnline);
    return () => {
        target.removeEventListener?.("offline", onOffline);
        target.removeEventListener?.("online", onOnline);
    };
}
