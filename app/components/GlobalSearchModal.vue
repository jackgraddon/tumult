<template>
  <UiCommandDialog :open="store.globalSearchModalOpen" @update:open="(val) => { if(!val) { store.closeGlobalSearchModal(); store.setInviteRoomId(null); } }" :filter-function="customFilter">
    <UiCommandInput v-model="searchQuery" :placeholder="store.inviteRoomId ? 'Type a Matrix ID to invite...' : 'Type a name, Matrix ID, or room alias...'" />
    <UiCommandList>
      <UiCommandEmpty>No results found.</UiCommandEmpty>

      <UiCommandGroup :heading="store.inviteRoomId ? `Invite to ${inviteRoomName}` : 'People'" v-if="friends.length > 0">
        <UiCommandItem 
          v-for="friend in friends" 
          :key="friend.roomId" 
          :value="friend.name" 
          @select="() => store.inviteRoomId ? inviteToRoom(friend.dmUserId!) : navigateToRoom(friend.roomId)"
        >
          <MatrixAvatar :mxc-url="friend.avatarUrl" :name="friend.name" class="h-6 w-6 mr-2" />
          {{ friend.name }}
          <span v-if="store.inviteRoomId" class="ml-auto text-xs text-muted-foreground">Invite</span>
        </UiCommandItem>
      </UiCommandGroup>

      <UiCommandGroup heading="Rooms" v-if="rooms.length > 0 && !store.inviteRoomId">
        <UiCommandItem 
          v-for="room in rooms" 
          :key="room.roomId" 
          :value="room.name" 
          @select="() => navigateToRoom(room.roomId)"
        >
          <MatrixAvatar :mxc-url="room.avatarUrl" :name="room.name" class="h-6 w-6 mr-2" />
          {{ room.name }}
        </UiCommandItem>
      </UiCommandGroup>

      <UiCommandSeparator v-if="(friends.length > 0 || rooms.length > 0) && !store.inviteRoomId" />
      
      <UiCommandGroup heading="Actions">
        <UiCommandItem 
          v-if="store.inviteRoomId"
          value="action_invite"
          @select="(e) => { e.preventDefault(); inviteToRoom(parsedQuery); }"
          :class="{ 'text-destructive animate-shake': createError }"
        >
           <Icon name="solar:user-plus-bold" class="mr-2 h-4 w-4" v-if="!createError" />
           <Icon name="solar:danger-circle-bold" class="mr-2 h-4 w-4" v-else />
           <span>{{ createError ? createError : `Invite ${parsedQuery}` }}</span>
        </UiCommandItem>

        <template v-else>
          <UiCommandItem
            value="action_create"
            @select="(e) => { e.preventDefault(); createChatFromQuery(); }"
            :class="{ 'text-destructive animate-shake': createError }"
          >
             <Icon name="solar:user-plus-bold" class="mr-2 h-4 w-4" v-if="!createError" />
             <Icon name="solar:danger-circle-bold" class="mr-2 h-4 w-4" v-else />
             <span>{{ createError ? createError : `Start Chat with ${parsedQuery}` }}</span>
          </UiCommandItem>
          <UiCommandItem
            value="action_create_room"
            @select="(e) => { e.preventDefault(); store.openCreateRoomModal(); }"
          >
             <Icon name="solar:add-circle-bold" class="mr-2 h-4 w-4" />
             <span>Create Room</span>
          </UiCommandItem>
          <UiCommandItem
            value="action_join"
            @select="(e) => { e.preventDefault(); joinRoomFromQuery(); }"
            :class="{ 'text-destructive animate-shake': joinError }"
          >
             <Icon name="solar:link-round-angle-bold" class="mr-2 h-4 w-4" v-if="!joinError" />
             <Icon name="solar:danger-circle-bold" class="mr-2 h-4 w-4" v-else />
             <span>{{ joinError ? joinError : `Join ${parsedQuery}` }}</span>
          </UiCommandItem>
        </template>
      </UiCommandGroup>
    </UiCommandList>
  </UiCommandDialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  friends: any[];
  rooms: any[];
}>();

