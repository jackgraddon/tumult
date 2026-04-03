<template>
  <aside class="w-full md:w-60 flex flex-col shrink-0 h-full pl-2 relative">
    <div class="p-4 flex items-center gap-2">
      <UiButton
        variant="ghost"
        size="icon-sm"
        class="md:hidden shrink-0"
        @click="store.toggleMemberList()"
      >
        <Icon name="solar:alt-arrow-left-linear" class="h-6 w-6" />
      </UiButton>
      <h3 class="text-sm font-bold flex items-center gap-2">
        <Icon 
          name="solar:users-group-rounded-bold" 
          class="w-5 h-5" 
          :class="isEncrypted ? 'text-green-500' : 'text-red-500'"
        />
        Members
      </h3>
    </div>

    <div class="flex-1 overflow-y-auto space-y-6 custom-scrollbar">
      
      <div v-if="online.length > 0">
        <h4 class="px-2 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          Online — {{ online.length }}
        </h4>
        <div class="space-y-0.5">
          <div 
            v-for="member in online" 
            :key="member.userId"
            class="group flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors"
            :class="{ 'bg-secondary text-secondary-foreground': selectedUserId === member.userId }"
            @click="(e: any) => openUserProfileCard(e, member.userId)"
            v-long-press="(e: any) => openUserProfileCard(e, member.userId)"
          >
            <UserProfile 
              :user-id="member.userId"
              :name="member.name"
              :avatar-url="member.getMxcAvatarUrl()"
              size="list"
              class="min-w-0 flex-1"
            />
          </div>
        </div>
      </div>

      <div v-if="offline.length > 0">
        <h4 class="px-2 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          Offline — {{ offline.length }}
        </h4>
        <div class="space-y-0.5">
          <div 
            v-for="member in offline" 
            :key="member.userId"
            class="group flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors"
            :class="{ 'bg-secondary text-secondary-foreground': selectedUserId === member.userId }"
            @click="(e: any) => openUserProfileCard(e, member.userId)"
            v-long-press="(e: any) => openUserProfileCard(e, member.userId)"
          >
            <UserProfile 
              :user-id="member.userId"
              :name="member.name"
              :avatar-url="member.getMxcAvatarUrl()"
              size="list"
              class="min-w-0 flex-1"
            />
          </div>
        </div>
      </div>
    </div>
  </aside>

  <Teleport to="body">
    <div 
      v-if="selectedUserId && selectedUser" 
      class="fixed inset-0 z-[99]" 
      @click="closeProfileCard"
    ></div>
    
    <Transition name="popover">
      <div 
        v-if="selectedUserId && selectedUser"
        class="fixed z-[100] shadow-2xl"
        :style="{ top: profileCardPos.top, right: profileCardPos.right, left: profileCardPos.left }"
      >
        <ProfileCard :userid="selectedUserId" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useMatrixStore } from '../stores/matrix';
import ProfileCard from './ProfileCard.vue'; 
import type { Room, RoomMember } from 'matrix-js-sdk';

const props = defineProps<{ room: Room }>();
const store = useMatrixStore();
const refreshKey = ref(0);

const isEncrypted = computed(() => {
  if (!props.room || !store.client) return false;
  return store.client.isRoomEncrypted(props.room.roomId);
});

// --- Popover State ---
const selectedUserId = computed(() => store.ui.selectedUserId);
const profileCardPos = computed(() => store.ui.profileCardPos);

// ProfileCard expects a Matrix User object, so we resolve it here
const selectedUser = computed(() => {
  if (!selectedUserId.value || !store.client) return null;
  return store.client.getUser(selectedUserId.value);
});

// --- Member Parsing & Sorting ---
const allMembers = computed(() => {
  refreshKey.value; // Tie this computed property to our manual refresh trigger
  if (!props.room) return [];
  
  return props.room.getMembersWithMembership('join').sort((a: RoomMember, b: RoomMember) => {
    // Sort by power level descending, then by name alphabetically
    if (b.powerLevel !== a.powerLevel) {
      return b.powerLevel - a.powerLevel;
    }
    return (a.name || '').localeCompare(b.name || '');
  });
});

// Active users (Online or Idle)
const online = computed(() => allMembers.value.filter(m => {
  const presence = m.user?.presence;
  return presence === 'online' || presence === 'unavailable';
}));

// Inactive users (Explicitly Offline, or unknown)
const offline = computed(() => allMembers.value.filter(m => {
  const presence = m.user?.presence;
  return !presence || presence === 'offline';
}));

// --- Profile Card Logic ---
function openUserProfileCard(event: MouseEvent, userId: string) {
  // If clicking the same user that is already open, toggle it off
  if (selectedUserId.value === userId) {
    closeProfileCard();
    return;
  }
  
  // Get the exact coordinates of the list item that was clicked
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  
  // Dynamically calculate where to place the card so it spawns to the LEFT of the sidebar.
  // We use window.innerWidth - rect.left to calculate the distance from the right edge of the screen.
  const spacingGap = 16; 
  const estimatedCardHeight = 250; // Approximated height of ProfileCard.vue to prevent bottom clipping
  const estimatedCardWidth = 400; // Approximated width from ProfileCard.vue
  
  let pos: { top: string, right: string, left?: string };

  if (window.innerWidth < 768) {
    // On mobile, center the card on the screen
    pos = {
      top: `${(window.innerHeight - estimatedCardHeight) / 2}px`,
      left: `${(window.innerWidth - estimatedCardWidth) / 2}px`,
      right: 'auto'
    };
  } else {
    // On desktop, spawn to the left of the sidebar
    pos = {
      top: `${Math.min(rect.top, window.innerHeight - estimatedCardHeight - 20)}px`,
      right: `${window.innerWidth - rect.left + spacingGap}px`,
      left: 'auto'
    };
  }

  store.setUISelectedUser(userId, pos);
}

function closeProfileCard() {
  store.setUISelectedUser(null);
}

// --- Matrix Event Listeners for Live Updates ---
const onRoomMemberEvent = () => {
  refreshKey.value++;
};

onMounted(() => {
  if (store.client && props.room) {
    props.room.on('RoomMember.name' as any, onRoomMemberEvent);
    props.room.on('RoomMember.membership' as any, onRoomMemberEvent);
    props.room.on('RoomMember.powerLevel' as any, onRoomMemberEvent);
  }
});

onUnmounted(() => {
  if (store.client && props.room) {
    props.room.removeListener('RoomMember.name' as any, onRoomMemberEvent);
    props.room.removeListener('RoomMember.membership' as any, onRoomMemberEvent);
    props.room.removeListener('RoomMember.powerLevel' as any, onRoomMemberEvent);
  }
});
</script>

<style scoped>
/* Smooth pop-in animation for the profile card */
.popover-enter-active,
.popover-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateX(10px) scale(0.98);
}

/* Optional: Custom scrollbar styling for the member list */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(150, 150, 150, 0.3);
  border-radius: 4px;
}
</style>
