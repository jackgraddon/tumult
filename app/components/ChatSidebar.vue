<template>
    <aside class="flex h-full flex-col w-[250px] shrink-0">
        <header class="h-16 flex items-center px-4 justify-between">
            <h2 class="text-lg font-semibold flex items-center gap-2">
                <Icon name="solar:chat-round-dots-bold" class="h-5 w-5" />
                {{ routeName.length > 0 ? routeName : 'Tumult' }}
            </h2>
            <UiButton variant="ghost" size="icon"> 
                <!-- TODO: Space Settings -->
                <Icon name="solar:settings-minimalistic-bold-duotone"/>
            </UiButton>
        </header>
        <nav class="grow flex-1 flex flex-col p-2 gap-2 overflow-y-auto">
            <div class="flex flex-col gap-2 flex-1">
                <!-- Sidebar Home actions -->
                <template v-if="isLinkActive('/chat')">
                    <UiButton variant="default" @click="store.openGlobalSearchModal()" class="w-full">
                        <Icon name="solar:add-circle-line-duotone" class="h-4 w-4" />
                        Find or start a chat
                    </UiButton>

                    <!-- Invitations Section -->
                    <div v-if="store.invites.length > 0" class="mt-4 flex flex-col gap-2">
                        <div class="px-2 mb-1">
                            <span class="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Invitations ({{ store.invites.length }})</span>
                        </div>
                        <div 
                            v-for="invite in store.invites" 
                            :key="invite.roomId"
                            role="button"
                            class="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors group"
                            @click="navigateToInvite(invite)"
                        >
                            <MatrixAvatar
                                :mxc-url="invite.getMxcAvatarUrl()"
                                :name="invite.name"
                                class="h-8 w-8 shrink-0 border shadow-sm"
                                :size="64"
                            />
                            <div class="flex flex-col min-w-0">
                                <span class="text-sm font-semibold truncate">{{ invite.name }}</span>
                                <span class="text-[10px] text-muted-foreground truncate">Invited by {{ invite.getMember(invite.getDMInviter()!)?.name || invite.getDMInviter() }}</span>
                            </div>
                        </div>
                    </div>
                </template>

                <!-- Sidebar DM List -->
                <template v-if="isLinkActive('/chat/dms')">
                    <!-- Skeleton Loader for Background Sync -->
                    <div v-if="!store.isFullySynced && friends.length === 0" class="flex flex-col gap-2">
                        <div v-for="i in 5" :key="i" class="flex items-center gap-2 px-2 h-9 w-full rounded-md animate-pulse bg-accent/20">
                            <div class="h-6 w-6 rounded-full bg-accent/30 shrink-0"></div>
                            <div class="h-4 bg-accent/30 rounded w-24"></div>
                        </div>
                    </div>
                    
                    <div style="content-visibility: auto; contain-intrinsic-size: 0 400px;">
                        <div 
                            v-for="friend in friends"
                        :key="friend.roomId"
                        role="button"
                        class="inline-flex items-center justify-start px-2 h-9 w-full rounded-md text-sm font-medium transition-colors cursor-pointer hover:bg-accent/50 group relative"
                        :class="[(isLinkActive(`/chat/dms/${friend.roomId}`) || voiceStore.activeRoomId === friend.roomId) ? 'bg-secondary text-secondary-foreground' : '']"
                        @click="isVoiceChannel(store.client?.getRoom(friend.roomId)) ? voiceStore.joinVoiceRoom(store.client!.getRoom(friend.roomId)!) : (isLinkActive(`/chat/dms/${friend.roomId}`) ? null : navigateTo(`/chat/dms/${friend.roomId}`))"
                    >
                        <MatrixAvatar
                            :mxc-url="friend.avatarUrl"
                            :name="friend.name"
                            class="h-6 w-6 mr-1"
                            :size="64"
                        />
                        <span class="truncate">{{ friend.name }}</span>
                        
                        <div class="ml-auto flex items-center gap-1">
                            <!-- If it's a voice DM, add a button to open text chat -->
                            <NuxtLink v-if="isVoiceChannel(store.client?.getRoom(friend.roomId))" :to="`/chat/dms/${friend.roomId}`" @click.stop>
                                <UiButton variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0">
                                    <Icon name="solar:chat-line-linear" class="h-4 w-4" />
                                </UiButton>
                            </NuxtLink>

                            <div v-if="friend.dmUserId?.startsWith('@discord_')" class="rounded-full w-[20px] h-[20px] flex items-center justify-center shrink-0" style="background-color: #5865F2;">
                                <Icon name="simple-icons:discord" class="text-white" style="width: 12px; height: 12px;"/>
                            </div>

                            <div v-if="friend.unreadCount > 0" class="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                {{ friend.unreadCount }}
                            </div>
                        </div>
                    </div>
                </div>
                </template>

                <!-- Sidebar Room List -->
                <template v-if="isLinkActive('/chat/rooms')">
                    <!-- Skeleton Loader for Background Sync -->
                    <div v-if="!store.isFullySynced && rooms.length === 0" class="flex flex-col gap-2">
                        <div v-for="i in 5" :key="i" class="flex items-center gap-2 px-2 h-9 w-full rounded-md animate-pulse bg-accent/20">
                            <div class="h-6 w-6 rounded-full bg-accent/30 shrink-0"></div>
                            <div class="h-4 bg-accent/30 rounded w-32"></div>
                        </div>
                    </div>
                    
                    <div style="content-visibility: auto; contain-intrinsic-size: 0 400px;">
                        <div 
                            v-for="room in rooms"
                        :key="room.roomId"
                        role="button"
                        class="inline-flex items-center justify-start px-2 h-9 w-full rounded-md text-sm font-medium transition-colors cursor-pointer hover:bg-accent/50 group relative"
                        :class="[(isLinkActive(`/chat/rooms/${room.roomId}`) || voiceStore.activeRoomId === room.roomId) ? 'bg-secondary text-secondary-foreground' : '']"
                        @click="isVoiceChannel(store.client?.getRoom(room.roomId)) ? voiceStore.joinVoiceRoom(store.client!.getRoom(room.roomId)!) : (isLinkActive(`/chat/rooms/${room.roomId}`) ? null : navigateTo(`/chat/rooms/${room.roomId}`))"
                    >
                        <MatrixAvatar
                            :mxc-url="room.avatarUrl"
                            :name="room.name"
                            class="h-6 w-6 mr-1"
                            :size="64"
                        />
                        <span class="truncate">{{ room.name }}</span>

                        <div class="ml-auto flex items-center gap-1">
                            <!-- If it's a voice room, add a button to open text chat -->
                            <NuxtLink v-if="isVoiceChannel(store.client?.getRoom(room.roomId))" :to="`/chat/rooms/${room.roomId}`" @click.stop>
                                <UiButton variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0">
                                    <Icon name="solar:chat-line-linear" class="h-4 w-4" />
                                </UiButton>
                            </NuxtLink>

                            <div v-if="room.unreadCount > 0" class="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                                {{ room.unreadCount }}
                            </div>
                        </div>
                    </div>
                </div>
                </template>

                <!-- Sidebar Settings Nav -->
                <template v-if="isLinkActive('/chat/settings')">
                    <div v-for="group in settingsGroups" :key="group.id" class="flex flex-col gap-1 mb-4">
                        <div class="px-2 mb-1">
                            <span class="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">{{ group.name }}</span>
                        </div>
                        <div 
                            v-for="page in group.pages"
                            :key="page.path"
                            role="button"
                            class="inline-flex items-center justify-start px-2 h-9 w-full rounded-md text-sm font-medium transition-colors cursor-pointer hover:bg-accent/50"
                            :class="[(page.path === '/chat/settings' ? route.path === '/chat/settings' : isLinkActive(page.path)) ? 'bg-secondary text-secondary-foreground' : '']"
                            @click="(page.path === '/chat/settings' ? route.path === '/chat/settings' : isLinkActive(page.path)) ? null : navigateTo(page.path)"
                        >
                            <Icon :name="page.icon" class="h-4 w-4 mr-2 text-muted-foreground" />
                            <span class="truncate">{{ page.label }}</span>
                        </div>
                    </div>
                </template>

                <!-- Sidebar Space Categories List -->
                <template v-if="isLinkActive('/chat/spaces') && activeSpaceId">
                    <!-- Return to Lobby Button -->
                    <UiButton 
                        :variant="isLobby ? 'default' : 'secondary'" 
                        @click="navigateTo(`/chat/spaces/${activeSpaceId}`)" 
                        class="w-full mb-2 justify-start gap-2"
                    >
                        <Icon name="solar:home-2-bold" class="h-4 w-4" />
                        Space Lobby
                    </UiButton>

                    <!-- Skeleton Loader for Background Sync -->
                    <div v-if="!store.isFullySynced && draggableCategories.length === 0" class="flex flex-col gap-4">
                        <div v-for="i in 3" :key="i" class="flex flex-col gap-2 px-2">
                            <div class="h-3 bg-accent/20 rounded w-16 mb-2"></div>
                            <div v-for="j in 3" :key="j" class="flex items-center gap-2 h-8 w-full rounded-md bg-accent/10">
                                <div class="h-5 w-5 rounded bg-accent/20 ml-2 shrink-0"></div>
                                <div class="h-3 bg-accent/20 rounded w-20"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Edit Mode: Compact draggable category pills -->
                    <template v-if="isCategoryEditMode">
                        <div class="flex items-center justify-between px-2 mb-2">
                            <span class="text-xs font-bold uppercase text-muted-foreground">Reorder Categories</span>
                            <UiButton variant="ghost" size="icon" class="h-6 w-6" @click="isCategoryEditMode = false">
                                <Icon name="solar:check-circle-bold" class="h-4 w-4 text-green-500" />
                            </UiButton>
                        </div>
                        <draggable v-model="draggableCategories" :animation="200" ghost-class="opacity-30" :force-fallback="true" :fallback-on-body="true" class="flex flex-col gap-1" chosen-class="drag-chosen">
                            <div 
                                v-for="category in draggableCategories" 
                                :key="category.id"
                                class="flex items-center gap-2 px-2 py-2 rounded-md bg-secondary/50 hover:bg-secondary cursor-grab active:cursor-grabbing transition-colors"
                            >
                                <Icon name="solar:hamburger-menu-linear" class="h-4 w-4 text-muted-foreground shrink-0" />
                                <MatrixAvatar
                                    v-if="category.avatarUrl"
                                    :mxc-url="category.avatarUrl"
                                    :name="category.name"
                                    class="h-5 w-5 shrink-0"
                                    :size="32"
                                />
                                <span class="text-sm font-medium truncate">{{ category.name }}</span>
                                <span class="ml-auto text-xs text-muted-foreground shrink-0">{{ category.rooms.length }}</span>
                            </div>
                        </draggable>
                    </template>

                    <!-- Normal Mode: Full category rendering -->
                    <template v-else>
                        <div class="flex items-center justify-between px-2 mb-2">
                            <span class="text-xs font-bold uppercase text-muted-foreground">Categories</span>
                            <UiButton variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground/50 hover:text-foreground transition-colors" @click="isCategoryEditMode = true" title="Reorder categories">
                                <Icon name="solar:sort-vertical-bold" class="h-3.5 w-3.5" />
                            </UiButton>
                        </div>
                        <ChatSidebarCategory 
                            v-for="category in draggableCategories"
                            :key="category.id"
                            :category="category"
                            :active-space-id="activeSpaceId"
                            :is-link-active="isLinkActive"
                            :depth="0"
                            :collapsed-categories="collapsedCategories"
                            @toggle-category="toggleCategory"
                        />
                    </template>
                </template>
            </div>
        </nav>

        <footer class="p-2 h-fit w-full flex flex-col gap-2 cursor-pointer overflow-hidden">
            <!-- Active Call Bar -->
            <div v-if="voiceStore.activeRoomId" class="p-2 bg-green-500/10 rounded-md flex items-center justify-between gap-2 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-2">
                <div class="flex flex-col min-w-0">
                    <span class="text-[10px] font-bold text-green-500 uppercase tracking-wider">Active Call</span>
                    <!-- Use a safe getter or fallback name -->
                    <span class="text-xs font-semibold truncate">{{ store.client?.getRoom(voiceStore.activeRoomId)?.name || 'Voice Room' }}</span>
                </div>
                <UiButton 
                    variant="destructive" 
                    size="icon" 
                    class="h-7 w-7 shrink-0 shadow-sm"
                    @click="voiceStore.leaveVoiceRoom()"
                    title="Disconnect from call"
                >
                    <Icon name="solar:end-call-bold" class="h-4 w-4" />
                </UiButton>
            </div>

            <!-- Profile & Settings Row -->
            <div class="flex items-center justify-between gap-2 w-full p-2">
                <UserProfile :user="store.user" class="min-w-0 flex-1" />
                <UiButton variant="ghost" size="icon-sm" class="shrink-0" @click="navigateTo('/chat/settings')">
                    <Icon name="solar:settings-linear" class="h-5 w-5" />
                </UiButton>
            </div>
        </footer>
    </aside>
