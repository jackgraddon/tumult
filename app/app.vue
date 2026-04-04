<template>
  <!-- <div class="fixed bottom-4 left-4 z-50">
    <ColorModeToggle />
  </div> -->
  <GlobalContextMenu>
    <CustomTitlebar v-if="isTauri" />
    <component :is="'style'" v-if="store.ui.customCss" v-html="store.ui.customCss" />
    <div 
      class="h-screen w-screen transition-colors overflow-hidden bg-background text-foreground pb-safe md:pb-0"
      :class="[
        store.ui.themePreset !== 'default' ? 'theme-' + store.ui.themePreset : ''
      ]"
    >
      <!-- Splash Screen / Restoration Overlay -->
      <div
        v-if="store.isRestoringSession"
        class="fixed inset-0 z-[200] bg-background flex flex-col items-center justify-center gap-8 animate-in fade-in duration-300"
      >
        <div class="flex flex-col items-center gap-4">
          <img src="~/assets/Flame.svg" class="size-24" alt="Tumult Logo" />
          <h1 class="text-4xl font-black tracking-tighter">Tumult</h1>
        </div>
        <div class="flex flex-col items-center gap-3">
          <UiSpinner class="size-8 text-primary" />
          <p class="text-sm text-muted-foreground font-medium animate-pulse">Resuming your session...</p>
        </div>
      </div>

      <!-- Sync Progress Bar -->
      <div 
        v-if="!store.isFullySynced && store.isAuthenticated" 
        class="fixed left-0 right-0 h-[1.5px] z-[100] bg-muted overflow-hidden pointer-events-none"
        :style="{ top: isTauri ? '30px' : '0' }"
      >
        <div class="h-full bg-accent animate-sync-progress origin-left w-full"></div>
      </div>

      <NuxtRouteAnnouncer />
      <NuxtPage />
      <Toaster />
      <VerificationModal />
      <GlobalConfirmationDialog />
      <CreateRoomModal />
      <CreateSpaceModal />
      <RoomSettingsModal />
      <SpaceSettingsModal />
      <MediaPreviewModal />

      <!-- Failover Notice -->
      <div 
        v-if="isFailover" 
        class="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-medium backdrop-blur-md shadow-lg pointer-events-none animate-in fade-in slide-in-from-bottom-2"
      >
        <UiIcon name="lucide:cloud-off" class="w-3.5 h-3.5" />
        Offline Mode (Bundled Assets)
      </div>
    </div>
  </GlobalContextMenu>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useNuxtApp, useHead, navigateTo } from '#app';
import { MatrixEvent } from 'matrix-js-sdk';
import { useColorMode } from '#imports';
import { useMatrixStore } from '~/stores/matrix';
import { Toaster } from '~/components/ui/sonner';
import { toast } from 'vue-sonner';

const { $isTauri: isTauri } = useNuxtApp();
const colorMode = useColorMode();
const store = useMatrixStore();

// Dynamic theme-color meta tag for PWA/Mobile
// We precisely match the oklch(0.96 0 0) (#f5f5f5) and oklch(0 0 0) (#000000)
// backgrounds used in our Tailwind config to ensure an "edge-to-edge" look.
const themeColor = computed(() => colorMode.value === 'dark' ? '#000000' : '#f5f5f5');

useHead({
  meta: [
    { name: 'theme-color', content: themeColor },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }
  ]
});

const isFailover = ref(false);

watch(() => store.ui.themePreset, (newTheme: string) => {
  if (import.meta.client) {
    const body = document.body;
    body.classList.forEach(cls => {
      if (cls.startsWith('theme-')) body.classList.remove(cls);
    });
    if (newTheme && newTheme !== 'default') {
      body.classList.add('theme-' + newTheme);
    }
  }
}, { immediate: true });

