<template>
    <div class="flex flex-row h-full bg-neutral-200 dark:bg-background">
        <!-- Servers Sidebar (Guild Bar) -->
        <aside class="bg-background dark:bg-neutral-900 rounded-lg ml-2 mb-2 flex flex-col items-center p-2 gap-2 shrink-0 overflow-y-auto overflow-x-hidden">
            <!-- Home Button -->
            <UiButton 
                class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 flex items-center justify-center shrink-0 relative group" 
                :class="isLinkActive('/chat') ? 'rounded-[16px]' : ''"
                :variant="isLinkActive('/chat') ? 'default' : 'secondary'"
                as-child
            >
                <NuxtLink to="/chat" aria-label="Home">
                    <Icon name="solar:home-angle-bold" class="h-6 w-6" />
                    <!-- Invite Badge -->
                    <div v-if="store.totalInviteCount > 0" class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground ring-2 ring-background">
                        {{ store.totalInviteCount }}
                    </div>
                </NuxtLink>
            </UiButton>

            <!-- DMs Button -->
            <UiButton 
                class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 flex items-center justify-center shrink-0 relative" 
                :class="isLinkActive('/chat/dms') ? 'rounded-[16px]' : ''"
                :variant="isLinkActive('/chat/dms') ? 'default' : 'secondary'"
                as-child
            >
                <NuxtLink :to="store.lastVisitedRooms.dm ? `/chat/dms/${store.lastVisitedRooms.dm}` : '/chat/dms'" aria-label="Direct Messages">
                    <Icon name="solar:users-group-rounded-bold" class="h-6 w-6" />
                    <!-- Unread Badge -->
                    <div v-if="store.totalDmUnreadCount > 0" class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground ring-2 ring-background pointer-events-none">
                        {{ store.totalDmUnreadCount > 99 ? '99+' : store.totalDmUnreadCount }}
                    </div>
                </NuxtLink>
            </UiButton>

            <!-- Rooms Button -->
            <UiButton 
                class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 flex items-center justify-center shrink-0 relative" 
                :class="isLinkActive('/chat/rooms') ? 'rounded-[16px]' : ''"
                :variant="isLinkActive('/chat/rooms') ? 'default' : 'secondary'"
                as-child
            >
                <NuxtLink :to="store.lastVisitedRooms.rooms ? `/chat/rooms/${store.lastVisitedRooms.rooms}` : '/chat/rooms'" aria-label="Rooms">
                    <Icon name="solar:inbox-archive-bold" class="h-6 w-6" />
                    <!-- Unread Badge -->
                    <div v-if="store.totalOrphanRoomUnreadCount > 0" class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground ring-2 ring-background pointer-events-none">
                        {{ store.totalOrphanRoomUnreadCount > 99 ? '99+' : store.totalOrphanRoomUnreadCount }}
                    </div>
                </NuxtLink>
            </UiButton>

            <div class="w-8 h-[2px] bg-neutral-300 dark:bg-neutral-800 shrink-0" />

            <!-- Server List -->
            <draggable v-model="draggableRootSpaces" class="flex flex-col items-center gap-2 shrink-0" :animation="200" ghost-class="opacity-30" :force-fallback="true" :fallback-on-body="true" :delay="150" :delay-on-touch-only="false" chosen-class="drag-chosen">
                <UiContextMenu v-for="server in draggableRootSpaces" :key="server.roomId">
                    <UiContextMenuTrigger>
                        <UiButton 
                            variant="ghost" 
                            class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 group shrink-0 relative"
                            :class="{ 'rounded-[16px]': isLinkActive(`/chat/spaces/${server.roomId}`) }"
                            as-child
                        >
                            <NuxtLink 
                                :to="store.lastVisitedRooms.spaces[server.roomId] 
                                    ? `/chat/spaces/${server.roomId}/${store.lastVisitedRooms.spaces[server.roomId]}` 
                                    : `/chat/spaces/${server.roomId}`" 
                                :aria-label="server.name"
                            >
                                <MatrixAvatar 
                                    :mxc-url="server.getMxcAvatarUrl()" 
                                    :name="server.name" 
                                    class="h-full w-full border-0 transition-all" 
                                    :class="isLinkActive(`/chat/spaces/${server.roomId}`) ? 'rounded-[16px]' : 'rounded-[24px] group-hover:rounded-[16px]'"
                                    :size="64"
                                />
                                <!-- Space Unread Badge -->
                                <template v-if="store.getSpaceUnreadCount(server.roomId) > 0">
                                    <div class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground ring-2 ring-background pointer-events-none z-10">
                                        {{ store.getSpaceUnreadCount(server.roomId) > 99 ? '99+' : store.getSpaceUnreadCount(server.roomId) }}
                                    </div>
                                </template>
                            </NuxtLink>
                        </UiButton>
                    </UiContextMenuTrigger>
                    <UiContextMenuContent>
                        <UiContextMenuItem v-if="store.pinnedSpaces.includes(server.roomId)" @click="store.unpinSpace(server.roomId)" class="text-destructive focus:text-destructive">
                            <Icon name="solar:pin-broken" class="mr-2 h-4 w-4" />
                            Unpin from Sidebar
                        </UiContextMenuItem>
                        <UiContextMenuItem v-else disabled>
                            <Icon name="solar:info-circle-broken" class="mr-2 h-4 w-4" />
                            Root Space
                        </UiContextMenuItem>
                    </UiContextMenuContent>
                </UiContextMenu>
            </draggable>

            <!-- Add Server / Explorer -->
            <UiButton 
                variant="secondary"
                class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 flex items-center justify-center shrink-0 hover:bg-neutral-300 dark:hover:bg-neutral-800" 
                @click="store.openGlobalSearchModal()"
            >
                <Icon name="solar:add-circle-linear" class="h-6 w-6" />
            </UiButton>
        </aside>

        <!-- Sidebar -->
        <ChatSidebar ref="sidebarRef"/>

        <!-- Main Content -->
        <main class="flex-1 flex-col min-w-0 min-h-0 p-2 pt-0">
            <div class="rounded-lg h-full bg-neutral-100 dark:bg-neutral-900 min-w-0 flex flex-col min-h-0 overflow-hidden">
                <header class="landmark-banner shrink-0">
                    <SecurityBanner />
                </header>
                <NuxtPage class="flex-1 min-h-0" />
            </div>
        </main>
        
        <!-- Member List Panel -->
        <Transition name="slide-pane">
            <div v-if="store.ui.memberListVisible && currentRoom" class="mb-2 mr-2 overflow-hidden shrink-0">
                <RoomMemberList :room="(currentRoom as any)" class="h-full" />
            </div>
        </Transition>
    </div>
    <VerificationModal />
    <GlobalSearchModal :friends="friends" :rooms="rooms" />
