<template>
    <aside class="flex h-full flex-col w-full md:w-[250px] shrink-0 overflow-hidden">
        <header v-if="!musicStore.isExpanded" class="flex items-center h-12 p-2 justify-between">
            <div class="flex items-center gap-2 overflow-hidden">
                <UiButton 
                    variant="ghost" 
                    size="icon" 
                    class="md:hidden" 
                    @click="uiStore.toggleSidebar(false)"
                >
                    <Icon name="solar:close-circle-linear" />
                </UiButton>
                <Icon name="solar:chat-round-dots-bold" />
                <h2 class="text-lg font-semibold truncate">
                    {{ routeName.length > 0 ? routeName : 'Tumult' }}
                </h2>
            </div>
            <UiButton 
                v-if="activeSpaceId && isLinkActive('/chat/spaces')"
                variant="ghost" 
                size="icon-sm" 
                title="Space Settings"
                @click="uiStore.openSpaceSettingsModal(activeSpaceId)"
            > 
                <Icon name="solar:settings-minimalistic-bold-duotone"/>
            </UiButton>
        </header>
        <nav v-if="!musicStore.isExpanded" class="grow flex-1 flex flex-col p-2 gap-2 overflow-y-auto">
            <div class="flex flex-col gap-2 flex-1">
                <!-- Sidebar Home actions -->
                <template v-if="isLinkActive('/chat')">
                    <div class="flex flex-col gap-2">
                        <UiButton variant="default" class="w-full" @click="uiStore.openGlobalSearchModal()">
                            <Icon name="solar:add-circle-line-duotone" class="h-4 w-4" />
                            Find or start a chat
                        </UiButton>

                        <UiButton
                            v-if="jellyfinStore.isAuthenticated"
                            variant="secondary"
                            @click="() => { navigateTo('/chat/music'); uiStore.toggleSidebar(false); }"
                        >
                            <Icon name="solar:music-note-bold-duotone" />
                            Music Library
                        </UiButton>
                    </div>

                    <!-- Invitations Section -->
                    <div v-if="matrixStore.invites.length > 0" class="mt-4 flex flex-col gap-2">
                        <div class="px-2 mb-1">
                            <span class="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Invitations ({{ matrixStore.invites.length }})</span>
                        </div>
                        <div 
                            v-for="invite in matrixStore.invites"
                            :key="invite.roomId"
                            role="button"
                            class="flex items-center gap-2 px-2 py-2.5 rounded-md hover:bg-muted cursor-pointer transition-colors group"
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
                    <div v-if="!matrixStore.isFullySynced && friends.length === 0" class="flex flex-col gap-2">
                        <div v-for="i in 5" :key="i" class="flex items-center gap-2 px-2 h-9 w-full rounded-md animate-pulse bg-accent/20">
                            <div class="h-6 w-6 rounded-full bg-accent/30 shrink-0"/>
                            <div class="h-4 bg-accent/30 rounded w-24"/>
                        </div>
                    </div>
                    
                    <div class="flex flex-col gap-0.5">
                        <UiButton
                            v-for="friend in friends" :key="friend.roomId"
                            v-long-press="() => { if (uiStore.hapticFeedbackEnabled) trigger('medium'); uiStore.openRoomContextMenu(friend.roomId); }"
                            :variant="(isLinkActive(`/chat/dms/${friend.roomId}`) || voiceStore.activeRoomId === friend.roomId) ? 'secondary' : 'ghost'"
                            class="justify-start px-2 h-10 w-full group relative"
                            as-child
                            @contextmenu.capture="uiStore.openRoomContextMenu(friend.roomId)"
                        >
                            <NuxtLink
                                :to="`/chat/dms/${friend.roomId}`"
                                @click="(e) => handleRoomClick(e, friend.roomId)"
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
                                    <NuxtLink v-if="isVoiceChannel(matrixStore.client?.getRoom(friend.roomId))" :to="`/chat/dms/${friend.roomId}`" @click.stop>
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
                            </NuxtLink>
                        </UiButton>
                    </div>
                </template>

                <!-- Sidebar Room List -->
                <template v-if="isLinkActive('/chat/rooms')">
                    <!-- Skeleton Loader for Background Sync -->
                    <div v-if="!matrixStore.isFullySynced && rooms.length === 0" class="flex flex-col gap-2">
                        <div v-for="i in 5" :key="i" class="flex items-center gap-2 px-2 h-9 w-full rounded-md animate-pulse bg-accent/20">
                            <div class="h-6 w-6 rounded-full bg-accent/30 shrink-0"/>
                            <div class="h-4 bg-accent/30 rounded w-32"/>
                        </div>
                    </div>
                    
                    <div class="flex flex-col gap-0.5">
                        <UiButton
                            v-for="room in rooms" :key="room.roomId"
                            v-long-press="() => { if (uiStore.hapticFeedbackEnabled) trigger('medium'); uiStore.openRoomContextMenu(room.roomId); }"
                            :variant="(isLinkActive(`/chat/rooms/${room.roomId}`) || voiceStore.activeRoomId === room.roomId) ? 'secondary' : 'ghost'"
                            class="justify-start px-2 h-10 w-full group relative"
                            as-child
                            @contextmenu.capture="uiStore.openRoomContextMenu(room.roomId)"
                        >
                            <NuxtLink
                                :to="`/chat/rooms/${room.roomId}`"
                                @click="(e) => handleRoomClick(e, room.roomId)"
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
                                    <NuxtLink v-if="isVoiceChannel(matrixStore.client?.getRoom(room.roomId))" :to="`/chat/rooms/${room.roomId}`" @click.stop>
                                        <UiButton variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0">
                                            <Icon name="solar:chat-line-linear" class="h-4 w-4" />
                                        </UiButton>
                                    </NuxtLink>

                                    <div v-if="room.unreadCount > 0" class="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                                        {{ room.unreadCount }}
                                    </div>
                                </div>
                            </NuxtLink>
                        </UiButton>
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
                            class="inline-flex items-center justify-start px-2 h-10 w-full rounded-md text-sm font-medium transition-colors cursor-pointer hover:bg-muted"
                            :class="[(page.path === '/chat/settings' ? route.path === '/chat/settings' : isLinkActive(page.path)) ? 'bg-secondary text-secondary-foreground' : '']"
                            @click="() => {
                                navigateTo(page.path);
                                uiStore.toggleSidebar(false);
                                uiStore.memberListVisible = false;
                            }"
                        >
                            <Icon :name="page.icon" class="h-4 w-4 mr-2 text-muted-foreground" />
                            <span class="truncate">{{ page.label }}</span>
                        </div>
                    </div>
                </template>

                <!-- Sidebar Music Nav -->
                <template v-if="isLinkActive('/chat/music')">
                    <div class="flex items-center gap-2">
                        <UiInput v-model="searchQuery" placeholder="Search music..." class="h-8" @keyup.enter="doSearch" />
                        <UiButton size="icon-sm" @click="doSearch">
                            <Icon name="solar:magnifer-outline" />
                        </UiButton>
                    </div>
                    <div class="flex flex-col gap-1 mb-4">
                        <div class="px-2 mb-1">
                            <span class="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Library</span>
                        </div>
                        <div
                            v-for="item in musicNav"
                            :key="item.path"
                            role="button"
                            class="inline-flex items-center justify-start px-2 h-10 w-full rounded-md text-sm font-medium transition-colors cursor-pointer hover:bg-muted"
                            :class="[route.path === item.path ? 'bg-secondary text-secondary-foreground' : '']"
                            @click="() => { navigateTo(item.path); uiStore.toggleSidebar(false); }"
                        >
                            <Icon :name="item.icon" class="h-4 w-4 mr-2 text-muted-foreground" />
                            <span class="truncate">{{ item.label }}</span>
                        </div>
                    </div>

                    <div v-if="playlists.length > 0" class="flex flex-col gap-1 mb-4">
                        <div class="px-2 mb-1">
                            <span class="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Playlists</span>
                        </div>
                        <div
                            v-for="playlist in playlists"
                            :key="playlist.Id"
                            role="button"
                            class="group inline-flex items-center justify-start px-2 h-10 w-full rounded-md text-sm font-medium transition-colors cursor-pointer hover:bg-muted relative"
                            @click="() => { navigateTo(`/chat/music/playlist/${playlist.Id}`); uiStore.toggleSidebar(false); }"
                        >
                            <Icon name="solar:playlist-minimalistic-bold-duotone" class="h-4 w-4 mr-2 text-muted-foreground shrink-0 group-hover:hidden" />
                            <UiButton
                                variant="ghost"
                                size="icon-sm"
                                class="h-6 w-6 mr-1 p-0 hidden group-hover:flex shrink-0 hover:bg-accent/50 active:scale-95"
                                title="Play Playlist"
                                @click.stop="quickPlayPlaylist(playlist)"
                            >
                                <Icon name="solar:play-bold" class="h-4 w-4 text-[#AA5CC3]" />
                            </UiButton>
                            <span class="truncate flex-1">{{ playlist.Name }}</span>
                        </div>
                    </div>
                </template>

                <!-- Sidebar Space Categories List -->
                <template v-if="isLinkActive('/chat/spaces') && activeSpaceId">
                    <!-- Return to Lobby Button -->
                    <UiButton 
                        :variant="isLobby ? 'default' : 'secondary'" 
                        class="w-full mb-2 justify-start gap-2"
                        @click="() => { navigateTo(`/chat/spaces/${activeSpaceId}`); uiStore.toggleSidebar(false); uiStore.memberListVisible = false; }"
                    >
                        <Icon name="solar:home-2-bold" class="h-4 w-4" />
                        Space Lobby
                    </UiButton>

                    <!-- Skeleton Loader for Background Sync -->
                    <div v-if="!matrixStore.isFullySynced && draggableCategories.length === 0" class="flex flex-col gap-4">
                        <div v-for="i in 3" :key="i" class="flex flex-col gap-2 px-2">
                            <div class="h-3 bg-accent/20 rounded w-16 mb-2"/>
                            <div v-for="j in 3" :key="j" class="flex items-center gap-2 h-8 w-full rounded-md bg-accent/10">
                                <div class="h-5 w-5 rounded bg-accent/20 ml-2 shrink-0"/>
                                <div class="h-3 bg-accent/20 rounded w-20"/>
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
                        <draggable v-model="draggableCategories" :animation="200" ghost-class="opacity-30" :force-fallback="true" class="flex flex-col gap-1" chosen-class="drag-chosen">
                            <div 
                                v-for="category in draggableCategories" 
                                :key="category.id"
                                class="flex items-center gap-2 px-2 py-2.5 rounded-md bg-secondary/50 hover:bg-secondary cursor-grab active:cursor-grabbing transition-colors"
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
                            <UiButton variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground/50 hover:text-foreground transition-colors" title="Reorder categories" @click="isCategoryEditMode = true">
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

        <footer class="p-2 w-full flex flex-col gap-2 cursor-pointer overflow-hidden transition-all duration-300" :class="[musicStore.isExpanded ? 'h-full flex-1' : 'h-fit']">
            <!-- Jellyfin Playbar -->
            <Playbar />

            <!-- Active Call Bar -->
            <div v-if="voiceStore.activeRoomId" class="p-2 bg-green-500/10 rounded-md flex items-center justify-between gap-2 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-2">
                <div class="flex flex-col min-w-0">
                    <span class="text-[10px] font-bold text-green-500 uppercase tracking-wider">Active Call</span>
                    <!-- Use a safe getter or fallback name -->
                    <span class="text-xs font-semibold truncate">{{ matrixStore.client?.getRoom(voiceStore.activeRoomId)?.name || 'Voice Room' }}</span>
                </div>
                <UiButton 
                    variant="destructive" 
                    size="icon" 
                    class="h-7 w-7 shrink-0 shadow-sm"
                    title="Disconnect from call"
                    @click="voiceStore.leaveVoiceRoom()"
                >
                    <Icon name="solar:end-call-bold" class="h-4 w-4" />
                </UiButton>
            </div>

            <!-- Profile & Settings Row -->
            <div class="flex items-center justify-between gap-2 w-full p-2">
                <UserProfile :user="matrixStore.user" class="min-w-0 flex-1" size="full" />
                <UiButton variant="ghost" size="icon-sm" class="shrink-0" @click="navigateTo('/chat/settings')">
                    <Icon name="solar:settings-linear" class="h-5 w-5" />
                </UiButton>
            </div>
        </footer>
    </aside>
