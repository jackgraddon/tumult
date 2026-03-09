import { listen } from '@tauri-apps/api/event';
import { usePresenceStore } from '~/stores/presence';

export default defineNuxtPlugin(() => {
    console.log('[GameDetectionPlugin] Plugin loaded!');

    if (!(window as any).__TAURI_INTERNALS__) {
        console.log('[GameDetectionPlugin] Not in Tauri, skipping.');
        return;
    }

    const presenceStore = usePresenceStore();

    console.log('[GameDetectionPlugin] Initializing Discord RPC listener...');

    // Bind the Tauri event listener for grid-rpc-activity events
    listen<any>('grid-rpc-activity', (event) => {
        console.log('[GameDetectionPlugin] Discord RPC Activity:', event.payload);
        presenceStore.updateGame(event.payload);
    }).then(unlisten => {
        // Optional: unlisten on plugin cleanup if Nuxt supported it
    }).catch(e => {
        console.error('[GameDetectionPlugin] Failed to bind Discord RPC listener:', e);
    });
});
