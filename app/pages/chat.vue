<template>
    <div
        class="flex flex-row h-full relative overflow-hidden m-2 mt-0 pb-safe pl-safe pr-safe"
        :class="isTauri ? 'pt-[30px]' : 'pt-safe mt-2'"
    >
        <!-- Sidebar Pane (Guild Bar + Chat Sidebar) -->
        <div 
            class="flex flex-row h-full shrink-0 transition-transform duration-300 ease-in-out z-10 w-full md:w-auto pb-2"
            :class="[
                uiStore.sidebarOpen ? 'translate-x-0' : 'translate-x-[-100%] md:translate-x-0',
                'fixed top-0 left-0 md:relative',
                !uiStore.sidebarOpen && 'pointer-events-none md:pointer-events-auto',
                isTauri ? '' : 'top-safe'
            ]"
        >
            <!-- Servers Sidebar (Guild Bar) -->
            <aside class="rounded-lg flex flex-col items-center p-2 gap-2 shrink-0 overflow-y-auto overflow-x-hidden bg-sidebar">
                <!-- Home Button -->
                <UiButton 
                    class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 flex items-center justify-center shrink-0 relative group" 
                    :class="isLinkActive('/chat') ? 'rounded-[16px]' : ''"
                    :variant="isLinkActive('/chat') ? 'default' : 'secondary'"
                    as-child
                    @click="() => { uiStore.memberListVisible = false; }"
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
                    @click="() => { uiStore.memberListVisible = false; }"
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
                    @click="() => { uiStore.memberListVisible = false; }"
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
                        v-long-press="() => { if (uiStore.hapticFeedbackEnabled) trigger('medium'); uiStore.openRoomContextMenu(server.roomId); }"
                        variant="ghost"
                        class="h-12 w-12 rounded-[24px] hover:rounded-[16px] transition-all p-0 group shrink-0 relative"
                        :class="{ 'rounded-[16px]': isLinkActive(`/chat/spaces/${server.roomId}`) }"
                        as-child
                        @click="() => { uiStore.memberListVisible = false; }"
                        @contextmenu.capture="uiStore.openRoomContextMenu(server.roomId)"
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
                    title="Create a space"
                    @click="uiStore.openCreateSpaceModal()"
                >
                    <Icon name="solar:add-circle-linear" class="h-6 w-6" />
                </UiButton>
            </aside>

            <!-- Sidebar -->
            <ChatSidebar ref="sidebarRef" class="min-w-0 flex-1"/>
        </div>

        <!-- Main Content -->
        <main 
            class="flex-1 flex-col min-w-0 min-h-0 md:ml-0 mb-2 transition-transform duration-300 ease-in-out z-20"
            :class="[
                uiStore.sidebarOpen ? 'translate-x-full md:translate-x-0' : (uiStore.memberListVisible ? '-translate-x-full md:translate-x-0' : 'translate-x-0')
            ]"
        >
            <!-- Lighter background for the main chat area to contrast with the root background -->
            <div class="rounded-lg h-full bg-sidebar md:bg-card min-w-0 flex flex-col min-h-0 overflow-hidden relative">
                <!-- Mobile Overlays to close sidebars -->
                <div 
                    v-if="uiStore.sidebarOpen"
                    class="md:hidden absolute inset-0 z-50 bg-black/20"
                    @click="uiStore.toggleSidebar(false)"
                />
                <div 
                    v-if="uiStore.memberListVisible"
                    class="md:hidden absolute inset-0 z-50 bg-black/20"
                    @click="uiStore.toggleMemberList()"
                />

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
                uiStore.memberListVisible ? 'translate-x-0 md:w-60' : 'translate-x-full md:translate-x-0 md:w-0',
                'fixed top-0 left-0 md:left-auto md:right-0 md:relative',
                !uiStore.memberListVisible && 'pointer-events-none',
                isTauri ? '' : 'top-safe'
            ]"
        >
            <RoomMemberList :room="(currentRoom as any)" class="h-full w-full md:w-60 bg-sidebar shrink-0" />
        </div>
    </div>
    <VerificationModal />
    <GlobalSearchModal :friends="friends" :rooms="rooms" />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useNuxtApp } from '#app';
