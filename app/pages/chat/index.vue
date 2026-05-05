<template>
  <div class="container p-4 py-6 space-y-8">
    <div class="flex items-center gap-4">
      <UiButton
        v-if="!uiStore.sidebarOpen"
        variant="ghost"
        size="icon-sm"
        class="md:hidden shrink-0"
        @click="uiStore.toggleSidebar(true)"
      >
        <Icon name="solar:hamburger-menu-linear" class="h-6 w-6" />
      </UiButton>
      <h1 class="text-3xl font-bold tracking-tight">Home</h1>
    </div>

    <!-- Jellyfin Music Entry -->
    <!-- <div v-if="jellyfinStore.isAuthenticated" class="space-y-4">
      <h2 class="text-xl font-semibold tracking-tight text-[#AA5CC3]">Music</h2>
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <NuxtLink to="/chat/music" class="block group">
          <UiCard class="h-full border-[#AA5CC3]/30 transition-all hover:bg-[#AA5CC3]/5 hover:border-[#AA5CC3]">
            <UiCardHeader class="flex flex-row items-center gap-4 space-y-0 pb-4">
              <div class="h-12 w-12 flex items-center justify-center rounded-full bg-[#AA5CC3]">
                <Icon name="solar:music-note-bold" class="text-white h-6 w-6" />
              </div>
              <div class="flex flex-col overflow-hidden">
                <UiCardTitle class="text-base font-medium truncate">
                  My Music Library
                </UiCardTitle>
                <UiCardDescription class="text-xs truncate">
                  Listen to your Jellyfin collection
                </UiCardDescription>
              </div>
            </UiCardHeader>
          </UiCard>
        </NuxtLink>
      </div>
    </div> -->

    <!-- Recent DMs -->
    <div class="space-y-4">
      <h2 class="text-xl font-semibold tracking-tight">Recent Direct Messages</h2>
      <div v-if="recentDms.length > 0" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="room in recentDms"
          :key="room.roomId"
          :to="`/chat/dms/${room.roomId}`"
          class="block group"
          @click="() => { uiStore.toggleSidebar(false); uiStore.memberListVisible = false; }"
        >
          <UiCard class="h-full transition-colors hover:bg-muted/50">
            <UiCardHeader class="flex flex-row items-center gap-4 space-y-0 pb-2">
              <MatrixAvatar 
                :mxc-url="getRoomAvatarMxc(room)"
                :name="room.name" 
                class="h-12 w-12"
              />
              <div class="flex flex-col overflow-hidden">
                <UiCardTitle class="text-base font-medium truncate">
                  {{ room.name }}
                </UiCardTitle>
                <UiCardDescription class="text-xs truncate">
                  {{ getLastMessage(room) }}
                </UiCardDescription>
              </div>
            </UiCardHeader>
          </UiCard>
        </NuxtLink>
      </div>
      <div v-else class="text-muted-foreground text-sm italic">
        No recent direct messages found.
      </div>
    </div>

    <!-- Recent Rooms -->
    <div class="space-y-4">
      <h2 class="text-xl font-semibold tracking-tight">Recent Rooms</h2>
      <div v-if="recentRooms.length > 0" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="room in recentRooms"
          :key="room.roomId"
          :to="`/chat/rooms/${room.roomId}`"
          class="block group"
          @click="() => { uiStore.toggleSidebar(false); uiStore.memberListVisible = false; }"
        >
          <UiCard class="h-full transition-colors hover:bg-muted/50">
             <UiCardHeader class="flex flex-row items-center gap-4 space-y-0 pb-2">
              <MatrixAvatar 
                :mxc-url="getRoomAvatarMxc(room)"
                :name="room.name" 
                class="h-12 w-12"
              />
              <div class="flex flex-col overflow-hidden">
                <UiCardTitle class="text-base font-medium truncate">
                  {{ room.name }}
                </UiCardTitle>
                <UiCardDescription class="text-xs truncate">
                  {{ getLastMessage(room) }}
                </UiCardDescription>
              </div>
            </UiCardHeader>
          </UiCard>
        </NuxtLink>
      </div>
      <div v-else class="text-muted-foreground text-sm italic">
        No recent rooms found.
      </div>
    </div>

    <div v-if="!store.isSyncing" class="flex items-center justify-center p-8 text-muted-foreground">
      <p>Syncing with Matrix...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as sdk from 'matrix-js-sdk';
