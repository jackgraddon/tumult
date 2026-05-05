<template>
  <div class="flex flex-col h-full overflow-y-auto relative">
    <!-- Background Image -->
    <div
      v-if="backgroundUrl"
      class="absolute top-0 left-0 right-0 h-[400px] z-0 opacity-40 mask-image-gradient"
      :style="{ backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }"
    />

    <div class="relative z-10 p-8 space-y-12 pt-24">
      <!-- Artist Header -->
      <div class="flex items-end gap-8">
        <div class="h-64 w-64 shrink-0 rounded-full overflow-hidden shadow-2xl border-4 border-background bg-muted">
          <img v-if="imageUrl" :src="imageUrl" class="h-full w-full object-cover" alt="" >
          <div v-else class="h-full w-full flex items-center justify-center">
            <Icon name="solar:user-bold" class="h-32 w-32 text-muted-foreground/30" />
          </div>
        </div>
        <div class="flex-1 space-y-6 pb-4">
          <div class="space-y-1">
            <h1 class="text-6xl font-black tracking-tighter text-foreground">{{ artist?.Name }}</h1>
            <p v-if="artist?.ProductionYear" class="text-xl text-muted-foreground font-medium">Since {{ artist.ProductionYear }}</p>
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

      <!-- Top Sections -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <!-- Top Songs -->
        <div class="lg:col-span-2 space-y-6">
          <h2 class="text-2xl font-bold tracking-tight">Popular Songs</h2>
          <div class="space-y-1">
            <div
              v-for="(song, index) in topSongs"
              :key="song.Id"
              class="flex items-center gap-4 p-2 rounded-md hover:bg-accent/50 group cursor-pointer transition-colors"
              @click="play(song)"
              @contextmenu.capture="uiStore.openMusicItemContextMenu(song)"
            >
              <span class="w-6 text-sm text-muted-foreground text-center font-medium group-hover:hidden">{{ index + 1 }}</span>
              <Icon name="solar:play-bold" class="w-6 h-6 text-[#AA5CC3] hidden group-hover:block" />

              <div class="h-10 w-10 shrink-0 rounded bg-muted overflow-hidden">
                <img v-if="getSongImageUrl(song)" :src="getSongImageUrl(song)" class="h-full w-full object-cover" alt="" >
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold truncate">{{ song.Name }}</p>
                <p class="text-xs text-muted-foreground truncate">{{ song.Album }}</p>
              </div>

              <span class="text-xs text-muted-foreground font-medium tabular-nums">{{ formatDuration(song.RunTimeTicks) }}</span>
            </div>
          </div>
        </div>

        <!-- Latest Release -->
        <div v-if="latestAlbum" class="space-y-6">
          <h2 class="text-2xl font-bold tracking-tight">Latest Release</h2>
          <div
            class="p-6 rounded-xl bg-accent/20 border border-border/50 space-y-4 hover:bg-accent/30 transition-colors cursor-pointer"
            @click="navigateTo(`/chat/music/albums/${latestAlbum.Id}`)"
          >
            <div class="aspect-square rounded-lg overflow-hidden shadow-lg border border-border/50">
              <img :src="getAlbumImageUrl(latestAlbum)" class="h-full w-full object-cover" alt="" >
            </div>
            <div>
              <p class="text-lg font-bold">{{ latestAlbum.Name }}</p>
              <p class="text-sm text-muted-foreground font-medium">{{ latestAlbum.ProductionYear }} • Album</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Discography -->
      <MusicSection
        title="Discography"
        :items="albums"
        :loading="loading.albums"
        layout="grid"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useJellyfin } from '~/composables/useJellyfin';
import { useJellyfinStore } from '~/stores/jellyfin';
import { useMusicStore } from '~/stores/music';
import { useUIStore } from "~/stores/ui";
import { useServices } from "~/composables/useServices";
import type { BaseItemDto } from '~/types/jellyfin';
import MusicSection from '~/components/music/MusicSection.vue';

const route = useRoute();
const { fetcher } = useJellyfin();
const jellyfinStore = useJellyfinStore();
const musicStore = useMusicStore();
const uiStore = useUIStore();
const { audioService } = useServices();

const artistId = route.params.id as string;
const artist = ref<BaseItemDto | null>(null);
const topSongs = ref<BaseItemDto[]>([]);
const albums = ref<BaseItemDto[]>([]);
const latestAlbum = computed(() => albums.value[0]);
const isShuffling = ref(false);
let holdTimer: any = null;

const loading = reactive({ artist: false, topSongs: false, albums: false });

const imageUrl = computed(() => {
  if (artist.value?.ImageTags?.Primary) {
    return `${jellyfinStore.serverUrl}/Items/${artist.value.Id}/Images/Primary?tag=${artist.value.ImageTags.Primary}&maxWidth=500&api_key=${jellyfinStore.accessToken}`;
  }
  return null;
});

