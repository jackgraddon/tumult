<template>
  <UiContextMenu :disabled="isDisabled">
    <UiContextMenuTrigger class="block h-full w-full global-context-menu-trigger">
      <slot />
    </UiContextMenuTrigger>
    <UiContextMenuContent class="w-64">
      <UiContextMenuItem inset @click="reloadPage" class="cursor-pointer">
        Reload
      </UiContextMenuItem>
      <UiContextMenuItem inset @click="goBack" class="cursor-pointer">
        Back
      </UiContextMenuItem>
      <UiContextMenuItem inset @click="goForward" class="cursor-pointer">
        Forward
      </UiContextMenuItem>
      <UiContextMenuSeparator />
      <UiContextMenuItem inset @click="openAboutModal" class="cursor-pointer">
        About
      </UiContextMenuItem>
    </UiContextMenuContent>
  </UiContextMenu>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const isDisabled = ref(false);

const handleGlobalCapture = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const nearestTrigger = target.closest('[data-slot="context-menu-trigger"]');

  if (nearestTrigger && !nearestTrigger.classList.contains('global-context-menu-trigger')) {
    isDisabled.value = true;
    setTimeout(() => {
      isDisabled.value = false;
    }, 0);
  } else {
    isDisabled.value = false;
  }
}

onMounted(() => {
  window.addEventListener('contextmenu', handleGlobalCapture, { capture: true });
});

onUnmounted(() => {
  window.removeEventListener('contextmenu', handleGlobalCapture, { capture: true });
});

const reloadPage = () => {
  window.location.reload();
}

const goBack = () => {
  window.history.back();
}

const goForward = () => {
  window.history.forward();
}

const openAboutModal = () => {
  
}
</script>