</template>

<script setup lang="ts">
import type { Room} from 'matrix-js-sdk';
import { EventType, NotificationCountType } from 'matrix-js-sdk';
import { VueDraggable as draggable } from 'vue-draggable-plus';
import MatrixAvatar from '~/components/MatrixAvatar.vue';
import ChatSidebarCategory from '~/components/ChatSidebarCategory.vue';
import { isVoiceChannel } from '~/utils/room';
import { useMatrixStore } from '~/stores/matrix';
import { useUIStore } from "~/stores/ui";
import { useServices } from "~/composables/useServices";
import { useVoiceStore } from '~/stores/voice';
import { useMusicStore } from '~/stores/music';
import { useJellyfinStore } from '~/stores/jellyfin';
import { useJellyfin } from '~/composables/useJellyfin';
import { useWebHaptics } from 'web-haptics/vue';
import Playbar from '~/components/Playbar.vue';

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
        groupsMap[p.category]?.push(p);
    });

    return categoryOrder
        .filter(cat => groupsMap[cat])
        .map(cat => ({
            id: cat,
            name: categoryNames[cat] || cat,
            pages: groupsMap[cat]?.sort((a, b) => a.place - b.place)
        }));
});

const matrixStore = useMatrixStore();
const uiStore = useUIStore();
const { matrixService, audioService } = useServices();
const { trigger } = useWebHaptics({
    debug: uiStore.hapticsDebugEnabled
});
const voiceStore = useVoiceStore();
const musicStore = useMusicStore();
const jellyfinStore = useJellyfinStore();
const { fetcher: jellyfinFetch } = useJellyfin();

