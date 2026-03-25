
export default defineNuxtPlugin(async (nuxtApp) => {
    const store = useMatrixStore();
    const config = useRuntimeConfig();

    // The relay URL is always the production one to ensure 
    // it works across local/dev/Tauri environments.
    const defaultRelayUrl = config.public.push.relayUrl;
    const vapidPublicKey = config.public.push.vapidPublicKey;

    const subscribeToPush = async () => {
        if (!store.pushNotificationsEnabled) {
            console.log('[PushPlugin] Push notifications disabled in settings, skipping registration');
            // If they were already registered, we should ideally unregister the Matrix pusher,
            // but for simplicity, we just skip registration/updates here.
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
            
            if (!subscription) {
                console.log('[PushPlugin] Requesting new push subscription...');
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: vapidPublicKey
                });
            }

            if (subscription && store.client) {
                await registerMatrixPusher(subscription);
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
            const relayUrl = store.customPushEndpoint || defaultRelayUrl;
            
            console.log('[PushPlugin] Registering Matrix Pusher with relay:', relayUrl);
            
            await store.client.setPusher({
                app_id: 'cc.jackg',
                app_display_name: 'Tumult',
                device_display_name: 'Web Client',
                pushkey: pushKey, 
                kind: 'http',
                lang: 'en',
                data: {
                    url: relayUrl,
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