import { useMatrixStore } from '~/stores/matrix';
import { useUIStore } from '~/stores/ui';
import { useGameActivity } from '~/composables/useGameActivity';
import type { Room, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { ClientEvent, RoomEvent, EventType } from 'matrix-js-sdk';
import { PushProcessor } from 'matrix-js-sdk/lib/pushprocessor';
import { VueDraggable as draggable } from 'vue-draggable-plus';
import { useWebHaptics } from 'web-haptics/vue';
import { useServices } from '~/composables/useServices';
import { notify } from '../utils/notify';

definePageMeta({
    middleware: "auth",
});

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
const uiStore = useUIStore();
const { matrixService } = useServices();
const presenceStore = usePresenceStore();
const { trigger } = useWebHaptics({
    debug: uiStore.hapticsDebugEnabled
});
const { $isTauri: isTauri } = useNuxtApp();
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
        const order = uiStore.uiOrder.rootSpaces;
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

  if (isTauri) {
    // Native desktop notifications are handled by MatrixStore -> useMatrixNotifications
    return;
  }

  // Web fallback notifications
  // Prevent history spam by only notifying when the client is fully synced
  // and we are NOT in the middle of a large initial sync.
  const syncState = store.client.getSyncState();
  if (syncState !== 'SYNCING') return;

  // Crucial: Matrix SDK will emit "Timeline" events for old messages during the initial sync.
  // We check if the event's timestamp is within the last 5 seconds to ensure it's "live".
  const age = Date.now() - event.getTs();
  if (age > 5000) return;

  // Only notify for actual messages or custom game events
  const type = event.getType();
  const isMessage = type === EventType.RoomMessage || type === 'm.room.encrypted';
  const isGameEvent = type === 'cc.jackg.ruby.game.state' || type === 'cc.jackg.ruby.game.action';
  
  if (!isMessage && !isGameEvent) return;
  
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
      // Don't notify if the user is currently in this room and the window is focused
      if (roomId.value === room.roomId && document.visibilityState === 'visible') {
        console.log('[Chat] Skipping notification as room is currently active and focused.');
        return;
      }

      const content = event.getClearContent() || event.getContent();
      const senderId = event.getSender();
      if (!senderId) return;
      const senderMember = room.getMember(senderId);
      const senderName = senderMember?.name || senderId;

      // Determine if it is a private DM
      const isDirect = room.getMember(store.client.getUserId()!)?.events.member?.getContent().is_direct ||
                       room.currentState.getStateEvents('m.room.member', store.client.getUserId()!)?.getContent().is_direct;
      
      const isDM = room.getInvitedAndJoinedMemberCount() === 2 && isDirect;

      let title = (isDM ? senderName : `${senderName} in ${room.name || 'Room'}`) || 'New Message';
      let notificationBody = 'New message';
      let imageUrl: string | undefined;

      if (!store.showContentInNotifications) {
          title = 'New Message';
          notificationBody = 'Tap to read';
      } else {
          // Content display is enabled
          if (event.getType() === 'm.room.encrypted' && !event.getClearContent()) {
              notificationBody = 'New encrypted message';
          } else {
              if (content.msgtype === 'm.image') {
                notificationBody = `Sent an image: ${content.body || 'filename'}`;
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
                    imageUrl = store.client.mxcUrlToHttp(mxcUrl) || undefined;
                  }
                }
              } else if (content.msgtype === 'm.video') notificationBody = 'Sent a video';
              else if (content.msgtype === 'm.file') notificationBody = `Sent a file: ${content.body}`;
              else if (type === 'cc.jackg.ruby.game.state') notificationBody = 'Game state updated';
              else if (type === 'cc.jackg.ruby.game.action') notificationBody = 'New game action';
              else if (content.body) notificationBody = content.body;
          }
      }

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

      notify(title, notificationBody, iconUrl || undefined, room.roomId, imageUrl, event.getId());
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
        uiStore.openGlobalSearchModal();
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
  () => store.client as MatrixClient | null,
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
