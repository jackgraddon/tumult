<template>
  <div
v-if="musicStore.currentSong"
    class="flex flex-col rounded-md bg-sidebar border border-border/50 shadow-sm transition-all overflow-hidden"
    :class="[musicStore.isExpanded ? 'flex-1 h-full w-full' : 'p-2 group hover:bg-sidebar/30']"
  >
    <!-- Expanded Header (Only when expanded) -->
    <div v-if="musicStore.isExpanded" class="flex-1 overflow-hidden flex flex-col">
      <div class="p-4 flex flex-col items-center gap-4 text-center">
        <!-- Expanded Cover Image -->
        <div class="h-48 w-48 shrink-0 rounded-lg bg-muted overflow-hidden relative shadow-lg group">
          <img
            v-if="musicStore.currentSong.coverUrl"
            :src="musicStore.currentSong.coverUrl"
            class="h-full w-full object-cover"
            alt=""
          >
          <div v-else class="h-full w-full flex items-center justify-center">
            <Icon name="solar:music-note-bold" class="h-24 w-24 text-muted-foreground/30" />
          </div>

          <!-- Play/Pause Overlay -->
          <!-- <div
            class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            @click="musicStore.togglePlay"
          >
            <Icon :name="musicStore.isPlaying ? 'solar:pause-bold' : 'solar:play-bold'" class="text-white h-12 w-12" />
          </div> -->
        </div>

        <div class="flex flex-col min-w-0">
          <h2 class="text-sm font-bold truncate tracking-tight text-foreground leading-tight">{{ musicStore.currentSong.title }}</h2>
          <p class="text-xs text-muted-foreground truncate leading-tight">{{ musicStore.currentSong.artist }}</p>
        </div>
      </div>

      <!-- Queue Area -->
      <div class="flex-1 overflow-hidden">
        <MusicQueue class="h-full" />
      </div>
    </div>

    <!-- Small View (Default) -->
    <div v-else class="flex items-center gap-3 overflow-hidden cursor-pointer" @click="musicStore.isExpanded = true">
      <!-- Cover Image -->
      <div class="h-10 w-10 shrink-0 rounded-md bg-muted overflow-hidden relative">
        <img
          v-if="musicStore.currentSong.coverUrl"
          :src="musicStore.currentSong.coverUrl"
          class="h-full w-full object-cover"
          alt=""
        >
        <div v-else class="h-full w-full flex items-center justify-center">
          <Icon name="solar:music-note-bold" class="h-6 w-6 text-muted-foreground/30" />
        </div>

        <!-- Play/Pause Overlay -->
        <!-- <div
          class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          @click.stop="musicStore.togglePlay"
        >
          <Icon :name="musicStore.isPlaying ? 'solar:pause-bold' : 'solar:play-bold'" class="text-white h-5 w-5" />
        </div> -->
      </div>

      <!-- Text Details -->
      <div class="flex-1 min-w-0 flex flex-col">
        <span class="text-xs font-bold truncate tracking-tight text-foreground leading-tight">{{ musicStore.currentSong.title }}</span>
        <span class="text-[10px] text-muted-foreground truncate leading-tight">{{ musicStore.currentSong.artist }}</span>
      </div>

      <!-- Controls -->
      <UiButton variant="ghost" size="icon-sm" class="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground" @click.stop="audioService.togglePlay">
        <Icon :name="musicStore.isPlaying ? 'solar:pause-bold' : 'solar:play-bold'" class="h-4 w-4" />
      </UiButton>
    </div>

    <!-- Footer Controls (Persistent in Expanded) -->
    <div class="px-3 pb-3 pt-1 flex flex-col gap-2">
      <!-- Volume and Collapse (Only when expanded) -->
      <div v-if="musicStore.isExpanded" class="flex items-center gap-3">
        <div class="flex items-center gap-1 group/vol flex-1">
          <Icon :name="musicStore.volume > 0 ? 'solar:volume-loud-bold' : 'solar:volume-cross-bold'" class="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="musicStore.volume"
            class="h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-[#AA5CC3] flex-1"
            @input="(e: any) => audioService.setVolume(parseFloat(e.target.value))"
          >
        </div>
        <UiButton variant="ghost" size="icon-sm" class="h-6 w-6" @click="musicStore.isExpanded = false">
          <Icon name="solar:alt-arrow-down-bold" class="h-4 w-4" />
        </UiButton>
      </div>

      <!-- Progress Slider -->
      <div class="flex items-center gap-2 group/progress">
        <span v-if="musicStore.isExpanded" class="text-[10px] text-muted-foreground w-8 tabular-nums">{{ formatTime(musicStore.currentTime) }}</span>
        <div class="relative flex-1 h-1 bg-muted rounded-full cursor-pointer hover:h-2 transition-all duration-100" @click="handleSeek">
          <div
            class="absolute top-0 left-0 h-full bg-[#AA5CC3] rounded-full transition-all duration-100"
            :style="{ width: `${progress}%` }"
          />
        </div>
        <span v-if="musicStore.isExpanded" class="text-[10px] text-muted-foreground w-8 tabular-nums">{{ formatTime(musicStore.duration) }}</span>
      </div>

      <!-- Extended Controls (Only when expanded) -->
      <div v-if="musicStore.isExpanded" class="flex items-center justify-center gap-6 py-2">
        <UiButton variant="ghost" size="icon" class="h-8 w-8" title="Previous" @click="audioService.playPrevious">
           <Icon name="solar:skip-previous-bold" class="h-5 w-5" />
        </UiButton>
        <UiButton variant="secondary" size="icon" class="h-10 w-10 rounded-full" @click="audioService.togglePlay">
           <Icon :name="musicStore.isPlaying ? 'solar:pause-bold' : 'solar:play-bold'" class="h-6 w-6" />
        </UiButton>
        <UiButton variant="ghost" size="icon" class="h-8 w-8" title="Next" @click="audioService.playNext">
           <Icon name="solar:skip-next-bold" class="h-5 w-5" />
        </UiButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMusicStore } from '~/stores/music';
import MusicQueue from './MusicQueue.vue';

const musicStore = useMusicStore();
const audioService = useAudioService();

const progress = computed(() => {
  if (!musicStore.duration) return 0;
  return (musicStore.currentTime / musicStore.duration) * 100;
});

function formatTime(seconds: number) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function handleSeek(e: MouseEvent) {
  if (!musicStore.duration) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  const time = percent * musicStore.duration;
  audioService.seek(time);
}
</script>