const searchQuery = ref('');

function handleRoomClick(e: MouseEvent, roomId: string) {
    const isMobile = import.meta.client ? window.innerWidth < 768 : false;
    const room = matrixStore.client?.getRoom(roomId);

    if (isVoiceChannel(room) && !isMobile) {
        e.preventDefault();
        voiceStore.joinVoiceRoom(room!);
    }

    uiStore.toggleSidebar(false);
    uiStore.memberListVisible = false;
}

function doSearch() {
  if (!searchQuery.value) return;
  navigateTo(`/chat/music/search?q=${encodeURIComponent(searchQuery.value)}`);
}

const musicNav = [
    { label: 'Home', icon: 'solar:home-2-bold-duotone', path: '/chat/music' },
    { label: 'Favorites', icon: 'solar:heart-bold-duotone', path: '/chat/music/favorites' },
    { label: 'Artists', icon: 'solar:users-group-rounded-bold-duotone', path: '/chat/music/artists' },
    { label: 'Albums', icon: 'solar:album-bold-duotone', path: '/chat/music/albums' },
    { label: 'Songs', icon: 'solar:music-note-bold-duotone', path: '/chat/music/songs' },
];

const playlists = ref<any[]>([]);

async function loadPlaylists() {
    if (!jellyfinStore.isAuthenticated) return;
    try {
        const data = await jellyfinFetch('/Items', {
            method: 'GET',
            query: {
                IncludeItemTypes: ['Playlist'],
                Recursive: true,
                Fields: ['PrimaryImageAspectRatio', 'UserData']
            }
        });
        if (data && typeof data === 'object' && 'Items' in data) {
            playlists.value = (data as any).Items as any[];
        }
    } catch (e) {
        console.error('[Sidebar] Failed to load playlists:', e);
    }
}

