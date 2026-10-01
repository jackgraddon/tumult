import { onScopeDispose, shallowRef, type ShallowRef } from "vue";
import type { Subscribable } from "@tumult/core";

/**
 * Bridge a core {@link Subscribable} into Vue reactivity.
 *
 * `shallowRef` is deliberate. Core hands us whole snapshots and replaces them
 * on every change, so there is nothing to gain from deep reactivity — and a lot
 * to lose, since `reactive`/`ref` would walk large arrays of messages on every
 * sync batch. Comparing by identity is enough because core never mutates a
 * snapshot it has already published.
 */
export function useSubscribable<T>(source: Subscribable<T>): Readonly<ShallowRef<T>> {
    const state = shallowRef<T>(source.get());

    const subscription = source.subscribe((value) => {
        state.value = value;
    });

    // Tied to the owning scope rather than the component instance, so this also
    // works inside composables used outside setup().
    onScopeDispose(() => subscription.unsubscribe());

    return state;
}
