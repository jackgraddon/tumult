
import webpush from 'web-push';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    const body = await readBody(event);

    // console.log('[Push Relay] Received notification from Matrix Homeserver:', body);

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
        return { rejected: [] };
    }

    // Configure web-push
    webpush.setVapidDetails(
        config.vapid.subject,
        config.vapid.publicKey,
        config.vapid.privateKey
    );

    const promises = notification.devices.map(async (device: any) => {
        try {
            // 1. Skip self-notifications
            // Check the registered user_id in device.data against the event sender
            if (device.data?.user_id && device.data.user_id === notification.sender) {
                console.log(`[Push Relay] 🛑 Skipping self-notification for ${notification.sender} on device ${device.pushkey.slice(-15)}`);
                return;
            }

            let subscription;
            try {
                subscription = JSON.parse(device.pushkey);
            } catch (e) {
                console.error('[Push Relay] pushkey is not valid JSON:', device.pushkey);
                return;
            }

            // --- 2026 Standards: Declarative Web Push Construction ---
            // We move the formatting logic to the server so we can support Declarative Web Push (Safari 18.4+)
            const sender = notification.sender_display_name || notification.sender || 'Someone';
            const roomName = notification.room_name;
            const bodyText = getMessageSummary(notification.content);

            // Match frontend title: 'User in Room' or just 'User' for DMs
            const title = roomName ? `${sender} in ${roomName}` : sender;
            const notificationBody = bodyText;
            const urlToOpen = notification.room_id ? `/chat/rooms/${notification.room_id}` : '/chat';

            // Hybrid Payload: Supports both Declarative Web Push and Imperative Service Worker fallback
            const payload = JSON.stringify({
                // Declarative Keys (2026 Standard)
                web_push: 8030,
                title: title,
                body: notificationBody,
                icon: '/pwa-192x192.png',
                navigate: urlToOpen,

                // Legacy/Custom Keys (for Service Worker)
                event_id: notification.event_id,
                room_id: notification.room_id,
                counts: notification.counts,
                sender_display_name: notification.sender_display_name,
                room_name: notification.room_name,
                content: notification.content,
                data: {
                    roomId: notification.room_id,
                    eventId: notification.event_id,
                    url: urlToOpen
                }
            });

            try {
                const result = await webpush.sendNotification(subscription, payload);

                // ✅ This is what you want to see — APNs accepted the message
                console.log('[Push Relay] ✅ Delivered:', {
                    status: result.statusCode,      // Should be 201
                    endpoint: subscription.endpoint.slice(-30), // Last 30 chars to identify without leaking full URL
                    room: notification.room_id,
                    sender: notification.sender,
                    event_id: notification.event_id
                });

            } catch (err: any) {
                // ❌ webpush throws on any non-2xx response — all failures land here
                console.error('[Push Relay] ❌ Delivery failed:', {
                    status: err.statusCode,         // 403 = VAPID mismatch, 410 = dead sub, 400 = bad payload
                    body: err.body,                 // APNs error string e.g. "InvalidVapidKey", "ExpiredSubscription"
                    endpoint: subscription.endpoint?.slice(-30),
                    room: notification.room_id,
                    sender: notification.sender,
                    event_id: notification.event_id
                });

                // Clean up dead subscriptions (410 = expired, 404 = not found)
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.warn('[Push Relay] 🗑️ Dead subscription — you should remove this pushkey from your DB');
                }
            }
        } catch (err: any) {
            console.error('[Push Relay] Fatal processing error:', err.message);
        }
    });

    await Promise.all(promises);

    return { rejected: [] };
});

// Helper to extract a readable summary of the message (Mirror of SW logic for server-side declarative push)
function getMessageSummary(content: any) {
    if (!content) return 'New message';

    // Handle encrypted messages
    if (content.msgtype === undefined && content.algorithm) {
        return 'Encrypted message';
    }

    switch (content.msgtype) {
        case 'm.text':
        case 'm.notice':
        case 'm.emote':
            return content.body;
        case 'm.image':
            return `Sent an image: ${content.body || 'filename'}`;
        case 'm.video':
            return 'Sent a video';
        case 'm.audio':
            return 'Sent an audio file';
        case 'm.file':
            return `Sent a file: ${content.body}`;
        case 'm.location':
            return 'Shared a location';
        default:
            return content.body || 'New message';
    }
}
