/**
 * Unified notification helper that handles Native OS notifications (via Tauri)
 * and falls back to standard Web Notifications API for browsers/PWAs.
 */

// Helper to convert a string (like roomId) to a 32-bit integer for Tauri notification IDs
function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export async function notify(title: string, body: string, iconUrl?: string, roomId?: string, imageUrl?: string, eventId?: string) {
  let store;
  try {
    // Check if useMatrixStore is available as a global (auto-import)
    const getStore = (globalThis as any).useMatrixStore || (typeof useMatrixStore !== 'undefined' ? useMatrixStore : null);
    if (getStore) {
      store = getStore();
    } else {
      throw new Error('useMatrixStore not found');
    }
  } catch (e) {
    // Fallback if called outside of active pinia context or before auto-imports are ready
    const { useMatrixStore: getStore } = await import('../stores/matrix');
    store = getStore();
  }

  // Respect global toggle
  if (!store.pushNotificationsEnabled) return;

  // Respect Quiet Hours / Pause
  if (Date.now() < store.notificationsQuietUntil) {
    console.log('[Notify Helper] Notifications are currently paused (Quiet Hours)');
    return;
  }

  // Deduplication with Service Worker
  if (eventId && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'MARK_EVENT_DISPLAYED',
      eventId
    });
  }

  try {
    // 1. Check if running in Tauri
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { isPermissionGranted, requestPermission, sendNotification: tauriNotify } = await import('@tauri-apps/plugin-notification');

      let permissionGranted = await isPermissionGranted();
      
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }
      
      if (permissionGranted) {
        const id = roomId ? hashStringToInt(roomId) : undefined;
        tauriNotify({
          id, // Consistent ID per room so we can dismiss it later
          title,
          body,
          icon: iconUrl || undefined,
          // Attach data for the click handler
          extra: { roomId } 
        } as any); // Type cast as extra/data might vary by plugin version
        return;
      }
    } 
    
    // 2. Fallback to Web API (PWA/Web)
    if (typeof Notification !== 'undefined') {
      const showWebNotification = (title: string, options: NotificationOptions) => {
        const n = new Notification(title, options);
        n.onclick = () => {
          window.focus();
          if (roomId) {
            const router = (globalThis as any).useRouter?.();
            if (router) {
              router.push(`/chat/rooms/${roomId}`);
            } else {
              window.location.hash = `#/chat/rooms/${roomId}`; // Fallback navigation
            }
          }
          n.close();
        };
      };

      if (Notification.permission === 'granted') {
        const options: NotificationOptions = { 
          body,
          icon: iconUrl || '/pwa-192x192.png',
          image: imageUrl,
          tag: roomId || 'general',
          renotify: true
        };
        
        // On some platforms, deep linking data can be attached
        (options as any).data = { url: roomId ? `/chat/rooms/${roomId}` : '/chat' };

        showWebNotification(title, options);
      } else if (Notification.permission !== 'denied') {
         const permission = await Notification.requestPermission();
         if (permission === 'granted') {
            showWebNotification(title, { 
              body,
              icon: iconUrl || '/pwa-192x192.png',
              image: imageUrl,
              tag: roomId || 'general',
              renotify: true
            });
         }
      }
    }
  } catch (error) {
    console.error('[Notify Helper] Error sending notification:', error);
  }
}

/**
 * Dismisses any active notifications for a specific room.
 * Handles both Tauri and Web Notification APIs.
 */
export async function dismissNotification(roomId: string) {
  if (!roomId) return;

  try {
    // 1. Tauri dismissal
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { cancel } = await import('@tauri-apps/plugin-notification');
      const id = hashStringToInt(roomId);
      await cancel([id]);
      console.log(`[Notify Helper] Dismissed Tauri notification for room ${roomId} (ID: ${id})`);
    }

    // 2. Web/PWA dismissal
    if (typeof Notification !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      const notifications = await registration.getNotifications({ tag: roomId });
      notifications.forEach(n => n.close());
      
      // Also try to find notifications not managed by SW if any
      // Note: non-SW Notification.getNotifications exists in some browsers but is mostly deprecated or SW-only
      if ((Notification as any).getNotifications) {
        const nonSwNotifications = await (Notification as any).getNotifications({ tag: roomId });
        nonSwNotifications.forEach((n: any) => n.close());
      }
    }
  } catch (error) {
    console.error('[Notify Helper] Error dismissing notification:', error);
  }
}
