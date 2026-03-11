
export function useGameActivity() {
    const store = useMatrixStore();

    // Check for Tauri support
    const isSupported = ref(false);
    if (import.meta.client) {
        isSupported.value = !!(window as any).__TAURI_INTERNALS__;
    }

    function toggle() {
        store.setGameDetectionLevel(store.gameDetectionLevel === 'off' ? 'basic' : 'off');
    }

    return {
        isEnabled: computed(() => store.gameDetectionLevel !== 'off'),
        gameDetectionLevel: computed(() => store.gameDetectionLevel),
        isSupported: computed(() => isSupported.value),
        currentActivity: computed(() => store.activityDetails?.name || null),
        toggle
    };
}