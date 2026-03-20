<template>
  <!-- <div class="fixed bottom-4 left-4 z-50">
    <ColorModeToggle />
  </div> -->
  <GlobalContextMenu>
    <CustomTitlebar v-if="isTauri" />
    <component :is="'style'" v-if="store.ui.customCss">
      {{ store.ui.customCss }}
    </component>
    <div 
      class="h-screen w-screen transition-colors overflow-hidden transition-colors bg-neutral-200 dark:bg-background"
      :class="[
        { 'pt-[30px]': isTauri, 'pt-2': !isTauri },
        store.ui.themePreset !== 'default' ? 'theme-' + store.ui.themePreset : ''
      ]"
    >
      <!-- Sync Progress Bar -->
      <div 
        v-if="!useMatrixStore().isFullySynced && useMatrixStore().isAuthenticated" 
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
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'vue-sonner';

const { $isTauri: isTauri } = useNuxtApp();
const colorMode = useColorMode();
const store = useMatrixStore();

const isFailover = ref(false);

watch(() => store.ui.themePreset, (newTheme) => {
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
    watch(() => colorMode.value, async (newMode) => {
      // Light: oklch(1 0 0) -> #ffffff
      // Dark: oklch(0 0 0) -> #000000
      const bgColor = newMode === 'dark' ? '#000000' : '#ffffff'; 
      
      try {
        // Sync theme (affects titlebar on macOS and window decorations)
        await appWindow.setTheme(newMode as 'light' | 'dark');
        // Sync native background color
        await appWindow.setBackgroundColor(bgColor);
      } catch (err) {
        console.error("Failed to sync native theme/background:", err);
      }
    }, { immediate: true });

    // Polite Disconnect: Go offline when the app is closed
    const handleClose = async () => {
      await store.goOffline();
    };

    // Tauri: Handle app closure
    // We use onCloseRequested to ensure we have a moment to fire the offline flare
    appWindow.onCloseRequested(async (event) => {
      // Prevent the default close behavior
      event.preventDefault();

      try {
        const { flushSecrets } = await import('~/composables/useAppStorage');
        await Promise.all([
          handleClose(),
          flushSecrets()
        ]);
      } catch (err) {
        console.error("Failed to perform cleanup, closing anyway", err);
      } finally {
        // Force the window to close
        await appWindow.destroy();
      }
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
