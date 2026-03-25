/**
 * Unified notification helper that handles Native OS notifications (via Tauri)
 * and falls back to standard Web Notifications API for browsers/PWAs.
 */
export async function notify(title: string, body: string, iconUrl?: string, roomId?: string, imageUrl?: string) {
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
        tauriNotify({
          title,
          body,
          icon: iconUrl || undefined
        });
        return;
      }
    } 
    
    // 2. Fallback to Web API (PWA/Web)
    if (typeof Notification !== 'undefined') {
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

        new Notification(title, options);
      } else if (Notification.permission !== 'denied') {
         const permission = await Notification.requestPermission();
         if (permission === 'granted') {
            new Notification(title, { 
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
