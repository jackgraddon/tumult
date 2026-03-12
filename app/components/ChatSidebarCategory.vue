<template>
    <div class="flex flex-col gap-1" :style="{ paddingLeft: depth > 0 ? '12px' : '0' }">
        <UiContextMenu>
            <UiContextMenuTrigger>
                <button 
                    @click="toggleCategory"
                    class="flex items-center gap-2 px-2 py-1 text-xs font-bold uppercase text-muted-foreground hover:text-foreground transition-colors group w-full"
                >
                    <MatrixAvatar
                        v-if="category.avatarUrl"
                        :mxc-url="category.avatarUrl"
                        :name="category.name"
                        class="h-4 w-4 rounded-sm border-none shrink-0"
                        :size="32"
                    />
                    <Icon 
                        :name="isCollapsed ? 'solar:alt-arrow-right-bold' : 'solar:alt-arrow-down-bold'" 
                        class="h-3 w-3 shrink-0"
                    />
                    <span class="truncate">{{ category.name }}</span>
                    <Icon v-if="store.pinnedSpaces.includes(category.id)" name="solar:pin-bold" class="ml-auto h-3 w-3 text-primary" />
                </button>
            </UiContextMenuTrigger>
            <UiContextMenuContent v-if="!isVirtual">
                <template v-if="!isNativeRoot">
                    <UiContextMenuItem v-if="!isPinned" @click="store.pinSpace(category.id)">
                        <Icon name="solar:pin-bold" class="mr-2 h-4 w-4" />
                        Pin to Sidebar
                    </UiContextMenuItem>
                    <UiContextMenuItem v-else @click="store.unpinSpace(category.id)" class="text-destructive focus:text-destructive">
                        <Icon name="solar:pin-broken-bold" class="mr-2 h-4 w-4" />
                        Unpin from Sidebar
                    </UiContextMenuItem>
                </template>
                <UiContextMenuItem v-else disabled>
                    <Icon name="solar:info-circle-bold" class="mr-2 h-4 w-4" />
                    Root Space
                </UiContextMenuItem>
            </UiContextMenuContent>
        </UiContextMenu>
        
        <div v-show="!isCollapsed" class="flex flex-col gap-1">
            <!-- Nested Categories -->
            <draggable v-model="draggableChildren" :animation="200" ghost-class="opacity-30" :force-fallback="true" :fallback-on-body="true" :delay="150" :delay-on-touch-only="false" chosen-class="drag-chosen">
                    <ChatSidebarCategory 
                        v-for="childCategory in draggableChildren"
                        :key="childCategory.id"
                        :category="childCategory"
                        :active-space-id="activeSpaceId"
                        :is-link-active="isLinkActive"
                        :depth="depth + 1"
                        :collapsed-categories="collapsedCategories"
                        @toggle-category="$emit('toggle-category', $event)"
                    />
            </draggable>

            <!-- Rooms in this category -->
            <draggable v-model="draggableRooms" class="flex flex-col" :animation="200" ghost-class="opacity-30" :force-fallback="true" :fallback-on-body="true" :delay="150" :delay-on-touch-only="false" chosen-class="drag-chosen">
                <div v-for="room in draggableRooms" :key="room.roomId" class="flex flex-col">
                    <!-- Voice Channel (Click to Join) -->
                    <div 
                        v-if="isVoiceChannel(store.client?.getRoom(room.roomId))"
                        role="button"
                        class="inline-flex items-center justify-start px-2 h-9 w-full rounded-md text-sm font-medium transition-colors cursor-pointer hover:bg-accent/50 group relative"
                        :class="[(isLinkActive(`/chat/spaces/${activeSpaceId}/${room.roomId}`) || voiceStore.activeRoomId === room.roomId) ? 'bg-secondary text-secondary-foreground' : '']"
                        @click="voiceStore.joinVoiceRoom(store.client!.getRoom(room.roomId)!)"
                    >
                        <div class="h-6 w-6 mr-1 flex items-center justify-center shrink-0">
                            <Icon name="solar:soundwave-square-bold-duotone" class="h-5 w-5" />
                        </div>
                        <span class="truncate">{{ room.name }}</span>
                        
                        <!-- Voice Active Indicator (Pulse) -->
                        <div v-if="getVoiceParticipants(room.roomId).length > 0" class="ml-2 flex items-center">
                            <Icon name="solar:volume-loud-bold" class="h-3 w-3 text-green-500 animate-pulse" />
                        </div>

                        <div class="ml-auto flex items-center gap-1">
                            <!-- Navigation to Text Chat -->
                            <NuxtLink :to="`/chat/spaces/${activeSpaceId}/${room.roomId}`" @click.stop>
                                <UiButton 
                                    variant="ghost" 
                                    size="icon" 
                                    class="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                                    title="Open text chat"
                                >
                                    <Icon name="solar:chat-line-linear" class="h-4 w-4" />
                                </UiButton>
                            </NuxtLink>

                            <!-- Leave Button -->
                            <UiButton 
                                v-if="voiceStore.activeRoomId === room.roomId"
                                variant="destructive" 
                                size="icon" 
                                class="h-6 w-6 shrink-0 shadow-sm"
                                @click.prevent.stop="voiceStore.leaveVoiceRoom()"
                                title="Leave voice channel"
                            >
                                <Icon name="solar:end-call-bold" class="h-3 w-3" />
                            </UiButton>
                            
                            <div v-if="room.unreadCount > 0" class="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                                {{ room.unreadCount }}
                            </div>
                        </div>
                    </div>

                    <!-- Regular Room (Click to Open Chat) -->
                    <UiButton 
                        v-else
                        :disabled="isLinkActive(`/chat/spaces/${activeSpaceId}/${room.roomId}`)"
                        :variant="isLinkActive(`/chat/spaces/${activeSpaceId}/${room.roomId}`) ? 'secondary' : 'ghost'"
                        class="justify-start px-2 h-9 w-full"
                        as-child
                    >
                        <NuxtLink :to="`/chat/spaces/${activeSpaceId}/${room.roomId}`">
                            <div v-if="!room.avatarUrl" class="h-6 w-6 mr-1 flex items-center justify-center shrink-0">
                                <Icon name="solar:hashtag-square-bold-duotone" class="h-5 w-5" />
                            </div>
                            <MatrixAvatar
                                v-else
                                :mxc-url="room.avatarUrl"
                                :name="room.name"
                                class="h-6 w-6 mr-1"
                                :size="64"
                            />
                            <span class="truncate">
                                {{ room.name.startsWith('#') ? room.name.slice(1) : room.name }}
                            </span>
                            
                            <div class="ml-auto flex items-center gap-1">
                                <div v-if="room.unreadCount > 0" class="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                                    {{ room.unreadCount }}
                                </div>
                            </div>
                        </NuxtLink>
                    </UiButton>

                    <!-- Voice Participants List -->
                    <div 
                        v-if="getVoiceParticipants(room.roomId).length > 0"
                        class="ml-9 flex flex-col gap-0.5 mt-0.5 mb-2"
                    >
                        <div 
                            v-for="user in getVoiceParticipants(room.roomId)" 
                            :key="user.id" 
                            class="flex items-center gap-2 px-1.5 py-0.5 rounded-sm hover:bg-accent/40 transition-colors cursor-default group/participant"
                        >
                            <MatrixAvatar 
                                :mxc-url="user.avatarUrl" 
                                :name="user.name" 
                                class="w-4 h-4 rounded-full shadow-sm" 
                                :size="32"
                            />
                            <span class="text-[11px] font-medium text-muted-foreground group-hover/participant:text-foreground transition-colors truncate">
                                {{ user.name }}
                            </span>
                        </div>
                    </div>
                </div>
            </draggable>
        </div>
    </div>