onMounted(async () => {
  console.log("[App] onMounted started. isTauri:", isTauri);

  // PWA Update Handling
  if (import.meta.client && 'serviceWorker' in navigator) {
    const { useRegisterSW } = await import('virtual:pwa-register/vue');
    const { updateServiceWorker } = useRegisterSW({
      onNeedRefresh() {
        toast('A new version is available', {
          description: 'Click update to reload the app.',
          action: {
            label: 'Update',
            onClick: () => updateServiceWorker(true),
          },
          duration: Infinity,
        });
      },
      onOfflineReady() {
        toast.success('App ready for offline use');
      },
    });
  }

  if (isTauri) {
    // Check for failover flag from Rust via Tauri command
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      isFailover.value = await invoke('is_failover');
    } catch (e) {
      console.warn("Failed to check failover status:", e);
    }

    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();

    // Watch for the resolved color mode ('light' or 'dark')
    watch(() => colorMode.value, async (newMode: string) => {
      // Light: oklch(0.96 0 0) -> #f5f5f5
      // Dark: oklch(0 0 0) -> #000000
      const bgColor = newMode === 'dark' ? '#000000' : '#f5f5f5';
      
      try {
        // Sync theme (affects titlebar on macOS and window decorations)
        await appWindow.setTheme(newMode as 'light' | 'dark');
        // Sync native background color
        await appWindow.setBackgroundColor(bgColor);
      } catch (err) {
        console.error("Failed to sync native theme/background:", err);
      }
    }, { immediate: true });

    // Listen for native theme changes and update Nuxt color mode if preference is 'system'
    appWindow.onThemeChanged(({ payload: theme }) => {
      if (colorMode.preference === 'system') {
        console.log("[App] Native theme changed, syncing colorMode:", theme);
        // We don't change preference, but we want to make sure Nuxt reacts.
        // Usually Nuxt reacts to matchMedia, but we can nudge it.
      }
    });

    // Handle startup minimized logic
    const handleMinimizedStartup = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const isMinimizedArg = await invoke<boolean>('get_cli_args');
        const startMinimizedPref = await store.startMinimized;

        if (isMinimizedArg || startMinimizedPref) {
          console.log("[App] Starting minimized to tray");
          await appWindow.hide();
        }
      } catch (e) {
        console.warn("Failed to handle minimized startup:", e);
      }
    };
    handleMinimizedStartup();

    // Listen for tray update event
    const { listen } = await import('@tauri-apps/api/event');
    listen('check-updates', () => {
      console.log("[App] Received check-updates from tray");
      navigateTo('/chat/settings', { replace: true });
      // Trigger update check after a small delay to ensure page is loaded
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('tumult-check-updates'));
      }, 500);
    });

    // Handle App Resume/Focus to restart stalled sync
    const handleAppResume = async () => {
      console.log("[App] Focus/Resume detected, verifying sync state...");
      if (store.client && store.isAuthenticated && !store.isSyncing) {
        console.log("[App] Sync was stalled or stopped, restarting...");
        try {
          await store.client.startClient();
        } catch (e) {
          console.warn("[App] Failed to restart sync on resume:", e);
        }
      }
    };

    window.addEventListener('focus', handleAppResume);

    // Initial sync of system theme in Tauri
    const syncSystemTheme = async () => {
      if (colorMode.preference === 'system') {
        const theme = await appWindow.theme();
        if (theme) {
          console.log("[App] Initial native theme sync:", theme);
          // Force nuxt-color-mode to align if it missed the initial detection
          // colorMode.value is read-only, but it should ideally just work.
        }
      }
    };
    syncSystemTheme();

    // Tauri: Handle app closure
    // We intercept the close request to hide the window instead,
    // ensuring the webview state remains alive in the background.
    appWindow.onCloseRequested(async (event) => {
      // Prevent the default destruction behavior
      event.preventDefault();

      console.log("[App] Close requested, hiding window instead of destroying.");
      
      try {
        const { flushSecrets } = await import('./composables/useAppStorage');
        // We flush secrets to ensure they are persisted before the window is hidden
        await flushSecrets();
      } catch (err) {
        console.error("Failed to flush secrets on hide:", err);
      }

      // Hide the window. The Rust side also handles this, but doing it here
      // provides an immediate UI response.
      await appWindow.hide();
    });
  }

  // Idle Detection: Handle "Unavailable" status after 5 minutes of inactivity
  let idleTimer: ReturnType<typeof setTimeout>;
  const resetIdleTimer = () => {
    store.setIdle(false);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      store.setIdle(true);
    }, 5 * 60 * 1000); // 5 minutes
  };

  window.addEventListener('mousemove', resetIdleTimer);
  window.addEventListener('keydown', resetIdleTimer);
  resetIdleTimer(); // Initial start

  // Service Worker Decryption Handler
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      if (event.data?.type === 'DECRYPT_EVENT') {
        const { event: matrixEventData } = event.data;
        if (!store.client) {
            console.warn('[App] Service worker requested decryption but client not initialized');
            event.ports[0]?.postMessage({ decrypted: null });
            return;
        }

        try {
          console.log('[App] Decrypting Matrix event for Service Worker:', matrixEventData.event_id);
          const sdkEvent = new MatrixEvent(matrixEventData);
          await sdkEvent.attemptDecryption(store.client.getCrypto() as any);
          const content = sdkEvent.getClearContent();

          // Mark this event as displayed to prevent the app from showing a duplicate notification
          // if it happens to be syncing this event at the same time.
          if (matrixEventData.event_id) {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({
                type: 'MARK_EVENT_DISPLAYED',
                eventId: matrixEventData.event_id
              });
            }
          }

          event.ports[0]?.postMessage({ decrypted: content });
        } catch (e) {
          console.error('[App] Background decryption failed:', e);
          event.ports[0]?.postMessage({ decrypted: null });
        }
      }
    });
  }

  // Debug: Looping console log for active user presence
  // let debugInterval: ReturnType<typeof setInterval>;
  // if (process.dev) {
  //   debugInterval = setInterval(() => {
  //     if (store.client && store.isAuthenticated && store.user) {
  //       const user = store.client.getUser(store.user.userId);
  //       console.log('[Presence Debug] Status:', {
  //         presence: user?.presence || 'unknown',
  //         status_msg: user?.presenceStatusMsg || '',
  //         isIdle: store.isIdle,
  //         activity: store.activityDetails?.name || 'none'
  //       });
  //     }
  //   }, 10000); // Every 10 seconds
  // }

  onBeforeUnmount(() => {
    window.removeEventListener('mousemove', resetIdleTimer);
    window.removeEventListener('keydown', resetIdleTimer);
    clearTimeout(idleTimer);
    // if (debugInterval) clearInterval(debugInterval);
  });
});
</script>

<style scoped>
@keyframes sync-progress {
  0% { transform: scaleX(0); }
  50% { transform: scaleX(0.7); }
  100% { transform: scaleX(1); opacity: 0; }
}

.animate-sync-progress {
  animation: sync-progress 2s cubic-bezier(0.65, 0, 0.35, 1) forwards;
}
</style>
