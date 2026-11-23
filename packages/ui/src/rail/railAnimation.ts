import { inject, type InjectionKey, type Ref } from "vue";

/**
 * Rail transitions are a host concern, not part of the public selection
 * contract. Rooms resolve after the route on a cold boot, so the active tile
 * would otherwise animate from idle on load. The shell flips this on the first
 * real pick, and only then do tiles transition.
 */
export const RailAnimationsKey: InjectionKey<Ref<boolean>> = Symbol("tumult/rail-animations");

export function useRailAnimations(): Ref<boolean> | null {
    return inject(RailAnimationsKey, null);
}
