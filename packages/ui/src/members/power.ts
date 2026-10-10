import { onScopeDispose, shallowRef, watch, type ShallowRef } from "vue";
import type { ChatClient, RoomPowerLevelsView } from "@tumult/core";

/**
 * Follow the power-levels feed for whichever room is current.
 *
 * `useSubscribable` takes one fixed source, but core returns a different
 * `Subscribable` per roomId — so a room switch has to drop the old
 * subscription and take the new one. That means a watcher, not a one-shot
 * bridge. The client also throws before `start()`, so a missing feed resolves
 * to `null` (no gating information) rather than surfacing as a crash.
 */
export function useRoomPower(
    client: ChatClient,
    roomId: () => string | undefined,
): Readonly<ShallowRef<RoomPowerLevelsView | null>> {
    const state = shallowRef<RoomPowerLevelsView | null>(null);
    let unsubscribe: (() => void) | null = null;

    watch(
        roomId,
        (id) => {
            unsubscribe?.();
            unsubscribe = null;
            if (!id) {
                state.value = null;
                return;
            }
            let source;
            try {
                source = client.powerLevels(id);
            } catch {
                state.value = null;
                return;
            }
            state.value = source.get();
            const subscription = source.subscribe((value) => {
                state.value = value;
            });
            unsubscribe = () => subscription.unsubscribe();
        },
        { immediate: true },
    );

    onScopeDispose(() => unsubscribe?.());
    return state;
}