</template>

<script setup lang="ts">
import { Room, EventType, NotificationCountType } from 'matrix-js-sdk';
import { VueDraggable as draggable } from 'vue-draggable-plus';
import MatrixAvatar from '~/components/MatrixAvatar.vue';
import ChatSidebarCategory from '~/components/ChatSidebarCategory.vue';
import { isVoiceChannel } from '~/utils/room';
import { useMatrixStore } from '~/stores/matrix';
import { useVoiceStore } from '~/stores/voice';

const route = useRoute();
const router = useRouter();

const isLinkActive = (to: string) => {
    if (to === "/chat") return route.path === "/chat";
    return route.path.startsWith(to);
};


const settingsGroups = computed(() => {
    const categoryNames: Record<string, string> = {
        user: 'User Settings',
        app: 'App Settings',
        advanced: 'Advanced Settings'
    };
    const categoryOrder = ['user', 'app', 'advanced'];

    const seen = new Set<string>();
    const pages = router.getRoutes()
        .filter(r => r.path === '/chat/settings' || /^\/chat\/settings\/[^/]+$/.test(r.path))
        .filter(r => {
            const normalized = r.path.replace(/\/$/, '');
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        })
        .map(r => {
            const segment = r.path.split('/').pop() || '';
            const isIndex = r.path === '/chat/settings';
            return {
                path: r.path,
                label: (r.meta.title as string) || (isIndex ? 'General' : segment.charAt(0).toUpperCase() + segment.slice(1)),
                icon: (r.meta.icon as string) || 'solar:settings-linear',
                category: (r.meta.category as string) || 'app',
                place: (r.meta.place as number) || 99
            };
        });

    const groupsMap: Record<string, typeof pages> = {};
    pages.forEach(p => {
        if (!groupsMap[p.category]) groupsMap[p.category] = [];
        groupsMap[p.category].push(p);
    });

    return categoryOrder
        .filter(cat => groupsMap[cat])
        .map(cat => ({
            id: cat,
            name: categoryNames[cat] || cat,
            pages: groupsMap[cat!].sort((a, b) => a.place - b.place)
        }));
});

