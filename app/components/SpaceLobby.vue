<template>
  <div v-if="space" class="flex-1 flex flex-col min-h-0 bg-background overflow-y-auto">
    <!-- Header/Hero Section -->
    <div class="relative h-48 shrink-0 bg-gradient-to-br from-primary/20 via-background to-secondary/20 border-b overflow-hidden">
        <div class="absolute inset-0 bg-grid-white/[0.05] [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))]" />
        <div class="relative h-full max-w-5xl mx-auto px-8 flex items-end pb-6 gap-6">
            <UiButton
                variant="ghost"
                size="icon-sm"
                class="md:hidden shrink-0 absolute top-4 left-4 z-10"
                @click="() => { store.toggleSidebar(true); store.ui.memberListVisible = false; }"
                v-if="!store.ui.sidebarOpen"
            >
                <Icon name="solar:hamburger-menu-linear" class="h-6 w-6" />
            </UiButton>

            <div 
                class="cursor-pointer group/avatar"
                @contextmenu="store.openRoomContextMenu(space.roomId)"
            >
                <MatrixAvatar 
                    :mxc-url="space.getMxcAvatarUrl()" 
                    :name="space.name" 
                    class="h-24 w-24 rounded-2xl border-4 border-background shadow-2xl group-hover/avatar:ring-2 group-hover/avatar:ring-primary/50 transition-all"
                    :size="128"
                />
            </div>
            <div class="flex-1 mb-2 min-w-0">
                <div 
                    class="cursor-pointer group/title"
                    @contextmenu="store.openRoomContextMenu(space.roomId)"
                >
                    <h1 class="text-3xl font-bold tracking-tight truncate group-hover/title:text-primary transition-colors">{{ space.name }}</h1>
                </div>
                <p v-if="topic" class="text-muted-foreground mt-1 max-w-2xl line-clamp-2">{{ topic }}</p>
            </div>
            <div class="flex gap-2 mb-2 shrink-0">
                <UiButton v-if="canManage" variant="secondary" size="sm" @click="showAddExistingModal = true">
                    <Icon name="solar:add-circle-bold" class="mr-2 h-4 w-4" />
                    Add Room
                </UiButton>
                <UiButton variant="secondary" size="sm" @click="store.openGlobalSearchModal">
                    <Icon name="solar:magnifer-linear" class="mr-2 h-4 w-4" />
                    Search
                </UiButton>
                <UiButton variant="default" size="sm" v-if="!isJoined" @click="store.joinRoom(space.roomId)">
                    Join Space
                </UiButton>
            </div>
        </div>
    </div>

    <div class="max-w-5xl mx-auto w-full px-8 py-8 grid grid-cols-1 md:grid-cols-3 gap-8">
        <!-- Main Content (Rooms) -->
        <div class="md:col-span-2 space-y-8">
            <section v-if="featuredChatRooms.length > 0">
                <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
                    <Icon name="solar:chat-round-dots-bold" class="text-primary w-5 h-5" />
                    Featured Chat Rooms
                </h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <NuxtLink 
                        v-for="room in featuredChatRooms" 
                        :key="room.roomId"
                        :to="`/chat/spaces/${space.roomId}/${room.roomId}`"
                        class="group p-4 rounded-xl border bg-card hover:bg-muted/50 transition-all flex items-center gap-4"
                    >
                        <MatrixAvatar :mxc-url="room.getMxcAvatarUrl()" :name="room.name" class="h-10 w-10 shrink-0" />
                        <div class="min-w-0 flex-1">
                            <div class="font-semibold truncate group-hover:text-primary transition-colors">{{ room.name }}</div>
                            <div class="text-xs text-muted-foreground truncate">{{ room.getJoinedMemberCount() }} members</div>
                        </div>
                    </NuxtLink>
                </div>
            </section>

            <section v-if="featuredVoiceRooms.length > 0">
                <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
                    <Icon name="solar:phone-calling-bold" class="text-green-500 w-5 h-5" />
                    Active Voice Channels
                </h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div 
                        v-for="room in featuredVoiceRooms" 
                        :key="room.roomId"
                        role="button"
                        @click="voiceStore.joinVoiceRoom(room)"
                        class="group p-4 rounded-xl border bg-card hover:bg-muted/50 transition-all flex items-center gap-4 cursor-pointer"
                    >
                        <div class="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                            <Icon name="solar:phone-calling-linear" class="text-green-500 w-6 h-6" />
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="font-semibold truncate group-hover:text-green-500 transition-colors">{{ room.name }}</div>
                            <div class="flex items-center gap-1.5 mt-0.5">
                                <span class="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                <span class="text-xs text-muted-foreground">{{ store.getVoiceParticipants(room.roomId).length }} online</span>
                            </div>
                        </div>
                        <Icon name="solar:alt-arrow-right-linear" class="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                </div>
            </section>

            <section class="border rounded-2xl overflow-hidden bg-card/30">
                <button 
                    @click="isHierarchyCollapsed = !isHierarchyCollapsed"
                    class="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
                >
                    <div class="flex items-center gap-3">
                        <div class="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                            <Icon name="solar:globus-bold" class="w-6 h-6" />
                        </div>
                        <div class="text-left">
                            <h3 class="text-lg font-bold leading-none">Browse All Rooms</h3>
                            <p class="text-xs text-muted-foreground mt-1">Explore all joinable rooms in this space</p>
                        </div>
                    </div>
                    <Icon 
                        :name="isHierarchyCollapsed ? 'solar:alt-arrow-down-linear' : 'solar:alt-arrow-up-linear'" 
                        class="w-5 h-5 text-muted-foreground"
                    />
                </button>
                
                <div v-if="!isHierarchyCollapsed" class="px-6 pb-6 pt-2 border-t bg-background/50">
                    <div v-if="hierarchyRooms.length > 0" class="space-y-1">
                        <SpaceHierarchyTree 
                            :all-rooms="hierarchyRooms" 
                            :room-data="rootRoom"
                            :depth="0"
                            :space-id="spaceId"
                        />
                    </div>
                    <div v-else class="py-12 text-center">
                        <Icon name="solar:magnifer-linear" class="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                        <p class="text-muted-foreground">No rooms found in this space.</p>
                        <UiButton variant="outline" size="sm" class="mt-4" @click="store.fetchSpaceHierarchy(spaceId)">
                            <Icon name="solar:restart-linear" class="mr-2 h-4 w-4" />
                            Retry Loading
                        </UiButton>
                    </div>
                </div>
            </section>
        </div>

        <!-- Sidebar (Members/Mods) -->
        <div class="space-y-8">
            <section v-if="moderators.length > 0">
                <h3 class="text-xs font-bold uppercase text-muted-foreground tracking-widest mb-4">Moderators</h3>
                <div class="space-y-3">
                    <UserProfile 
                        v-for="mod in moderators" 
                        :key="mod.userId"
                        :user-id="mod.userId"
                        :name="mod.name"
                        :avatar-url="mod.getMxcAvatarUrl()"
                        size="list"
                    />
                </div>
            </section>

            <section v-if="onlineMembers.length > 0">
                <h3 class="text-xs font-bold uppercase text-muted-foreground tracking-widest mb-4">
                    Active Members — {{ onlineMembers.length }}
                </h3>
                <div class="space-y-3">
                    <UserProfile 
                        v-for="member in onlineMembers.slice(0, 15)" 
                        :key="member.userId"
                        :user-id="member.userId"
                        :name="member.name"
                        :avatar-url="member.getMxcAvatarUrl()"
                        size="list"
                    />
                    <div v-if="onlineMembers.length > 15" class="text-xs text-muted-foreground px-2">
                        and {{ onlineMembers.length - 15 }} others...
                    </div>
                </div>
            </section>
        </div>
    </div>

    <!-- Add Existing Room Modal -->
    <UiDialog v-model:open="showAddExistingModal">
      <UiDialogContent class="sm:max-w-[500px]">
        <UiDialogHeader>
          <UiDialogTitle>Add Existing Room to Space</UiDialogTitle>
          <UiDialogDescription>
            Choose a room to add to {{ space.name }}.
          </UiDialogDescription>
        </UiDialogHeader>
        <div class="py-4 space-y-4">
          <UiInput v-model="roomSearch" placeholder="Search your rooms..." />
          <div class="border rounded-md max-h-[300px] overflow-y-auto divide-y">
            <div 
              v-for="room in joinableRooms" 
              :key="room.roomId"
              class="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors"
              @click="addExistingRoom(room.roomId)"
            >
              <MatrixAvatar :mxc-url="room.getMxcAvatarUrl()" :name="room.name" class="h-8 w-8" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">{{ room.name }}</div>
              </div>
              <Icon name="solar:add-circle-bold" class="h-4 w-4 text-muted-foreground" />
            </div>
            <div v-if="joinableRooms.length === 0" class="p-8 text-center text-muted-foreground italic text-sm">
              No matching rooms found.
            </div>
          </div>
        </div>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import { useVoiceStore } from '~/stores/voice';
