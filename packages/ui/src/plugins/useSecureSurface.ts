import { onScopeDispose, watch } from "vue";

import { suspendPluginStyles } from "./styles.ts";

/**
 * Mark a component as a security surface: while `active()` is true, every
 * plugin stylesheet is off, so no plugin CSS can disguise what the user is
 * agreeing to (security review finding F3 — see `suspendPluginStyles`).
 * Used by the install consent dialog, the security modal, emoji verification,
 * recovery, and the Security settings page.
 */
export function useSecureSurface(active: () => boolean = () => true): void {
    let release: (() => void) | null = null;
    watch(
        active,
        (on) => {
            if (on && !release) release = suspendPluginStyles();
            if (!on && release) {
                release();
                release = null;
            }
        },
        { immediate: true },
    );
    onScopeDispose(() => {
        release?.();
        release = null;
    });
}