const store = useMatrixStore();
const voiceStore = useVoiceStore();

const isLobby = computed(() => {
    const segments = route.path.split('/').filter(Boolean);
    return segments.length === 3 && segments[1] === 'spaces';
});

const routeName = computed(() => {
    if (isLinkActive('/chat/dms')) return 'Direct Messages';
    if (isLinkActive('/chat/rooms')) return 'Rooms';
    if (isLinkActive('/chat/settings')) return 'Settings';
    if (isLinkActive('/chat/spaces') && activeSpaceId.value) {
        const space = store.client?.getRoom(activeSpaceId.value);
        return space?.name || activeSpaceId.value;
    }
    return '';
});

// Reactive state for the UI
interface MappedRoom {
  roomId: string;
  name: string;
  lastMessage: string;
  lastActive: number;
  avatarUrl?: string | null;
  unreadCount: number;
  dmUserId?: string;
}

interface SpaceCategory {
  id: string;
  name: string;
  avatarUrl?: string | null;
  rooms: MappedRoom[];
  children?: SpaceCategory[];
}

const mapRoom = (room: Room): MappedRoom => {
  const lastEvent = room.timeline.length > 0 
    ? room.timeline[room.timeline.length - 1] 
    : null;

  return {
    roomId: room.roomId,
    name: room.name || 'Unnamed Room',
    lastMessage: lastEvent ? lastEvent.getContent().body : 'No messages',
    lastActive: lastEvent?.getTs() ?? room.getLastActiveTimestamp() ?? 0,
    avatarUrl: room.getMxcAvatarUrl(),
    unreadCount: room.getUnreadNotificationCount(store.unreadCountType) ?? 0,
  };
};

