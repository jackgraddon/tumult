<template>
  <div class="overflow-y-scroll h-full w-full py-6 space-y-8">
    <div class="m-auto max-w-2xl px-4">
      <div class="flex items-center gap-4 mb-4">
        <UiButton
          v-if="!uiStore.sidebarOpen"
          variant="ghost"
          size="icon-sm"
          class="md:hidden shrink-0"
          @click="() => { uiStore.toggleSidebar(true); uiStore.memberListVisible = false; }"
        >
          <Icon name="solar:hamburger-menu-linear" class="h-6 w-6" />
        </UiButton>
        <h1 class="text-3xl font-bold tracking-tight">Settings</h1>
      </div>
      <hr class="my-2">
      <NuxtPage />
    </div>
  </div>
</template>

<script lang="ts" setup>
const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();

definePageMeta({
    middleware: "auth",
});
</script>

<style scoped>

</style>