</template>

<script setup lang="ts">
import { VueDraggable as draggable } from 'vue-draggable-plus';
import MatrixAvatar from '~/components/MatrixAvatar.vue';
import { useMatrixStore } from '~/stores/matrix';
import { useVoiceStore } from '~/stores/voice';
import { isVoiceChannel } from '~/utils/room';

const store = useMatrixStore();
const voiceStore = useVoiceStore();

interface MappedRoom {
  roomId: string;
  name: string;
  lastMessage: string;
  lastActive: number;
  avatarUrl?: string | null;
  unreadCount: number;
}

interface SpaceCategory {
  id: string;
  name: string;
  avatarUrl?: string | null;
  rooms: MappedRoom[];
  children?: SpaceCategory[];
}

const props = defineProps<{
    category: SpaceCategory;
    activeSpaceId: string;
    isLinkActive: (to: string) => boolean;
    depth: number;
    collapsedCategories: Set<string>;
}>();

const emit = defineEmits<{
    (e: 'toggle-category', categoryId: string): void;
}>();

const isCollapsed = computed(() => props.collapsedCategories.has(props.category.id));

const isPinned = computed(() => store.pinnedSpaces.includes(props.category.id));

const isVirtual = computed(() => props.category.id.startsWith('rooms-'));

const isNativeRoot = computed(() => {
    // A space is a native root if it's in the hierarchy rootSpaces 
    // but NOT there because it was pinned.
    return store.hierarchy.rootSpaces.some(s => s.roomId === props.category.id) && !isPinned.value;
});

const toggleCategory = () => {
    emit('toggle-category', props.category.id);
};

const getVoiceParticipants = (roomId: string) => {
    return store.getVoiceParticipants(roomId);
};

const draggableChildren = computed({
    get: () => {
        const children = props.category.children || [];
        const order = store.ui.uiOrder.categories[props.category.id];
        if (!order || order.length === 0) return children;

        return [...children].sort((a, b) => {
            const indexA = order.indexOf(a.id);
            const indexB = order.indexOf(b.id);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0;
        });
    },
    set: (val: SpaceCategory[]) => {
        store.updateCategoryOrder(props.category.id, val.map(c => c.id));
    }
});

const draggableRooms = computed({
    get: () => {
        const rooms = props.category.rooms || [];
        const order = store.ui.uiOrder.rooms[props.category.id];
        if (!order || order.length === 0) return rooms;

        return [...rooms].sort((a, b) => {
            const indexA = order.indexOf(a.roomId);
            const indexB = order.indexOf(b.roomId);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0;
        });
    },
    set: (val: MappedRoom[]) => {
        store.updateRoomOrder(props.category.id, val.map(r => r.roomId));
    }
});
</script>