const isEmptyRoom = (room: Room): boolean => {
  if (room.getMyMembership() === 'invite') return false;
  // If lazy loading is on, getJoinedMembers() might return 0 if members aren't fetched yet.
  // Instead, use getJoinedMemberCount() which is often more accurate/immediate from the sync state.
  return (room.getJoinedMemberCount?.() ?? room.getJoinedMembers().length) <= 1;
};

const friends = computed(() => {
  if (!store.client) return [];
  // Register dependency on activeVoiceCall and unreadTrigger for updates
  voiceStore.activeRoomId;
  store.unreadTrigger;
  
  const { directMessages } = store.hierarchy;
  const directEvent = store.client.getAccountData(EventType.Direct);
  const directContent: Record<string, string[]> = directEvent ? directEvent.getContent() as Record<string, string[]> : {};

  // Filter out empty rooms unless the setting is enabled
  const filteredDMs = store.ui.showEmptyRooms
    ? directMessages
    : directMessages.filter(room => !isEmptyRoom(room));

  return filteredDMs.map(room => {
    const mapped = mapRoom(room);
    
    // Robustly find the DM partner's user ID
    // 1. Try account data (m.direct)
    let dmUserId = Object.entries(directContent)
      .find(([, ids]) => ids.includes(room.roomId))?.[0];
      
    // 2. Fallback: find the first member that isn't us
    if (!dmUserId && store.client) {
        const myUserId = store.client.getUserId();
        const otherMember = room.getJoinedMembers().find(m => m.userId !== myUserId);
        dmUserId = otherMember?.userId;
    }

    let avatarUrl = mapped.avatarUrl;
    if (store.client && dmUserId) {
        const user = store.client.getUser(dmUserId);
        if (user?.avatarUrl) {
            avatarUrl = user.avatarUrl;
        }
    }

    return { ...mapped, dmUserId: dmUserId || '', avatarUrl };
  }).sort((a, b) => b.lastActive - a.lastActive);
});