const backgroundUrl = computed(() => {
  if (artist.value?.ImageTags?.Backdrop) {
    return `${jellyfinStore.serverUrl}/Items/${artist.value.Id}/Images/Backdrop?tag=${artist.value.ImageTags.Backdrop}&maxWidth=1920&api_key=${jellyfinStore.accessToken}`;
  }
  return null;
});

async function loadArtist() {
  if (!jellyfinStore.isAuthenticated) return;

  loading.artist = true;
  fetcher(`/Users/${jellyfinStore.userId}/Items/${artistId}`, { method: 'GET' })
    .then(data => {
      artist.value = data as BaseItemDto;
    })
    .catch(err => {
      console.error('[Artist] Failed to load artist:', err);
    })
    .finally(() => loading.artist = false);

  loading.topSongs = true;
  fetcher('/Items', {
    method: 'GET',
    query: {
      ArtistIds: [artistId],
      IncludeItemTypes: ['Audio'],
      Recursive: true,
      SortBy: ['PlayCount'],
      SortOrder: 'Descending',
      Limit: 10,
      Fields: ['ArtistItems', 'PrimaryImageAspectRatio', 'UserData']
    }
  }).then((data: any) => {
    if (data && data.Items) topSongs.value = data.Items as BaseItemDto[];
  }).finally(() => loading.topSongs = false);

  loading.albums = true;
  fetcher('/Items', {
    method: 'GET',
    query: {
      ArtistIds: [artistId],
      IncludeItemTypes: ['MusicAlbum'],
      Recursive: true,
      SortBy: ['ProductionYear'],
      SortOrder: 'Descending',
      Fields: ['ArtistItems', 'PrimaryImageAspectRatio', 'UserData']
    }
  }).then((data: any) => {
    if (data && data.Items) albums.value = data.Items as BaseItemDto[];
  }).finally(() => loading.albums = false);
}

function getSongImageUrl(item: BaseItemDto) {
  if (item.ImageTags?.Primary) {
    return `${jellyfinStore.serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=100&api_key=${jellyfinStore.accessToken}`;
  }
  return null;
}

function getAlbumImageUrl(item: BaseItemDto) {
  if (item.ImageTags?.Primary) {
    return `${jellyfinStore.serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=400&api_key=${jellyfinStore.accessToken}`;
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

function mapToSong(item: BaseItemDto) {
  if (!item.Id || !item.Name) return null;
  const streamUrl = `${jellyfinStore.serverUrl}/Audio/${item.Id}/stream?static=true&api_key=${jellyfinStore.accessToken}`;

  return {
    id: item.Id,
    title: item.Name,
    artist: item.ArtistItems?.[0]?.Name || artist.value?.Name || 'Unknown Artist',
    album: item.Album || undefined,
    albumArtist: item.AlbumArtist || undefined,
    coverUrl: getSongImageUrl(item) || undefined,
    streamUrl
  };
}

function play(item: BaseItemDto) {
  const song = mapToSong(item);
  if (song) audioService.playSong(song);
}

async function playAll(shuffle = false) {
  try {
    const data: any = await fetcher('/Items', {
      method: 'GET',
      query: {
        ArtistIds: [artistId],
        IncludeItemTypes: ['Audio'],
        Recursive: true,
        Fields: ['ArtistItems', 'PrimaryImageAspectRatio', 'UserData', 'Album']
      }
    });

    if (data && data.Items && Array.isArray(data.Items) && data.Items.length > 0) {
      let songsToPlay = data.Items.map((t: BaseItemDto) => mapToSong(t)).filter((s: any): s is any => !!s);

      if (shuffle) {
        songsToPlay = songsToPlay.sort(() => Math.random() - 0.5);
      }

      audioService.playSong(songsToPlay[0]);
      if (songsToPlay.length > 1) {
        musicStore.addToQueue(songsToPlay.slice(1));
      }
    }
  } catch (e) {
    console.error('[Artist] Failed to play all tracks:', e);
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

async function addAllToQueue() {
  try {
    const data: any = await fetcher('/Items', {
      method: 'GET',
      query: {
        ArtistIds: [artistId],
        IncludeItemTypes: ['Audio'],
        Recursive: true,
        Fields: ['ArtistItems', 'PrimaryImageAspectRatio', 'UserData', 'Album']
      }
    });

    if (data && data.Items && Array.isArray(data.Items)) {
      const songs = data.Items.map((t: BaseItemDto) => mapToSong(t)).filter((s: any): s is any => !!s);
      if (songs.length > 0) {
        musicStore.addToQueue(songs);
      }
    }
  } catch (e) {
    console.error('[Artist] Failed to add all to queue:', e);
  }
}

onMounted(() => {
  loadArtist();
});
</script>

<style scoped>
.mask-image-gradient {
  mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
}
</style>