async function quickPlayPlaylist(playlist: any) {
    try {
        const data = await jellyfinFetch('/Items', {
            method: 'GET',
            query: {
                ParentId: playlist.Id,
                IncludeItemTypes: ['Audio'],
                Recursive: true,
                Fields: ['ArtistItems', 'PrimaryImageAspectRatio', 'UserData', 'Album']
            }
        });

        if (data && typeof data === 'object' && 'Items' in data && Array.isArray((data as any).Items) && (data as any).Items.length > 0) {
            const songs = (data as any).Items.map((item: any) => {
                const streamUrl = `${jellyfinStore.serverUrl}/Audio/${item.Id}/stream?static=true&api_key=${jellyfinStore.accessToken}`;
                const coverUrl = item.ImageTags?.Primary
                    ? `${jellyfinStore.serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=100&api_key=${jellyfinStore.accessToken}`
                    : undefined;

                return {
                    id: item.Id,
                    title: item.Name,
                    artist: item.ArtistItems?.[0]?.Name || 'Unknown Artist',
                    album: item.Album || undefined,
                    coverUrl,
                    streamUrl
                };
            }).filter(s => !!s.id);

            if (songs.length > 0) {
                const first = songs[0];
                if (first) {
                    audioService.playSong(first);
                    if (songs.length > 1) {
                        musicStore.addToQueue(songs.slice(1));
                    }
                }
            }
        }
    } catch (e) {
        console.error('[Sidebar] Failed to quick play playlist:', e);
    }
}

