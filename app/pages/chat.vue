<template>
    <div class="flex flex-row h-full relative overflow-hidden">
        <!-- Sidebar Pane (Guild Bar + Chat Sidebar) -->
        <div 
            class="flex flex-row h-full shrink-0 transition-transform duration-300 ease-in-out z-10 w-full md:w-auto"
            :class="[
                store.ui.sidebarOpen ? 'translate-x-0' : 'translate-x-[-100%] md:translate-x-0',
                'fixed top-0 left-0 md:relative',
                !store.ui.sidebarOpen && 'pointer-events-none md:pointer-events-auto'
            ]"
        >
            <!-- Servers Sidebar (Guild Bar) -->
            <aside class="rounded-lg ml-2 mb-2 flex flex-col items-center p-2 gap-2 shrink-0 overflow-y-auto overflow-x-hidden bg-background">
                <!-- Home Button -->
                <UiButton 
                    class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 flex items-center justify-center shrink-0 relative group" 
                    :class="isLinkActive('/chat') ? 'rounded-[16px]' : ''"
                    :variant="isLinkActive('/chat') ? 'default' : 'secondary'"
                    @click="() => { store.ui.memberListVisible = false; }"
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
                    @click="() => { store.ui.memberListVisible = false; }"
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
                    @click="() => { store.ui.memberListVisible = false; }"
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

                <div class="w-8 h-[2px] bg-border shrink-0" />

                <!-- Server List -->
                <draggable v-model="draggableRootSpaces" class="flex flex-col items-center gap-2 shrink-0" :animation="200" ghost-class="opacity-30" :force-fallback="true" :delay="150" :delay-on-touch-only="false" chosen-class="drag-chosen">
                    <UiButton 
                        v-for="server in draggableRootSpaces" :key="server.roomId"
                        variant="ghost" 
                        class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 group shrink-0 relative"
                        :class="{ 'rounded-[16px]': isLinkActive(`/chat/spaces/${server.roomId}`) }"
                        @click="() => { store.ui.memberListVisible = false; }"
                        @contextmenu.prevent="store.openRoomContextMenu(server.roomId)"
                        v-long-press="() => { haptics.medium(); store.openRoomContextMenu(server.roomId); }"
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
                </draggable>

                <!-- Add Space / Explorer -->
                <UiButton 
                    variant="secondary"
                    class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 flex items-center justify-center shrink-0" 
                    @click="store.openCreateSpaceModal()"
                    title="Create a space"
                >
                    <Icon name="solar:add-circle-linear" class="h-6 w-6" />
                </UiButton>
            </aside>

            <!-- Sidebar -->
            <ChatSidebar ref="sidebarRef" class="min-w-0 flex-1"/>
        </div>

        <!-- Main Content -->
        <main 
            class="flex-1 flex-col min-w-0 min-h-0 p-2 pt-0 transition-transform duration-300 ease-in-out z-20"
            :class="[
                store.ui.sidebarOpen ? 'translate-x-full md:translate-x-0' : (store.ui.memberListVisible ? '-translate-x-full md:translate-x-0' : 'translate-x-0')
            ]"
        >
            <div class="rounded-lg h-full bg-card min-w-0 flex flex-col min-h-0 overflow-hidden relative">
                <!-- Mobile Overlays to close sidebars -->
                <div 
                    v-if="store.ui.sidebarOpen" 
                    class="md:hidden absolute inset-0 z-50 bg-black/20"
                    @click="store.toggleSidebar(false)"
                ></div>
                <div 
                    v-if="store.ui.memberListVisible" 
                    class="md:hidden absolute inset-0 z-50 bg-black/20"
                    @click="store.toggleMemberList()"
                ></div>

                <header class="landmark-banner shrink-0">
                    <SecurityBanner />
                </header>
                <NuxtPage class="flex-1 min-h-0" />
            </div>
        </main>
        
        <!-- Member List Pane -->
        <div 
            v-if="currentRoom && isChatRoute" 
            class="flex flex-row h-full shrink-0 transition-all duration-300 ease-in-out z-10 w-full overflow-hidden"
            :class="[
                store.ui.memberListVisible ? 'translate-x-0 md:w-60' : 'translate-x-full md:translate-x-0 md:w-0',
                'fixed top-0 left-0 md:left-auto md:right-0 md:relative',
                !store.ui.memberListVisible && 'pointer-events-none'
            ]"
        >
            <RoomMemberList :room="(currentRoom as any)" class="h-full w-full md:w-60 bg-background shrink-0" />
        </div>
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
import { notify } from '~/utils/notify';

const route = useRoute();

const isLinkActive = (to: string) => {
    if (to === "/chat") return route.path === "/chat";
    return route.path.startsWith(to);
};

