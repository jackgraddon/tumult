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

// Helper to extract a readable summary of the message
function getMessageSummary(content) {
    if (!content) return 'New message';
    
    // Handle encrypted messages (Matrix doesn't send content for these usually in push)
    if (content.msgtype === undefined && content.algorithm) {
        return 'Encrypted message';
    }

    switch (content.msgtype) {
        case 'm.text':
        case 'm.notice':
        case 'm.emote':
            return content.body;
        case 'm.image':
            return 'Sent an image';
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
    const sender = data.sender_display_name || 'Someone';
    const roomName = data.room_name;
    const bodyText = getMessageSummary(data.content);
    
    // Formatting:
    // If it's a room: "Room Name: Sender: Message"
    // If it's a DM: "Sender: Message"
    const title = roomName || sender;
    const notificationBody = roomName ? `${sender}: ${bodyText}` : bodyText;
    
    const options = {
        body: notificationBody,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: {
            roomId: data.room_id,
            eventId: data.event_id,
            url: data.room_id ? `/chat/rooms/${data.room_id}` : '/chat'
        },
        tag: data.room_id || 'general-notification',
        renotify: true
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
                if (client.url.includes(urlToOpen) && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not found exactly, try to find any open chat window
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('/chat') && 'focus' in client) {
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
