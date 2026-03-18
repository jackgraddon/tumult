import { isPermissionGranted, requestPermission, sendNotification as tauriNotify } from '@tauri-apps/plugin-notification';

/**
 * Unified notification helper that handles Native OS notifications (via Tauri)
 * and falls back to standard Web Notifications API for browsers/PWAs.
 */
export async function notify(title: string, body: string, iconUrl?: string, roomId?: string) {
  try {
    // 1. Check if running in Tauri
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      let permissionGranted = await isPermissionGranted();
      
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }
      
      if (permissionGranted) {
        tauriNotify({ title, body });
        return;
      }
    } 
    
    // 2. Fallback to Web API (PWA/Web)
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        const options: NotificationOptions = {
          body,
          icon: iconUrl || '/pwa-192x192.png',
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