import { isVoiceChannel } from '~/utils/room';
import type { Room, RoomMember } from 'matrix-js-sdk';

const props = defineProps<{
    spaceId: string;
}>();

const store = useMatrixStore();
const voiceStore = useVoiceStore();

const isHierarchyCollapsed = ref(true);

const space = computed(() => store.client?.getRoom(props.spaceId));
const isJoined = computed(() => space.value?.getMyMembership() === 'join');

const topic = computed(() => {
    if (!space.value) return '';
    return space.value.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '';
});

const members = computed(() => {
    if (!space.value) return [];
    return space.value.getMembersWithMembership('join');
});

const moderators = computed(() => {
    return members.value
        .filter(m => m.powerLevel >= 50)
        .sort((a, b) => b.powerLevel - a.powerLevel);
});

const onlineMembers = computed(() => {
    return members.value.filter(m => {
        const presence = m.user?.presence;
        return presence === 'online' || presence === 'unavailable';
    });
});

const allRoomsInHierarchy = computed(() => {
    // Access hierarchyTrigger for reactivity when hierarchy changes
    store.hierarchyTrigger;

    if (!space.value || !store.client) return [];
    
    const rooms: Room[] = [];
    const visited = new Set<string>();
    
    const discover = (currentSpaceId: string) => {
        if (visited.has(currentSpaceId)) return;
        visited.add(currentSpaceId);
        
        const currentSpace = store.client!.getRoom(currentSpaceId);
        if (!currentSpace) return;
        
        const childEvents = currentSpace.currentState.getStateEvents('m.space.child');
        childEvents.forEach(event => {
            const roomId = event.getStateKey() as string;
            const room = store.client!.getRoom(roomId);
            if (!room) return;
            
            if (room.isSpaceRoom()) {
                discover(roomId);
            } else {
                rooms.push(room);
            }
        });
    };
    
    discover(props.spaceId);
    
    // Deduplicate rooms that might be in multiple sub-spaces
    return Array.from(new Map(rooms.map(r => [r.roomId, r])).values());
});

