import { computed, type ComputedRef } from "vue";
import type { ChatClient, ConnectionState } from "@tumult/core";

import { useSubscribable } from "./subscribable.ts";

/**
 * Whether the client's per-room feeds (`timeline()`, `members()`, `banned()`,
 * `powerLevels()`) exist yet. They throw before `start()` has built them, and
 * the shell now paints the cached room list — and the resumed room — before
 * that, so a component that subscribes once in setup would catch the throw
 * and stay on its placeholder for good.
 *
 * Key such a component on this flag (alongside its roomId) so it remounts and
 * subscribes for real once the feeds exist. Leaving `starting` is the signal:
 * the real client builds every feed before `startClient()`, and the sync
 * listener that moves the state on only fires after that.
 */
export function isFeedsReady(state: ConnectionState): boolean {
    return state !== "starting" && state !== "stopped";
}

export function useFeedsReady(client: ChatClient): ComputedRef<boolean> {
    const connection = useSubscribable(client.connection);
    return computed(() => isFeedsReady(connection.value));
}