watch(() => jellyfinStore.isAuthenticated, (isAuth) => {
    if (isAuth) loadPlaylists();
}, { immediate: true });

const isLobby = computed(() => {
    const segments = route.path.split('/').filter(Boolean);
    return segments.length === 3 && segments[1] === 'spaces';
});

const routeName = computed(() => {
    if (isLinkActive('/chat/dms')) return 'Direct Messages';
    if (isLinkActive('/chat/rooms')) return 'Rooms';
    if (isLinkActive('/chat/settings')) return 'Settings';
    if (isLinkActive('/chat/music')) return 'Music';
    if (isLinkActive('/chat/spaces') && activeSpaceId.value) {
        const space = matrixStore.client?.getRoom(activeSpaceId.value);
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

  const count = room.getUnreadNotificationCount(matrixStore.unreadCountType) ?? 0;
  const manual = matrixStore.manualUnread[room.roomId] ? 1 : 0;
  
  return {
    roomId: room.roomId,
    name: room.name || 'Unnamed Room',
    lastMessage: lastEvent ? lastEvent.getContent().body : 'No messages',
    lastActive: lastEvent?.getTs() ?? room.getLastActiveTimestamp() ?? 0,
    avatarUrl: room.getMxcAvatarUrl(),
    unreadCount: Math.max(count, manual),
  };
};

const isEmptyRoom = (room: Room): boolean => {
  if (room.getMyMembership() === 'invite') return false;
  // Use getJoinedMemberCount() to avoid expensive array allocations from getJoinedMembers()
  const count = typeof room.getJoinedMemberCount === 'function'
    ? room.getJoinedMemberCount()
    : room.getJoinedMembers().length;
  return count <= 1;
};

const friends = computed(() => {
  if (!matrixStore.client) return [];
  // Register dependency on activeVoiceCall and unreadTrigger for updates
  voiceStore.activeRoomId;
  matrixStore.unreadTrigger;
  
  const { directMessages } = matrixStore.hierarchy;
  const directEvent = matrixStore.client.getAccountData(EventType.Direct);
  const directContent: Record<string, string[]> = directEvent ? directEvent.getContent() as Record<string, string[]> : {};

  // Performance Optimization: Pre-calculate reverse mapping of roomId -> userId for O(1) lookups.
  // This avoids a nested O(N*M) loop in the subsequent map() call.
  const roomIdToUserId = new Map<string, string>();
  for (const [userId, roomIds] of Object.entries(directContent)) {
    if (Array.isArray(roomIds)) {
      for (const rid of roomIds) {
        roomIdToUserId.set(rid, userId);
      }
    }
  }

  // Filter out empty rooms unless the setting is enabled
  const filteredDMs = uiStore.showEmptyRooms
    ? directMessages
    : directMessages.filter(room => !isEmptyRoom(room));

  const myUserId = matrixStore.client.getUserId();

  return filteredDMs.map(room => {
    const mapped = mapRoom(room);
    
    // Robustly find the DM partner's user ID using the optimized reverse map.
    let dmUserId = roomIdToUserId.get(room.roomId);
      
    // Fallback: find the first member that isn't us
    if (!dmUserId && matrixStore.client) {
        const otherMember = room.getJoinedMembers().find(m => m.userId !== myUserId);
        dmUserId = otherMember?.userId;
    }

    let avatarUrl = mapped.avatarUrl;
    if (matrixStore.client && dmUserId) {
        const user = matrixStore.client.getUser(dmUserId);
        if (user?.avatarUrl) {
            avatarUrl = user.avatarUrl;
        }
    }

    return { ...mapped, dmUserId: dmUserId || '', avatarUrl };
  }).sort((a, b) => b.lastActive - a.lastActive);
});

const rooms = computed(() => {
  if (!matrixStore.client) return [];
  // Register dependency on activeVoiceCall and unreadTrigger for updates
  voiceStore.activeRoomId;
  matrixStore.unreadTrigger;
  
  const { orphanRooms } = matrixStore.hierarchy;
  // Filter out empty rooms unless the setting is enabled
  const filtered = uiStore.showEmptyRooms
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
    matrixService.fetchSpaceHierarchy(newSpaceId);
  }
}, { immediate: true });

const collapsedCategories = computed(() => new Set(uiStore.collapsedCategories));

const isCategoryEditMode = ref(false);

const navigateToInvite = (room: Room) => {
  const myUserId = matrixStore.client?.getUserId();
  const myMember = room.getMember(myUserId!);
  const isDirect = myMember?.events.member?.getContent().is_direct;
  const path = isDirect ? `/chat/dms/${room.roomId}` : `/chat/rooms/${room.roomId}`;
  uiStore.toggleSidebar(false);
  uiStore.memberListVisible = false;
  navigateTo(path);
};

const toggleCategory = (categoryId: string) => {
  uiStore.toggleUICategory(categoryId);
};

const isCategoryCollapsed = (categoryId: string) => collapsedCategories.value.has(categoryId);

const buildSpaceHierarchy = (spaceId: string, visited: Set<string> = new Set()): SpaceCategory | null => {
  if (visited.has(spaceId)) return null;
  visited.add(spaceId);

  const space = matrixStore.client!.getRoom(spaceId);
  if (!space) return null;

  const directRooms: Room[] = [];
  const subSpaces: Room[] = [];

  const childEvents = space.currentState.getStateEvents('m.space.child');
  childEvents.forEach(event => {
    const content = event.getContent();
    if (content && Array.isArray(content.via) && content.via.length > 0) {
      const roomId = event.getStateKey() as string;
      const room = matrixStore.client!.getRoom(roomId);
      if (room) {
        // Filter out empty rooms unless the setting is enabled
        if (room.isSpaceRoom()) {
          subSpaces.push(room);
        } else if (uiStore.showEmptyRooms || !isEmptyRoom(room) || isVoiceChannel(room)) {
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
  matrixStore.hierarchy;
  // Register dependency on activeVoiceCall and unreadTrigger for updates
  voiceStore.activeRoomId;
  matrixStore.unreadTrigger;
  
  if (!matrixStore.client || !activeSpaceId.value) return [];
  
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
        const order = activeSpaceId.value ? uiStore.uiOrder.categories[activeSpaceId.value] : [];
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
            matrixStore.updateCategoryOrder(activeSpaceId.value, val.map(c => c.id));
        }
    }
});



defineExpose({
    friends,
    rooms,
    spaceCategories
});
</script>