const featuredChatRooms = computed(() => {
    const rooms = allRoomsInHierarchy.value.filter(r => !isVoiceChannel(r));
    // Sort by member count and pick top 6
    return rooms.sort((a, b) => b.getJoinedMemberCount() - a.getJoinedMemberCount()).slice(0, 6);
});

const featuredVoiceRooms = computed(() => {
    return allRoomsInHierarchy.value.filter(r => isVoiceChannel(r)).slice(0, 6);
});

const hierarchyRooms = computed(() => {
    return store.spaceHierarchies[props.spaceId] || [];
});

const rootRoom = computed(() => {
    return hierarchyRooms.value.find(r => r.room_id === props.spaceId);
});

const showAddExistingModal = ref(false);
const roomSearch = ref('');

const canManage = computed(() => {
  if (!space.value || !store.client) return false;
  const me = space.value.getMember(store.client.getUserId()!);
  return (me?.powerLevel || 0) >= 50;
});

const joinableRooms = computed(() => {
  if (!store.client) return [];
  const search = roomSearch.value.toLowerCase();
  const existingChildIds = new Set(
    space.value?.currentState.getStateEvents('m.space.child').map(ev => ev.getStateKey())
  );

  return store.client.getVisibleRooms().filter(r => {
    if (r.isSpaceRoom() || r.getMyMembership() !== 'join') return false;
    if (existingChildIds.has(r.roomId)) return false;
    return r.name?.toLowerCase().includes(search);
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
});

const addExistingRoom = async (roomId: string) => {
  try {
    await store.addRoomToSpace(props.spaceId, roomId);
    showAddExistingModal.value = false;
    roomSearch.value = '';
    import('vue-sonner').then(({ toast }) => toast.success('Room added to space'));
  } catch (err: any) {
    import('vue-sonner').then(({ toast }) => toast.error('Failed to add room', { description: err.message }));
  }
};

watch(() => props.spaceId, (id) => {
    if (id) {
        store.fetchSpaceHierarchy(id);
    }
}, { immediate: true });
</script>
