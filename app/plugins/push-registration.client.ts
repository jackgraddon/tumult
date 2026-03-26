
export default defineNuxtPlugin(async (nuxtApp) => {
    const store = useMatrixStore();
    const config = useRuntimeConfig();

    // The relay URL is always the production one to ensure 
    // it works across local/dev/Tauri environments.
    const defaultRelayUrl = config.public.push.relayUrl;
    const vapidPublicKey = config.public.push.vapidPublicKey;

    /**
     * Helper to compare a BufferSource with a base64 VAPID key.
     */
    const isVapidKeyMatch = (appServerKey: ArrayBuffer | null, vapidBase64: string): boolean => {
        if (!appServerKey) return false;

        try {
            // Convert base64 to Uint8Array
            const binaryString = atob(vapidBase64.replace(/-/g, '+').replace(/_/g, '/'));
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const currentKey = new Uint8Array(appServerKey);
            if (currentKey.length !== bytes.length) return false;
            return currentKey.every((v, i) => v === bytes[i]);
        } catch (e) {
            console.error('[PushPlugin] Failed to compare VAPID keys:', e);
            return false;
        }
    };

    const subscribeToPush = async () => {
        if (!store.pushNotificationsEnabled) {
            console.log('[PushPlugin] Push notifications disabled in settings, skipping registration');
            return;
        }

        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('[PushPlugin] Service Worker or Push Manager not supported');
            return;
        }

        try {
            const registration = await navigator.serviceWorker.ready;

            // Check current subscription
            let subscription = await registration.pushManager.getSubscription();

            // 1. If subscription exists, verify it matches our current VAPID key
            if (subscription && !isVapidKeyMatch(subscription.options.applicationServerKey, vapidPublicKey)) {
                console.warn('[PushPlugin] VAPID key mismatch detected. Unsubscribing stale subscription...');
                await subscription.unsubscribe();
                subscription = null;
            }

            // 2. If no subscription (or just unsubscribed), create one
            if (!subscription) {
                console.log('[PushPlugin] Requesting new push subscription...');
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: vapidPublicKey
                });
            }

            if (subscription && store.client) {
                // 3. Verify if we already have this pusher registered on the homeserver and if it's valid
                const { pushers } = await store.client.getPushers();
                const currentPusher = pushers.find(p => p.app_id === 'cc.jackg');

                let needsUpdate = !currentPusher;

                if (currentPusher) {
                    // Check if the pushkey is valid JSON (not an old FCM URL)
                    try {
                        JSON.parse(currentPusher.pushkey);

                        // Check if URL matches
                        const relayUrl = (store.customPushEndpoint || defaultRelayUrl).replace(/\/$/, '');
                        const expectedUrl = `${relayUrl}/_matrix/push/v1/notify`;
                        if (currentPusher.data?.url !== expectedUrl) {
                            console.log('[PushPlugin] Pusher URL mismatch, updating...');
                            needsUpdate = true;
                        }
                    } catch (e) {
                        console.warn('[PushPlugin] Stale non-JSON pushkey detected on homeserver, forcing update.');
                        needsUpdate = true;
                    }
                }

                if (needsUpdate) {
                    await registerMatrixPusher(subscription);
                } else {
                    console.log('[PushPlugin] Matrix Pusher is already up to date');
                }
            }
        } catch (err) {
            console.error('[PushPlugin] Failed to subscribe to push:', err);
        }
    };

    const registerMatrixPusher = async (subscription: PushSubscription) => {
        if (!store.client) return;

        try {
            // We stringify the entire subscription object and send it as the "pushkey".
            // The relay server will then parse it back to get the endpoint, p256dh, and auth keys.
            const pushKey = JSON.stringify(subscription.toJSON());

            // Normalize relay URL to remove trailing slash
            const relayUrl = (store.customPushEndpoint || defaultRelayUrl).replace(/\/$/, '');

            console.log('[PushPlugin] Registering Matrix Pusher with relay:', relayUrl);

            await store.client.setPusher({
                app_id: 'cc.jackg',
                app_display_name: 'Tumult',
                device_display_name: 'Web Client',
                pushkey: pushKey,
                kind: 'http',
                lang: 'en',
                data: {
                    url: `${relayUrl}/_matrix/push/v1/notify`,
                },
            });
            console.log('[PushPlugin] Matrix Pusher registered successfully');
        } catch (e) {
            console.error('[PushPlugin] Failed to register Matrix pusher:', e);
        }
    };

    // Initialize push registration when the client is ready
    watch(() => [store.client, store.pushNotificationsEnabled, store.customPushEndpoint], ([newClient]) => {
        if (newClient) {
            subscribeToPush();
        }
    }, { immediate: true });

    return {
        provide: {
            refreshPushRegistration: subscribeToPush
        }
    };
});
