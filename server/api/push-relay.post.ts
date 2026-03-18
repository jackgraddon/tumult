
import webpush from 'web-push';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    const body = await readBody(event);

    console.log('[Push Relay] Received notification from Matrix Homeserver:', body);

    // Matrix Sygnal format:
    // {
    //   "notification": {
    //     "event_id": "$...",
    //     "room_id": "!...",
    //     "counts": { "unread": 1, "missed_calls": 0 },
    //     "devices": [
    //       {
    //         "app_id": "cc.jackg",
    //         "pushkey": "https://push-service.com/...",
    //         "pushkey_ts": 123456789,
    //         "data": { ... },
    //         "tweaks": { "sound": "default" }
    //       }
    //     ],
    //     ...
    //   }
    // }

    const notification = body.notification;
    if (!notification || !notification.devices || notification.devices.length === 0) {
        return { status: 'ok', message: 'No devices to notify' };
    }

    // Configure web-push
    webpush.setVapidDetails(
        config.vapid.subject,
        config.vapid.publicKey,
        config.vapid.privateKey
    );

    const promises = notification.devices.map(async (device: any) => {
        try {
            // The "pushkey" we registered was the entire PushSubscription JSON stringified
            // (or at least it should be for Web Push to work easily)
            // But wait, in the previous implementation, it was the endpoint.
            // Let's decide: we will store the stringified subscription in the pushkey.

            let subscription;
            try {
                subscription = JSON.parse(device.pushkey);
            } catch (e) {
                console.error('[Push Relay] pushkey is not valid JSON, assuming it is just an endpoint (unsupported):', device.pushkey);
                return;
            }

            // Payload for the Service Worker
            const payload = JSON.stringify({
                event_id: notification.event_id,
                room_id: notification.room_id,
                counts: notification.counts,
                sender_display_name: notification.sender_display_name,
                room_name: notification.room_name,
                room_alias: notification.room_alias,
                content: notification.content,
                // We can add more fields if needed
            });

            await webpush.sendNotification(subscription, payload);
            console.log('[Push Relay] Successfully forwarded notification to:', subscription.endpoint);
        } catch (err: any) {
            console.error('[Push Relay] Failed to send notification:', err.message);
            // If the subscription is expired or invalid, we could technically tell Matrix to stop using it,
            // but for a stateless relay, we just log it.
        }
    });

    await Promise.all(promises);

    return { status: 'ok' };
});
