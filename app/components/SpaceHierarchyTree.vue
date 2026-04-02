<template>
    <div class="flex flex-col gap-1" :style="{ paddingLeft: depth > 0 ? '16px' : '0' }">
        <div v-if="(depth > 0 && isSpace) || (!isSpace)" class="flex items-center gap-2 py-1">
            <div v-if="isSpace" class="flex-1 min-w-0">
                <button 
                    @click="isCollapsed = !isCollapsed"
                    @contextmenu.capture="store.openRoomContextMenu(roomData.room_id)"
                    class="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground hover:text-foreground transition-colors group w-full mt-2"
                >
                    <MatrixAvatar
                        :mxc-url="roomData.avatar_url"
                        :name="roomData.name || roomData.room_id"
                        class="h-4 w-4 rounded-sm border-none shrink-0"
                        :size="32"
                    />
                    <Icon 
                        :name="isCollapsed ? 'solar:alt-arrow-right-bold' : 'solar:alt-arrow-down-bold'" 
                        class="h-3 w-3 shrink-0"
                    />
                    <span class="truncate text-left">{{ roomData.name || roomData.room_id }}</span>
                </button>
            </div>
            <div v-else class="flex-1 min-w-0">
                <div 
                    class="flex items-center gap-2 flex-1 min-w-0 group/room p-3 rounded-xl border bg-card/50 hover:bg-muted/50 transition-all cursor-pointer"
                    @contextmenu.capture="store.openRoomContextMenu(roomData.room_id)"
                >
                    <MatrixAvatar
                        :mxc-url="roomData.avatar_url"
                        :name="roomData.name || roomData.room_id"
                        class="h-10 w-10 shrink-0 rounded-lg"
                        :size="64"
                    />
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold truncate group-hover/room:text-primary transition-colors text-sm">
                            {{ roomData.name || roomData.room_id }}
                        </div>
                        <div class="text-[10px] text-muted-foreground truncate flex items-center gap-1.5">
                            <span class="flex items-center gap-1">
                                <Icon name="solar:users-group-rounded-linear" class="w-3 h-3" />
                                {{ roomData.num_joined_members || 0 }}
                            </span>
                            <span v-if="roomData.topic" class="h-1 w-1 rounded-full bg-muted-foreground/30" />
                            <span v-if="roomData.topic" class="opacity-70 truncate">{{ roomData.topic }}</span>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-2 shrink-0">
                        <template v-if="membership === 'join'">
                            <UiButton size="sm" variant="secondary" @click.stop="navigateToRoom" class="rounded-lg h-8 px-3">
                                Open
                            </UiButton>
                        </template>
                        <template v-else-if="membership === 'invite'">
                            <UiButton size="sm" variant="default" @click.stop="store.acceptInvite(roomData.room_id)" class="rounded-lg h-8 px-3">
                                Accept
                            </UiButton>
                        </template>
                        <template v-else>
                            <UiButton size="sm" variant="outline" :disabled="isJoining" @click.stop="joinRoom" class="rounded-lg h-8 px-3 hover:bg-primary hover:text-primary-foreground transition-colors">
                                {{ isJoining ? 'Joining...' : 'Join' }}
                            </UiButton>
                        </template>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="isSpace && !isCollapsed" class="flex flex-col gap-1">
            <SpaceHierarchyTree
                v-for="child in sortedChildren"
                :key="child.room_id"
                :all-rooms="allRooms"
                :room-data="child"
                :depth="depth + 1"
                :space-id="spaceId"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import { isVoiceChannel } from '~/utils/room';

interface HierarchyRoom {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    num_joined_members?: number;
    room_type?: string;
    children_state?: any[];
}

const props = defineProps<{
    allRooms: HierarchyRoom[];
    roomData: HierarchyRoom;
    depth: number;
    spaceId: string;
}>();

const store = useMatrixStore();
const isCollapsed = ref(false);
const isJoining = ref(false);

const isSpace = computed(() => props.roomData.room_type === 'm.space');

const membership = computed(() => {
    const room = store.client?.getRoom(props.roomData.room_id);
    return room?.getMyMembership() || 'leave';
});

const children = computed(() => {
    if (!props.roomData.children_state) return [];
    
    const childIds = props.roomData.children_state.map(c => c.state_key);
    return props.allRooms.filter(r => childIds.includes(r.room_id));
});

const sortedChildren = computed(() => {
    const items = [...children.value];
    const order = store.ui.uiOrder.categories[props.roomData.room_id] || store.ui.uiOrder.rooms[props.roomData.room_id];
    
    if (order && order.length > 0) {
        items.sort((a, b) => {
            const indexA = order.indexOf(a.room_id);
            const indexB = order.indexOf(b.room_id);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0;
        });
    }

    // Sort spaces first, then rooms
    return items.sort((a, b) => {
        const aIsSpace = a.room_type === 'm.space' ? 1 : 0;
        const bIsSpace = b.room_type === 'm.space' ? 1 : 0;
        return bIsSpace - aIsSpace;
    });
});

const joinRoom = async () => {
    isJoining.value = true;
    try {
        await store.joinRoom(props.roomData.room_id);
    } catch (e) {
        console.error('Failed to join room:', e);
    } finally {
        isJoining.value = false;
    }
};

const navigateToRoom = () => {
    const room = store.client?.getRoom(props.roomData.room_id);
    if (!room) return;

    store.toggleSidebar(false);
    store.ui.memberListVisible = false;
    navigateTo(`/chat/spaces/${props.spaceId}/${room.roomId}`);
};
</script>
