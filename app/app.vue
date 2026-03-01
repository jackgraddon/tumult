<template>
  <!-- <div class="fixed bottom-4 left-4 z-50">
    <ColorModeToggle />
  </div> -->
  <GlobalContextMenu>
    <CustomTitlebar />
    <div class="pt-[30px] h-screen w-screen transition-colors">
      <NuxtRouteAnnouncer />
      <NuxtPage />
      <UiSonner />
      <VerificationModal />
    </div>
  </GlobalContextMenu>
</template>

<script setup lang="ts">
const colorMode = useColorMode();

onMounted(async () => {
  const store = useMatrixStore();
  const isTauri = !!(window as any).__TAURI_INTERNALS__;

  if (isTauri) {
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
        await Promise.race([
          handleClose(),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch (err) {
        console.error("Failed to set offline status, closing anyway", err);
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