</template>

<script setup lang="ts">
definePageMeta({
    middleware: "auth",
});

import { Room, ClientEvent, RoomEvent, EventType, NotificationCountType, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { PushProcessor } from 'matrix-js-sdk/lib/pushprocessor';
import { VueDraggable as draggable } from 'vue-draggable-plus';

const route = useRoute();

const isLinkActive = (to: string) => {
    if (to === "/chat") return route.path === "/chat";
    return route.path.startsWith(to);
};


const store = useMatrixStore();
useGameActivity(); // Initialize game detection at layout level

const sidebarRef = ref<any>(null);

const roomId = computed(() => {
  const params = route.params.id;
  if (Array.isArray(params)) {
    return params[params.length - 1];
  }
  return params;
});

const currentRoom = computed(() => {
  if (!roomId.value || !store.client) return null;
  return store.client.getRoom(roomId.value as string);
});

const friends = computed(() => sidebarRef.value?.friends ?? []);
const rooms = computed(() => sidebarRef.value?.rooms ?? []);

const draggableRootSpaces = computed({
    get: () => {
        const spaces = store.hierarchy.rootSpaces;
        const order = store.ui.uiOrder.rootSpaces;
        if (!order || order.length === 0) return spaces;

        const sorted = [...spaces].sort((a, b) => {
            const indexA = order.indexOf(a.roomId);
            const indexB = order.indexOf(b.roomId);
            
            // If both are in the order list, sort by index
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            
            // If only A is in order, it comes first
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            
            return 0; 
        });
        return sorted;
    },
    set: (val: Room[]) => {
        store.updateRootSpacesOrder(val.map(s => s.roomId));
    }
});

const updateRooms = () => {};

// Hook up listeners so the UI updates when messages come in
const handleTimelineEvent = (event: MatrixEvent, room: Room | undefined, toStartOfTimeline: boolean | undefined) => {
  // Update the room list UI
  updateRooms();

  if (toStartOfTimeline || !room || !store.client) return;
  // Only notify for actual messages
  if (event.getType() !== EventType.RoomMessage && event.getType() !== 'm.room.encrypted') return;
  
  // Don't notify for our own messages
  if (event.getSender() === store.client.getUserId()) return;

  const processor = new PushProcessor(store.client as MatrixClient);
  const actions = processor.actionsForEvent(event);
  
  if (actions.notify) {
      const content = event.getContent();
      const body = content.msgtype === 'm.image' ? 'Sent an image' : (content.body || 'New message');
      
      const n = new Notification(room.name || 'New Message', {
          body: body,
          icon: room.getMxcAvatarUrl() || undefined, // simplified, real app might need mxc conversion
      });
      console.log('Notification sent', n);
  }
};

const setupListeners = () => {
  if (!store.client) { console.error("Client not initialized"); return; };

  // Update list when sync finishes specific stages
  store.client.on(ClientEvent.Room, updateRooms); // New room joined
  // store.client.on(RoomEvent.Timeline, updateRooms); // New message received - replaced by handleTimelineEvent
  store.client.on(RoomEvent.Timeline, handleTimelineEvent);
  store.client.on(RoomEvent.Name, updateRooms); // Room name changed
  store.client.on(RoomEvent.Receipt, updateRooms); // Read receipts (clears unread)
  
  // Initial load
  updateRooms();
};

const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        store.openGlobalSearchModal();
    }
};