import MatrixAvatar from '~/components/MatrixAvatar.vue';
import { Card as UiCard, CardHeader as UiCardHeader, CardTitle as UiCardTitle, CardDescription as UiCardDescription } from '~/components/ui/card';
import { useJellyfinStore } from '~/stores/jellyfin';

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();
const jellyfinStore = useJellyfinStore();

// Use explicit casts or relaxed types to handle potential version mismatches in types
const recentDms = ref<any[]>([]);
const recentRooms = ref<any[]>([]);

const getLastMessage = (room: any): string => {
  const lastEvent = room.timeline && room.timeline.length > 0 
      ? room.timeline[room.timeline.length - 1] 
      : null;
  return lastEvent ? lastEvent.getContent().body : 'No messages';
};

const getRoomAvatarMxc = (room: any): string | undefined => {
    // 1. Try explicit room avatar
    if (room.currentState) {
       const avatarEvent = room.currentState.getStateEvents('m.room.avatar', '');
       if (avatarEvent && avatarEvent.getContent().url) {
           return avatarEvent.getContent().url;
       }
    }
    
    // 2. Fallback for DMs: find other user
    // We need to know if it is a DM to be safe, or just check members if 2 people
    // Simplest heuristic: 2 members, one is us, the other is the target
    if (!store.client) return undefined;
    const myUserId = store.client.getUserId();
    const members = room.getJoinedMembers();
    
    if (members.length === 2) {
        const otherAndMe = members.filter((m: any) => m.userId !== myUserId);
        const other = otherAndMe.length > 0 ? otherAndMe[0] : members.find((m: any) => m.userId !== myUserId); // Fallback if filter weirdness
        
        if (other && other.getMxcAvatarUrl()) {
            return other.getMxcAvatarUrl();
        }
    }

    return undefined;
};

const updateLists = () => {
  if (!store.client) return;

  const visibleRooms = store.client.getVisibleRooms();
  const directEvent = store.client.getAccountData(sdk.EventType.Direct);
  const directContent = directEvent ? directEvent.getContent() : {};

  const dmRoomIds = new Set<string>();
  if (directContent) {
      Object.values(directContent).forEach((rooms: unknown) => {
          if (Array.isArray(rooms)) {
              rooms.forEach((r: unknown) => {
                  if (typeof r === 'string') dmRoomIds.add(r);
              });
          }
      });
  }

  const dms: any[] = [];
  const rooms: any[] = [];

  visibleRooms.forEach(room => {
      // Ensure we are joined
      if (room.getMyMembership() !== 'join') return;

      if (dmRoomIds.has(room.roomId)) {
          dms.push(room);
      } else {
          rooms.push(room);
      }
  });

  const sortByRecency = (a: any, b: any) => {
       const timeA = typeof a.getLastActiveTimestamp === 'function' ? a.getLastActiveTimestamp() : 0;
       const timeB = typeof b.getLastActiveTimestamp === 'function' ? b.getLastActiveTimestamp() : 0;
       return timeB - timeA;
  };

  recentDms.value = dms.sort(sortByRecency).slice(0, 3);
  recentRooms.value = rooms.sort(sortByRecency).slice(0, 3);
};

const setupListeners = () => {
  if (!store.client) return;

  store.client.on(sdk.ClientEvent.Room, updateLists);
  store.client.on(sdk.RoomEvent.Timeline, updateLists);
  store.client.on(sdk.RoomEvent.Name, updateLists);
  store.client.on(sdk.MatrixEventEvent.Decrypted, updateLists);
  store.client.on(sdk.ClientEvent.AccountData, (event) => {
      if (event.getType() === sdk.EventType.Direct) {
          updateLists();
      }
  });
  
  updateLists();
};

onMounted(() => {
  if (store.client) {
    setupListeners();
  }
});

watch(
  () => store.client,
  (newClient) => {
    if (newClient) setupListeners();
  }
);

onUnmounted(() => {
  if (store.client) {
    store.client.removeListener(sdk.ClientEvent.Room, updateLists);
    store.client.removeListener(sdk.RoomEvent.Timeline, updateLists);
    store.client.removeListener(sdk.RoomEvent.Name, updateLists);
  }
});
</script>