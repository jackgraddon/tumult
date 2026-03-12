<template>
  <div v-if="space" class="flex-1 flex flex-col min-h-0 bg-background overflow-y-auto">
    <!-- Header/Hero Section -->
    <div class="relative h-48 shrink-0 bg-gradient-to-br from-primary/20 via-background to-secondary/20 border-b overflow-hidden">
        <div class="absolute inset-0 bg-grid-white/[0.05] [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))]" />
        <div class="relative h-full max-w-5xl mx-auto px-8 flex items-end pb-6 gap-6">
            <MatrixAvatar
                :mxc-url="space.getMxcAvatarUrl()"
                :name="space.name"
                class="h-24 w-24 rounded-2xl border-4 border-background shadow-2xl"
                :size="128"
            />
            <div class="flex-1 mb-2">
                <h1 class="text-3xl font-bold tracking-tight">{{ space.name }}</h1>
                <p v-if="topic" class="text-muted-foreground mt-1 max-w-2xl line-clamp-2">{{ topic }}</p>
            </div>
            <div class="flex gap-2 mb-2 shrink-0">
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
                        class="group p-4 rounded-xl border bg-card hover:bg-accent/50 transition-all flex items-center gap-4"
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
                        class="group p-4 rounded-xl border bg-card hover:bg-accent/50 transition-all flex items-center gap-4 cursor-pointer"
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import { useVoiceStore } from '~/stores/voice';
import { isVoiceChannel } from '~/utils/room';
import type { Room, RoomMember } from 'matrix-js-sdk';

const props = defineProps<{
    spaceId: string;
}>();

const store = useMatrixStore();
const voiceStore = useVoiceStore();

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

watch(() => props.spaceId, (id) => {
    if (id) {
        store.fetchSpaceHierarchy(id);
    }
}, { immediate: true });
</script>