// 1. If client is ready on mount, set it up
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  if (store.client) {
    setupListeners();
  }
  
  if (Notification.permission === 'default') {
      Notification.requestPermission();
  }
  
  // Register PWA Service Worker
  subscribeToPush();
});

// 3. Clean up listeners when leaving the page to prevent memory leaks
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (store.client) {
    store.client.removeListener(ClientEvent.Room, updateRooms);
    store.client.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    store.client.removeListener(RoomEvent.Name, updateRooms);
    store.client.removeListener(RoomEvent.Receipt, updateRooms);
  }
});

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  
  try {
      const registration = await navigator.serviceWorker.ready;
      
      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
          // VAPID Public Key from Sygnal
          const publicKey = 'BErt1bY4D7W9yvRy73AC5ojIJUxEZuDS92FBi6HJjqKCv20gKI16bWi-BDkXYj7YETl9kvGoJrZsjmxpnoegs8M'; 
          
          subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: publicKey
          });
      }
      
      if (subscription && store.client) {
          await registerMatrixPusher(subscription);
      }
      
  } catch (err) {
      console.error('PWA: Failed to subscribe to push', err);
  }
}

async function registerMatrixPusher(subscription: PushSubscription) {
    if (!store.client) return;
    
    try {
        const pushKey = subscription.getKey ? btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')!))) : '';
        const pushAuth = subscription.getKey ? btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')!))) : '';
        
        await store.client.setPusher({
            app_id: 'cc.jackg',
            app_display_name: 'Tumult',
            device_display_name: 'Web Client',
            pushkey: subscription.endpoint, 
            kind: 'http',
            lang: 'en',
            data: {
                url: 'http://sygnal:5000/_matrix/push/v1/notify',
            },
        });
        console.log('PWA: Matrix Pusher registered');
    } catch (e) {
        console.error('PWA: Failed to register pusher', e);
    }
}

// 2. If client initializes LATER (e.g. page refresh), watch for it
watch(
  () => store.client,
  (newClient) => {
    if (newClient) setupListeners();
  }
);


</script>

<style scoped>
.slide-pane-enter-active,
.slide-pane-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  max-width: 240px; /* Width of RoomMemberList */
}

.slide-pane-enter-from,
.slide-pane-leave-to {
  max-width: 0;
  opacity: 0;
  transform: translateX(10px);
}
</style>

<style>
.drag-chosen {
  scale: 1.05;
  z-index: 50;
  transition: none !important;
  filter: drop-shadow(0 0 8px rgba(128, 128, 255, 0.4));
}

.opacity-30 {
  transition: none !important;
}
</style>
