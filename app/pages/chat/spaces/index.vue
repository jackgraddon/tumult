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
      <h1 class="text-lg font-semibold">Spaces</h1>
    </header>
    <div class="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
      <div class="h-20 w-20 rounded-full bg-accent/20 flex items-center justify-center">
        <Icon name="solar:globus-bold" class="h-10 w-10 text-muted-foreground" />
      </div>
      <div class="space-y-2 max-w-sm">
        <h2 class="text-xl font-bold">Explore Spaces</h2>
        <p class="text-muted-foreground text-sm">Select a space from the server list on the left to browse its content.</p>
      </div>
      <UiButton class="md:hidden" @click="uiStore.toggleSidebar(true)">
        Open Sidebar
      </UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();
</script>
