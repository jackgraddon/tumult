<template>
  <div
    class="fixed top-0 left-0 right-0 h-[30px] w-full flex items-center justify-between select-none transition-colors bg-neutral-200 dark:bg-background z-[9999]"
    data-tauri-drag-region
    @mousedown="startDrag"
  >
    <!-- Left Side: Spacer for Windows (to center title) -->
    <div v-if="!isMac" class="w-[135px]" />

    <!-- Center: Optional Title -->
    <div class="flex-1 flex justify-center text-[11px] font-medium text-muted-foreground pointer-events-none" data-tauri-drag-region @mousedown="startDrag">
       Matrix Client
    </div>

    <!-- Right Side: Windows/Linux standard controls (Only visible on non-macOS) -->
    <div class="flex h-full w-[135px] items-center justify-end">
      <div v-if="!isMac" class="flex h-full">
        <button 
          class="h-full w-[45px] hover:bg-muted flex items-center justify-center transition-colors"
          @click="minimizeWindow"
          aria-label="Minimize Window"
        >
          <Icon name="lucide:minus" class="h-4 w-4 text-muted-foreground pointer-events-none" />
        </button>
        <button 
          class="h-full w-[45px] hover:bg-muted flex items-center justify-center transition-colors"
          @click="maximizeWindow"
          aria-label="Maximize Window"
        >
          <Icon name="lucide:square" class="h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </button>
        <button 
          class="h-full w-[45px] hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center transition-colors"
          @click="closeWindow"
          aria-label="Close Window"
        >
          <Icon name="lucide:x" class="h-4 w-4 text-muted-foreground pointer-events-none" group-hover:text-destructive-foreground />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const isTauri = ref(false);
const isMac = ref(true); // Default to true to prevent visual pop on macos

onMounted(async () => {
  isTauri.value = !!(window as any).__TAURI_INTERNALS__;
  if (isTauri.value) {
    try {
      const { type } = await import('@tauri-apps/plugin-os');
      const osType = await type();
      isMac.value = osType === 'macos';
    } catch (error) {
      console.warn("Failed to detect OS for titlebar", error);
      if (typeof window !== 'undefined') {
        isMac.value = navigator.userAgent.toLowerCase().includes('mac');
      }
    }
  } else {
    isMac.value = navigator.userAgent.toLowerCase().includes('mac');
  }
});

const closeWindow = async () => {
  if (!isTauri.value) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
};

const minimizeWindow = async () => {
  if (!isTauri.value) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().minimize();
};

const maximizeWindow = async () => {
  if (!isTauri.value) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().toggleMaximize();
};

const startDrag = async (e: MouseEvent) => {
  if (!isTauri.value) return;
  if (e.target instanceof HTMLElement && e.target.closest('button')) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().startDragging();
};
</script>
