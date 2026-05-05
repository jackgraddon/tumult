<template>
  <div class="flex flex-col h-full overflow-y-auto">
    <!-- Album Header -->
    <div class="relative p-8 pt-16 flex flex-col md:flex-row gap-8 items-end bg-gradient-to-b from-accent/30 to-transparent shrink-0">
      <div class="h-64 w-64 shrink-0 rounded-lg overflow-hidden shadow-2xl border border-border/50 bg-muted">
        <img v-if="imageUrl" :src="imageUrl" class="h-full w-full object-cover" alt="" >
        <div v-else class="h-full w-full flex items-center justify-center">
          <Icon name="solar:album-bold" class="h-32 w-32 text-muted-foreground/30" />
        </div>
      </div>
      <div class="flex-1 space-y-2 pb-4">
        <span class="text-xs font-bold uppercase tracking-wider text-[#AA5CC3]">Album</span>
        <h1 class="text-5xl font-black tracking-tighter text-foreground">{{ album?.Name }}</h1>
        <div class="flex items-center gap-2 text-muted-foreground font-medium">
          <NuxtLink :to="`/chat/music/artists/${album?.ArtistItems?.[0]?.Id}`" class="hover:underline text-foreground">
            {{ album?.AlbumArtist || album?.ArtistItems?.[0]?.Name }}
          </NuxtLink>
          <span>•</span>
          <span>{{ album?.ProductionYear }}</span>
          <span>•</span>
          <span>{{ tracks.length }} songs</span>
        </div>
        <div class="flex items-center gap-3 pt-4">
           <UiButton class="bg-[#AA5CC3] hover:bg-[#AA5CC3]/90 text-white gap-2" @click="playAll">
             <Icon name="solar:play-bold" class="h-4 w-4" />
             Play All
           </UiButton>
           <UiButton variant="secondary" class="gap-2" @click="addAllToQueue">
             <Icon name="solar:list-line-duotone" class="h-4 w-4" />
             Add to Queue
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

          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold truncate" :class="[musicStore.currentSong?.id === track.Id ? 'text-[#AA5CC3]' : 'text-foreground']">
              {{ track.Name }}
            </p>
            <p class="text-xs text-muted-foreground truncate">{{ track.ArtistItems?.[0]?.Name }}</p>
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

const albumId = route.params.id as string;
const album = ref<BaseItemDto | null>(null);
const tracks = ref<BaseItemDto[]>([]);

const imageUrl = computed(() => {
  if (album.value?.ImageTags?.Primary) {
    return `${jellyfinStore.serverUrl}/Items/${album.value.Id}/Images/Primary?tag=${album.value.ImageTags.Primary}&maxWidth=500&api_key=${jellyfinStore.accessToken}`;
  }
  return null;
});

async function loadAlbum() {
  if (!jellyfinStore.isAuthenticated) return;

  // Load Album Metadata
  fetcher(`/Users/${jellyfinStore.userId}/Items/${albumId}`, { method: 'GET' })
    .then(data => album.value = data as BaseItemDto);

  // Load Tracks
  fetcher('/Items', {
    method: 'GET',
    query: {
      ParentId: albumId,
      IncludeItemTypes: ['Audio'],
      Recursive: true,
      SortBy: ['ParentIndexNumber', 'IndexNumber', 'SortName'],
      Fields: ['ArtistItems', 'PrimaryImageAspectRatio', 'UserData']
    }
  }).then((data: any) => {
    if (data && data.Items) tracks.value = data.Items as BaseItemDto[];
  });
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

function addToQueue(item: BaseItemDto) {
  const song = mapToSong(item);
  if (song) musicStore.addToQueue(song);
}

function playAll() {
  if (tracks.value.length === 0) return;
  const songs = tracks.value.map(t => mapToSong(t)).filter((s): s is any => !!s);
  if (songs.length > 0) {
    audioService.playSong(songs[0]);
    if (songs.length > 1) {
      musicStore.addToQueue(songs.slice(1));
    }
  }
}

function addAllToQueue() {
  const songs = tracks.value.map(t => mapToSong(t)).filter((s): s is any => !!s);
  if (songs.length > 0) {
    musicStore.addToQueue(songs);
  }
}

function mapToSong(item: BaseItemDto) {
  if (!item.Id || !item.Name) return null;
  const streamUrl = `${jellyfinStore.serverUrl}/Audio/${item.Id}/stream?static=true&api_key=${jellyfinStore.accessToken}`;

  return {
    id: item.Id,
    title: item.Name,
    artist: item.ArtistItems?.[0]?.Name || album.value?.Name || 'Unknown Artist',
    album: album.value?.Name || undefined,
    coverUrl: imageUrl.value || undefined,
    streamUrl
  };
}

onMounted(() => {
  loadAlbum();
});
</script>