const rooms = computed(() => {
  if (!store.client) return [];
  // Register dependency on activeVoiceCall and unreadTrigger for updates
  voiceStore.activeRoomId;
  store.unreadTrigger;
  
  const { orphanRooms } = store.hierarchy;
  // Filter out empty rooms unless the setting is enabled
  const filtered = store.ui.showEmptyRooms
    ? orphanRooms
    : orphanRooms.filter(room => !isEmptyRoom(room));
  return filtered.map(mapRoom).sort((a, b) => b.lastActive - a.lastActive);
});

const activeSpaceId = computed(() => {
  if (!route.params.id) return null;
  return Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
});

// Trigger space hierarchy fetching when a space becomes active
watch(activeSpaceId, (newSpaceId) => {
  if (newSpaceId && isLinkActive('/chat/spaces')) {
    store.fetchSpaceHierarchy(newSpaceId);
  }
}, { immediate: true });

const collapsedCategories = computed(() => new Set(store.ui.collapsedCategories));

const isCategoryEditMode = ref(false);

const navigateToInvite = (room: Room) => {
  const myUserId = store.client?.getUserId();
  const myMember = room.getMember(myUserId!);
  const isDirect = myMember?.events.member?.getContent().is_direct;
  const path = isDirect ? `/chat/dms/${room.roomId}` : `/chat/rooms/${room.roomId}`;
  navigateTo(path);
};

