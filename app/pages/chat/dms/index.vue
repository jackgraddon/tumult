<template>
  <div class="flex-1 flex flex-col min-h-0 bg-background">
    <header class="flex-none p-4 border-b border-border flex items-center gap-4">
      <UiButton
        v-if="!uiStore.sidebarOpen"
        variant="ghost"
        size="icon-sm"
        class="md:hidden shrink-0"
        @click="uiStore.toggleSidebar(true)"
      >
        <Icon name="solar:hamburger-menu-linear" class="h-6 w-6" />
      </UiButton>
      <h1 class="text-lg font-semibold">Direct Messages</h1>
    </header>
    <div class="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
      <div class="h-20 w-20 rounded-full bg-accent/20 flex items-center justify-center">
        <Icon name="solar:users-group-rounded-bold" class="h-10 w-10 text-muted-foreground" />
      </div>
      <div class="space-y-2 max-w-sm">
        <h2 class="text-xl font-bold">No message selected</h2>
        <p class="text-muted-foreground">Select a conversation from the sidebar, or start a new direct message.</p>
      </div>
      <UiButton class="md:hidden" @click="uiStore.toggleSidebar(true)">
        Open Sidebar
      </UiButton>
      <UiButton variant="outline" @click="uiStore.openGlobalSearchModal()">
        Find a Person
      </UiButton>
    </div>
  </div>
</template>

<script lang="ts" setup>
const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();

onMounted(() => {
  if (store.lastVisitedRooms.dm) {
    navigateTo(`/chat/dms/${store.lastVisitedRooms.dm}`, { replace: true });
  }
});
</script>

<style>

</style>