/// <reference lib="webworker" />

const sw = self;

sw.addEventListener('install', (event) => {
    console.log('Service Worker installing.');
    sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
    console.log('Service Worker activating.');
    event.waitUntil(sw.clients.claim());
});

// Handle incoming push notifications
sw.addEventListener('push', (event) => {
    console.log('[Service Worker] Push Received.');

    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            console.warn('Push event has no JSON data:', event.data.text());
            return;
        }
    }

    // Matrix Sygnal-derived format from our relay
    // {
    //   "event_id": "$...",
    //   "room_id": "!...",
    //   "counts": { "unread": 1, ... },
    //   "sender_display_name": "...",
    //   "room_name": "...",
    //   "content": { "msgtype": "m.text", "body": "...", "sender": "@..." },
    //   ...
    // }

    const title = data.room_name || data.sender_display_name || 'New Message';
    const bodyText = data.content ? data.content.body : (data.body || 'You have a new message');

    const options = {
        body: data.room_name ? `${data.sender_display_name}: ${bodyText}` : bodyText,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: {
            roomId: data.room_id,
            eventId: data.event_id,
            url: data.room_id ? `/chat/rooms/${data.room_id}` : '/chat'
        },
        tag: data.room_id || 'general-notification', // Group notifications by room
        renotify: true // Ensure it pops up even if the tag is the same
    };

    if (data.counts && data.counts.unread !== undefined && navigator.setAppBadge) {
        navigator.setAppBadge(data.counts.unread).catch(console.error);
    }

    event.waitUntil(sw.registration.showNotification(title, options));
});

// Handle notification clicks
sw.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] Notification click Received.');

    event.notification.close();

    // Open the app or focus existing window
    const urlToOpen = event.notification.data?.url || '/chat';

    event.waitUntil(
        sw.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then((windowClients) => {
            // Check if there is already a window/tab open with the target URL
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                // Handle base URLs correctly by checking if it contains the path
                if (client.url.includes(urlToOpen) && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not found exactly, try to find any open chat window
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('/chat') && 'focus' in client) {
                    // We might need to navigate this window to the specific room
                    if ('navigate' in client) {
                        return client.navigate(urlToOpen).then(c => c.focus());
                    }
                    return client.focus();
                }
            }
            // If not, open a new window
            if (sw.clients.openWindow) {
                return sw.clients.openWindow(urlToOpen);
            }
        })
    );
});
