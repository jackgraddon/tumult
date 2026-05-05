<template>
  <div
    v-if="isTauri"
    class="fixed top-0 left-0 right-0 h-[30px] w-full flex items-center justify-between select-none z-[9999] pointer-events-none"
  >
    <div
      class="w-[135px] h-full flex items-center"
      :class="os && os !== 'macos' ? 'pointer-events-auto' : ''"
      :data-tauri-drag-region="os && os !== 'macos' ? true : undefined"
    />

    <div 
      class="flex-1 h-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground pointer-events-auto"
      data-tauri-drag-region
    >
       <img src="~/assets/Flame.svg" class="size-3.5" alt="Tumult Logo" >
       Tumult
    </div>

    <div
      class="w-[135px] h-full flex items-center justify-end"
      :class="os === 'macos' ? 'pointer-events-auto' : ''"
      :data-tauri-drag-region="os === 'macos' ? true : undefined"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const { $isTauri: isTauri } = useNuxtApp();
const os = ref('');

onMounted(async () => {
  if (isTauri) {
    try {
      const { platform } = await import('@tauri-apps/plugin-os');
      os.value = platform();
    } catch (e) {
      console.warn('Failed to detect platform:', e);
    }
  }
});
</script>