const isChatRoute = computed(() => {
    const path = route.path;
    // Check if it's a DM, standard room, or space room (not space lobby)
    return path.startsWith('/chat/dms/') || 
           path.startsWith('/chat/rooms/') || 
           (path.startsWith('/chat/spaces/') && Array.isArray(route.params.id) && route.params.id.length > 1);
});

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
const handleTimelineEvent = async (event: MatrixEvent, room: Room | undefined, toStartOfTimeline: boolean | undefined) => {
  // Update the room list UI
  updateRooms();

  if (toStartOfTimeline || !room || !store.client) return;

  // Prevent history spam by only notifying when the client is fully synced
  // and we are NOT in the middle of a large initial sync.
  const syncState = store.client.getSyncState();
  if (syncState !== 'SYNCING') return;

  // Crucial: Matrix SDK will emit "Timeline" events for old messages during the initial sync.
  // We check if the event's timestamp is within the last 5 seconds to ensure it's "live".
  const age = Date.now() - event.getTs();
  if (age > 5000) return;

  // Only notify for actual messages
  if (event.getType() !== EventType.RoomMessage && event.getType() !== 'm.room.encrypted') return;
  
  // Don't notify for our own messages
  if (event.getSender() === store.client.getUserId()) return;

  // For encrypted messages, we need to wait for decryption
  if (event.getType() === 'm.room.encrypted' && !event.getClearContent()) {
    try {
      await event.attemptDecryption(store.client.getCrypto() as any);
    } catch (e) {
      console.warn('Failed to decrypt event for notification:', e);
    }
  }

  const processor = new PushProcessor(store.client as MatrixClient);
  const actions = processor.actionsForEvent(event);
  
  if (actions.notify) {
      const content = event.getClearContent() || event.getContent();
      const senderMember = room.getMember(event.getSender());
      const senderName = senderMember?.name || event.getSender();
      
      let bodyText = 'New message';
      let imageUrl: string | undefined;

      if (content.msgtype === 'm.image') {
        bodyText = `Sent an image: ${content.body || 'filename'}`;
        const mxcUrl = content.file?.url || content.url;
        if (mxcUrl) {
          // Use authenticated thumbnail if possible, otherwise fallback to unauthenticated MXC
          const serverName = mxcUrl.replace('mxc://', '').split('/')[0];
          const mediaId = mxcUrl.replace('mxc://', '').split('/')[1];
          if (serverName && mediaId) {
            imageUrl = `${store.client.baseUrl}/_matrix/client/v1/media/thumbnail/${serverName}/${mediaId}?width=800&height=600&method=scale&animated=true`;
            // Add access token if we have one
            const token = store.client.getAccessToken();
            if (token) imageUrl += `&access_token=${encodeURIComponent(token)}`;
          } else {
            imageUrl = store.client.mxcUrlToHttp(mxcUrl);
          }
        }
      } else if (content.msgtype === 'm.video') bodyText = 'Sent a video';
      else if (content.msgtype === 'm.file') bodyText = `Sent a file: ${content.body}`;
      else if (content.body) bodyText = content.body;

      // Determine if it is a private DM
      const isDirect = room.getMember(store.client.getUserId()!)?.events.member?.getContent().is_direct ||
                       room.currentState.getStateEvents('m.room.member', store.client.getUserId()!)?.getContent().is_direct;
      
      // Better way to check for DM: check the store's directMessageMap or room members count
      const isDM = room.getInvitedAndJoinedMemberCount() === 2 && isDirect;

      const title = isDM ? senderName : `${senderName} in ${room.name || 'Room'}`;
      const notificationBody = bodyText;

      let iconUrl = isDM
        ? senderMember?.getMxcAvatarUrl()
        : room.getMxcAvatarUrl();

      if (iconUrl) {
        const serverName = iconUrl.replace('mxc://', '').split('/')[0];
        const mediaId = iconUrl.replace('mxc://', '').split('/')[1];
        if (serverName && mediaId) {
          iconUrl = `${store.client.baseUrl}/_matrix/client/v1/media/thumbnail/${serverName}/${mediaId}?width=96&height=96&method=crop`;
          const token = store.client.getAccessToken();
          if (token) iconUrl += `&access_token=${encodeURIComponent(token)}`;
        } else {
          iconUrl = store.client.mxcUrlToHttp(iconUrl);
        }
      }

      notify(title, notificationBody, iconUrl || undefined, room.roomId, imageUrl);
      console.log('Notification sent', { title, body: notificationBody, imageUrl });
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
  transform: scale(1.05) !important;
  z-index: 50;
  transition: none !important;
  filter: drop-shadow(0 0 8px rgba(128, 128, 255, 0.4));
}

.opacity-30 {
  transition: none !important;
}
</style>