const store = useMatrixStore();
const searchQuery = ref('');
const isSubmitting = ref(false);
const createError = ref('');
const joinError = ref('');

const customFilter = (val: string, search: string) => {
  // Bypass filtering for action items based on exact programmatic values 
  if (val === 'action_create' || val === 'action_create_room' || val === 'action_join' || val === 'action_invite') {
    return true;
  }
  // Default case-insensitive search for rooms/people
  return val.trim().toLowerCase().includes(search.toLowerCase());
};

const extractMatrixId = (input: string) => {
    let clean = input.trim();
    if (clean.includes('matrix.to')) {
        const urlObj = new URL(clean.startsWith('http') ? clean : 'https://' + clean);
        if (urlObj.hash && urlObj.hash.startsWith('#/')) {
            const hashBase = urlObj.hash.split('?')[0];
            if (hashBase) {
                const parts = hashBase.split('/');
                if (parts.length >= 2) {
                    return parts.slice(1).join('/');
                }
            }
        }
    }
    return clean;
}

const parsedQuery = computed(() => extractMatrixId(searchQuery.value));

const isValidMatrixId = (query: string) => {
    const parsed = extractMatrixId(query);
    return parsed.startsWith('@');
};

const isValidRoomIdOrAlias = (query: string) => {
    const parsed = extractMatrixId(query);
    return (parsed.startsWith('#') || parsed.startsWith('!'));
};

const inviteRoomName = computed(() => {
    if (!store.inviteRoomId || !store.client) return '';
    return store.client.getRoom(store.inviteRoomId)?.name || 'Room';
});

const navigateToRoom = (roomId: string) => {
    store.closeGlobalSearchModal();
    searchQuery.value = '';
    
    const isFriend = props.friends.some(f => f.roomId === roomId);
    if (isFriend) {
      navigateTo(`/chat/dms/${roomId}`);
    } else {
      navigateTo(`/chat/rooms/${roomId}`);
    }
};

const inviteToRoom = async (userId: string) => {
    if (!isValidMatrixId(userId) || isSubmitting.value || !store.inviteRoomId) return;
    isSubmitting.value = true;
    createError.value = '';
    try {
        await store.client?.invite(store.inviteRoomId, userId);
        import('vue-sonner').then(({ toast }) => toast.success(`Invited ${userId}`));
        store.closeGlobalSearchModal();
        store.setInviteRoomId(null);
        searchQuery.value = '';
    } catch (e: any) {
        console.error("Failed to invite user:", e);
        createError.value = e.message || "Failed to invite user.";
        setTimeout(() => createError.value = '', 3000);
    } finally {
        isSubmitting.value = false;
    }
};

const createChatFromQuery = async () => {
    if (!isValidMatrixId(searchQuery.value) || isSubmitting.value) return;
    isSubmitting.value = true;
    createError.value = '';
    try {
        const roomId = await store.createDirectRoom(parsedQuery.value);
        if (roomId) {
            store.closeGlobalSearchModal();
            searchQuery.value = '';
            await navigateTo(`/chat/dms/${roomId}`);
        }
    } catch (e: any) {
        console.error("Failed to create room:", e);
        createError.value = e.message || "Failed to create chat.";
        setTimeout(() => createError.value = '', 3000);
    } finally {
        isSubmitting.value = false;
    }
};

const joinRoomFromQuery = async () => {
    if (!isValidRoomIdOrAlias(searchQuery.value) || isSubmitting.value) return;
    isSubmitting.value = true;
    joinError.value = '';
    try {
        const result = await store.joinRoom(parsedQuery.value);
        if (result && result.roomId) {
            store.closeGlobalSearchModal();
            searchQuery.value = '';
            await navigateTo(`/chat/rooms/${result.roomId}`);
        }
    } catch (e: any) {
        console.error("Failed to join room:", e);
        joinError.value = e.message || "Failed to join room.";
        setTimeout(() => joinError.value = '', 3000);
    } finally {
        isSubmitting.value = false;
    }
};
</script>

<style scoped>
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
}

.animate-shake {
  animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
}
</style>
