<template>
  <!-- <div class="fixed bottom-4 left-4 z-50">
    <ColorModeToggle />
  </div> -->
  <GlobalContextMenu>
    <CustomTitlebar v-if="isTauri" />
    <div 
      class="h-screen w-screen transition-colors overflow-hidden"
      :class="{ 'pt-[30px]': isTauri }"
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
    </div>
  </GlobalContextMenu>
</template>

<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner';

const { $isTauri: isTauri } = useNuxtApp();
const colorMode = useColorMode();

onMounted(async () => {
  console.log("[App] onMounted started. isTauri:", isTauri);
  const store = useMatrixStore();

  if (isTauri) {
    const { emit, listen } = await import('@tauri-apps/api/event');
    
    // Console streaming is now handled by the 00-console.client.ts plugin for earlier capture.

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

    // Watch for readiness OR lack of auth to transition from splash screen
    watch([() => store.isReady, () => store.isAuthenticated, () => store.isRestoringSession], async ([ready, authenticated, restoring]) => {
      // 1. If we are authenticated and ready, show the main UI
      if (ready && authenticated) {
        console.log("[Splash] Transitoning to Dashboard. (Ready:", ready, "Auth:", authenticated, ")");
        
        try {
          await appWindow.show();
          await appWindow.setFocus();
          await new Promise(resolve => setTimeout(resolve, 300));

          const { getAllWindows } = await import('@tauri-apps/api/window');
          const windows = await getAllWindows();
          const splash = windows.find(w => w.label === 'splashscreen');
          if (splash) {
            console.log("[Splash] Closing splash screen window...");
            await splash.close();
          }
        } catch (err) {
          console.error("Failed to transition from splash screen:", err);
        }
      } 
      // 2. If we are NOT authenticated and session check is DONE, tell splash to show login UI
      else if (!authenticated && !restoring) {
        console.log("[Splash] No session found. Signaling splash screen to show Login UI.");
        emit('splash-needs-login');
      }
    }, { immediate: true });

    // Sync status updates to splash screen using GLOBAL emit
    watch(() => store.loginStatus, (status) => {
      if (status && !store.isReady) {
        console.log("[Splash] Emitting status update:", status);
        emit('splash-status', status);
      }
    });

    // Listen for logout signal from splash screen (global scope)
    listen('splash-logout', async () => {
        console.warn("[Splash] Logout signal received from splash screen");
        await store.logout();
        // Do not use window.location.reload() in Tauri.
        navigateTo('/');
    });

    // Listen for login start from splash screen
    listen('splash-start-login', async (event: { payload: string }) => {
        const homeserver = event.payload || 'matrix.org';
        console.log("[Splash] Login signal received for homeserver:", homeserver);
        try {
            await store.startLogin(homeserver);
        } catch (err) {
            console.error("[Splash] Failed to start login from signal:", err);
            emit('splash-status', 'Login failed. Please check homeserver URL.');
            emit('splash-needs-login');
        }
    });

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
