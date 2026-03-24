/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

const sw = self;

// This is the magic line that Nuxt PWA module needs to inject the asset manifest.
// If it's missing, the PWA won't be considered "complete" for some browsers.
precacheAndRoute(self.__WB_MANIFEST);

sw.addEventListener('install', (event) => {
    console.log('Service Worker installing.');
    sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
    console.log('Service Worker activating.');
    event.waitUntil(sw.clients.claim());
});

// --- Media Proxy (Authenticated Streaming) ---

const MEDIA_PROXY_PATH = '/_media_proxy/';

sw.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Match /_media_proxy/ with or without trailing slash
    if (url.pathname === MEDIA_PROXY_PATH || url.pathname === MEDIA_PROXY_PATH.slice(0, -1)) {
        event.respondWith(handleMediaProxy(event.request));
    }
});

async function handleMediaProxy(request) {
    const url = new URL(request.url);
    const encodedData = url.searchParams.get('data');

    if (!encodedData) {
        return new Response('Missing data parameter', { status: 400 });
    }

    try {
        // Data is passed as a base64 encoded JSON string in the URL.
        // atob might fail if the user used a URL-safe variant (unlikely here but good to handle).
        const jsonStr = atob(encodedData.replace(/-/g, '+').replace(/_/g, '/'));
        const decoded = JSON.parse(jsonStr);
        const { mediaUrl, accessToken } = decoded;

        if (!mediaUrl || !accessToken) {
            return new Response('Missing mediaUrl or accessToken', { status: 400 });
        }

        // Forward original headers (Range, etc.)
        const headers = new Headers(request.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);

        // We fetch and return the response.
        // If the browser sends a Range header, we MUST return the partial response.
        // Most modern fetch implementations in Service Workers pass 206s correctly.
        const response = await fetch(mediaUrl, {
            headers,
            credentials: 'omit',
        });

        // Ensure we preserve the status for Range requests (206)
        return response;
    } catch (err) {
        console.error('[Service Worker] Media proxy error:', err);
        return new Response('Internal Proxy Error: ' + err.message, { status: 500 });
    }
}

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
