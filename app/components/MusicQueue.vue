<template>
  <div class="flex flex-col">
    <!-- Queue Header -->
    <div class="flex items-center justify-between p-4">
      <h3 class="font-bold text-sm">Up Next</h3>
      <div class="flex items-center gap-1">
        <UiButton variant="ghost" size="icon-sm" title="Shuffle Queue" @click="musicStore.shuffleQueue">
          <Icon name="solar:shuffle-bold" class="h-4 w-4" />
        </UiButton>
        <UiButton variant="ghost" size="icon-sm" title="Clear Queue" @click="musicStore.clearQueue">
          <Icon name="solar:trash-bin-trash-bold" class="h-4 w-4 text-destructive" />
        </UiButton>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="musicStore.queue.length === 0" class="flex-1 flex flex-col items-center justify-center p-8 text-center gap-2">
      <Icon name="solar:playlist-minimalistic-bold-duotone" class="h-12 w-12 text-muted-foreground/20" />
      <p class="text-xs text-muted-foreground">Queue is empty</p>
    </div>

    <!-- Draggable Queue -->
    <draggable
      v-else
      v-model="draggableQueue"
      class="flex-1 overflow-y-auto p-2 space-y-1"
      :animation="200"
      ghost-class="opacity-50"
      handle=".drag-handle"
    >
      <div
        v-for="(song, index) in musicStore.queue"
        :key="`${song.id}-${index}`"
        class="flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 group"
      >
        <div class="drag-handle cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
          <Icon name="solar:hamburger-menu-linear" class="h-4 w-4 text-muted-foreground" />
        </div>

        <img v-if="song.coverUrl" :src="song.coverUrl" class="h-8 w-8 rounded object-cover shadow-sm" alt="" >
        <div v-else class="h-8 w-8 rounded bg-muted flex items-center justify-center">
          <Icon name="solar:music-note-bold" class="h-4 w-4 text-muted-foreground/30" />
        </div>

        <div class="flex-1 min-w-0 flex flex-col">
          <span class="text-xs font-semibold truncate">{{ song.title }}</span>
          <span class="text-[10px] text-muted-foreground truncate">{{ song.artist }}</span>
        </div>

        <UiButton
          variant="ghost"
          size="icon-sm"
          class="opacity-0 group-hover:opacity-100 h-7 w-7"
          @click="musicStore.removeFromQueue(index)"
        >
          <Icon name="solar:close-circle-bold" class="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </UiButton>
      </div>
    </draggable>
  </div>
</template>

<script setup lang="ts">
import { VueDraggable as draggable } from 'vue-draggable-plus';
import { useMusicStore } from '~/stores/music';

const musicStore = useMusicStore();

const draggableQueue = computed({
  get: () => musicStore.queue,
  set: (newQueue) => {
    // Assuming we want to replace the whole queue.
    // If the library only allows reordering an index, we'd need more logic.
    musicStore.queue = newQueue;
  }
});
</script>