const toggleCategory = (categoryId: string) => {
  store.toggleUICategory(categoryId);
};

const isCategoryCollapsed = (categoryId: string) => collapsedCategories.value.has(categoryId);

const buildSpaceHierarchy = (spaceId: string, visited: Set<string> = new Set()): SpaceCategory | null => {
  if (visited.has(spaceId)) return null;
  visited.add(spaceId);

  const space = store.client!.getRoom(spaceId);
  if (!space) return null;

  const directRooms: Room[] = [];
  const subSpaces: Room[] = [];

  const childEvents = space.currentState.getStateEvents('m.space.child');
  childEvents.forEach(event => {
    const content = event.getContent();
    if (content && Array.isArray(content.via) && content.via.length > 0) {
      const roomId = event.getStateKey() as string;
      const room = store.client!.getRoom(roomId);
      if (room) {
        // Filter out empty rooms unless the setting is enabled
        if (room.isSpaceRoom()) {
          subSpaces.push(room);
        } else if (store.ui.showEmptyRooms || !isEmptyRoom(room) || isVoiceChannel(room)) {
          // Always show voice channels in spaces to avoid hiding active calls
          directRooms.push(room);
        }
      } else {
        // If room is not joined or not in memory, we might still want a placeholder
        // but for now we rely on fetchSpaceHierarchy to eventually discover them
      }
    }
  });

  const children: SpaceCategory[] = subSpaces
    .map(ss => buildSpaceHierarchy(ss.roomId, visited))
    .filter((c): c is SpaceCategory => c !== null);

  return {
    id: spaceId,
    name: space.name,
    avatarUrl: space.getMxcAvatarUrl(),
    rooms: directRooms.map(mapRoom).sort((a, b) => b.lastActive - a.lastActive),
    children
  };
};

const spaceCategories = computed(() => {
  // Access hierarchy for reactivity trigger
  store.hierarchy;
  // Register dependency on activeVoiceCall and unreadTrigger for updates
  voiceStore.activeRoomId;
  store.unreadTrigger;
  
  if (!store.client || !activeSpaceId.value) return [];
  
  const rootHierarchy = buildSpaceHierarchy(activeSpaceId.value);
  if (!rootHierarchy) return [];

  const categories: SpaceCategory[] = [];
  
  // Add "Rooms" category for direct rooms of the root space
  if (rootHierarchy.rooms.length > 0) {
    categories.push({
      id: 'rooms-' + activeSpaceId.value,
      name: 'Rooms',
      rooms: rootHierarchy.rooms
    });
  }

  // Add sub-categories
  if (rootHierarchy.children) {
    categories.push(...rootHierarchy.children);
  }

  console.log(`[ChatSidebar] Built hierarchy for space ${activeSpaceId.value}`);
  return categories;
});

const draggableCategories = computed({
    get: () => {
        const order = activeSpaceId.value ? store.ui.uiOrder.categories[activeSpaceId.value] : [];
        if (!order || order.length === 0) return spaceCategories.value;
        
        return [...spaceCategories.value].sort((a, b) => {
            const indexA = order.indexOf(a.id);
            const indexB = order.indexOf(b.id);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0;
        });
    },
    set: (val) => {
        if (activeSpaceId.value) {
            store.updateCategoryOrder(activeSpaceId.value, val.map(c => c.id));
        }
    }
});



defineExpose({
    friends,
    rooms,
    spaceCategories
});
</script>
