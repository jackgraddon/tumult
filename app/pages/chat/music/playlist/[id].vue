<template>
  <div class="flex flex-col h-full overflow-y-auto">
    <!-- Playlist Header -->
    <div class="relative p-8 pt-16 flex flex-col md:flex-row gap-8 items-end bg-gradient-to-b from-[#AA5CC3]/20 to-transparent shrink-0">
      <div class="h-64 w-64 shrink-0 rounded-lg overflow-hidden shadow-2xl border border-border/50 bg-muted">
        <img v-if="imageUrl" :src="imageUrl" class="h-full w-full object-cover" alt="" >
        <div v-else class="h-full w-full flex items-center justify-center">
          <Icon name="solar:playlist-minimalistic-bold" class="h-32 w-32 text-muted-foreground/30" />
        </div>
      </div>
      <div class="flex-1 space-y-2 pb-4">
        <span class="text-xs font-bold uppercase tracking-wider text-[#AA5CC3]">Playlist</span>
        <h1 class="text-5xl font-black tracking-tighter text-foreground">{{ playlist?.Name }}</h1>
        <div class="flex items-center gap-2 text-muted-foreground font-medium pb-4">
          <span>By {{ jellyfinStore.clientName }} User</span>
          <span>•</span>
          <span>{{ tracks.length }} tracks</span>
        </div>
        <div class="flex items-center gap-3">
          <UiButton
            class="rounded-full px-8 h-12 bg-[#AA5CC3] hover:bg-[#AA5CC3]/90 text-white font-bold gap-2 shadow-lg transition-transform active:scale-95"
            @click="() => { if (!isShuffling) playAll(false); }"
            @mousedown="startHoldTimer"
            @mouseup="clearHoldTimer"
            @mouseleave="clearHoldTimer"
            @touchstart.passive="startHoldTimer"
            @touchend="clearHoldTimer"
          >
            <Icon :name="isShuffling ? 'solar:shuffle-bold' : 'solar:play-bold'" class="h-6 w-6" />
            {{ isShuffling ? 'Shuffling...' : 'Play' }}
          </UiButton>
          <UiButton
            variant="secondary"
            class="rounded-full px-8 h-12 font-bold gap-2 transition-transform active:scale-95"
            @click="playAll(true)"
          >
            <Icon name="solar:shuffle-bold" class="h-6 w-6" />
            Shuffle
          </UiButton>
          <UiButton
            variant="ghost"
            size="icon"
            class="rounded-full h-12 w-12 border border-border/50"
            title="Add all to queue"
            @click="addAllToQueue"
          >
            <Icon name="solar:list-line-duotone" class="h-6 w-6" />
          </UiButton>
        </div>
      </div>
    </div>

    <!-- Track List -->
    <div class="p-4 flex-1">
      <div class="space-y-1">
        <div
          v-for="(track, index) in tracks"
          :key="track.Id"
          class="flex items-center gap-4 p-2 rounded-md hover:bg-accent/50 group cursor-pointer transition-colors"
          @click="play(track)"
          @contextmenu.capture="uiStore.openMusicItemContextMenu(track)"
        >
          <span class="w-8 text-sm text-muted-foreground text-center font-medium group-hover:hidden">{{ index + 1 }}</span>
          <div class="w-8 h-8 flex items-center justify-center hidden group-hover:flex">
             <Icon name="solar:play-bold" class="w-6 h-6 text-[#AA5CC3]" />
          </div>

          <div class="h-10 w-10 shrink-0 rounded bg-muted overflow-hidden">
            <img v-if="getSongImageUrl(track)" :src="getSongImageUrl(track)" class="h-full w-full object-cover" alt="" >
          </div>

          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold truncate" :class="[musicStore.currentSong?.id === track.Id ? 'text-[#AA5CC3]' : 'text-foreground']">
              {{ track.Name }}
            </p>
            <p class="text-xs text-muted-foreground truncate">{{ track.ArtistItems?.[0]?.Name }} • {{ track.Album }}</p>
          </div>

          <span class="text-xs text-muted-foreground font-medium tabular-nums px-4">{{ formatDuration(track.RunTimeTicks) }}</span>

          <UiButton variant="ghost" size="icon-sm" class="opacity-0 group-hover:opacity-100 h-8 w-8" @click.stop="addToQueue(track)">
             <Icon name="solar:list-line-duotone" class="h-4 w-4 text-muted-foreground hover:text-[#AA5CC3]" />
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useJellyfin } from '~/composables/useJellyfin';
import { useJellyfinStore } from '~/stores/jellyfin';
import { useMusicStore } from '~/stores/music';
import { useUIStore } from "~/stores/ui";
import { useServices } from "~/composables/useServices";
import type { BaseItemDto } from '~/types/jellyfin';

