
import { usePresenceStore } from '~/stores/presence';

export function useGameActivity() {
    const store = useMatrixStore();
    const presence = usePresenceStore();

    // Check for Tauri support
    const isSupported = ref(false);
    if (import.meta.client) {
        isSupported.value = !!(window as any).__TAURI_INTERNALS__;
    }

    function toggle() {
        store.setGameDetection(!store.isGameDetectionEnabled);
    }

    return {
        isEnabled: computed(() => store.isGameDetectionEnabled),
        isSupported: computed(() => isSupported.value),
        currentActivity: computed(() => presence.activeGame?.name || null),
        toggle
    };
}