const route = useRoute();
const { fetcher } = useJellyfin();
const jellyfinStore = useJellyfinStore();
const musicStore = useMusicStore();
const uiStore = useUIStore();
const { audioService } = useServices();

const playlistId = route.params.id as string;
const playlist = ref<BaseItemDto | null>(null);
const tracks = ref<BaseItemDto[]>([]);
const isShuffling = ref(false);
let holdTimer: any = null;

const imageUrl = computed(() => {
  if (playlist.value?.ImageTags?.Primary) {
    return `${jellyfinStore.serverUrl}/Items/${playlist.value.Id}/Images/Primary?tag=${playlist.value.ImageTags.Primary}&maxWidth=500&api_key=${jellyfinStore.accessToken}`;
  }
  return null;
});

async function loadPlaylist() {
  if (!jellyfinStore.isAuthenticated) return;

  // Load Playlist Metadata
  fetcher(`/Users/${jellyfinStore.userId}/Items/${playlistId}`, { method: 'GET' })
    .then(data => playlist.value = data as BaseItemDto);

  // Load Tracks
  fetcher('/Items', {
    method: 'GET',
    query: {
      ParentId: playlistId,
      IncludeItemTypes: ['Audio'],
      Fields: ['ArtistItems', 'PrimaryImageAspectRatio', 'UserData', 'Album']
    }
  }).then(data => {
    if (data && data.Items) tracks.value = data.Items as BaseItemDto[];
  });
}

function getSongImageUrl(item: BaseItemDto) {
  if (item.ImageTags?.Primary) {
    return `${jellyfinStore.serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=100&api_key=${jellyfinStore.accessToken}`;
  }
  return null;
}

function formatDuration(ticks?: number | null) {
  if (!ticks) return '0:00';
  const seconds = Math.floor(ticks / 10000000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function play(item: BaseItemDto) {
  const song = mapToSong(item);
  if (song) audioService.playSong(song);
}

function playAll(shuffle = false) {
  if (tracks.value.length === 0) return;

  let songsToPlay = tracks.value.map(t => mapToSong(t)).filter((s): s is any => !!s);
  if (shuffle) {
    songsToPlay = songsToPlay.sort(() => Math.random() - 0.5);
  }

  audioService.playSong(songsToPlay[0]);
  if (songsToPlay.length > 1) {
    musicStore.addToQueue(songsToPlay.slice(1));
  }
}

function startHoldTimer() {
  holdTimer = setTimeout(() => {
    isShuffling.value = true;
    playAll(true);
    setTimeout(() => { isShuffling.value = false; }, 1000);
    holdTimer = null;
  }, 600);
}

function clearHoldTimer() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function addAllToQueue() {
  const songs = tracks.value.map(t => mapToSong(t)).filter((s): s is any => !!s);
  if (songs.length > 0) {
    musicStore.addToQueue(songs);
  }
}

function addToQueue(item: BaseItemDto) {
  const song = mapToSong(item);
  if (song) musicStore.addToQueue(song);
}

function mapToSong(item: BaseItemDto) {
  if (!item.Id || !item.Name) return null;
  const streamUrl = `${jellyfinStore.serverUrl}/Audio/${item.Id}/stream?static=true&api_key=${jellyfinStore.accessToken}`;

  return {
    id: item.Id,
    title: item.Name,
    artist: item.ArtistItems?.[0]?.Name || 'Unknown Artist',
    album: item.Album || undefined,
    coverUrl: getSongImageUrl(item) || undefined,
    streamUrl
  };
}

onMounted(() => {
  loadPlaylist();
});
</script>
