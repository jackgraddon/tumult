<template>
  <div class="flex items-center gap-3" :class="cardClasses">
    <div class="relative shrink-0">
      <div class="relative">
        <MatrixAvatar 
          class="border"
          :class="props.size === 'full' ? 'h-12 w-12' : props.size === 'regular' ? 'h-10 w-10' : 'h-8 w-8'"
          :mxc-url="displayAvatarUrl" 
          :name="displayName" 
          :size="props.size === 'full' ? 96 : props.size === 'regular' ? 48 : 36"
        />
        <div v-if="displayUserId.startsWith('@discord_')" class="absolute bottom-[-5px] right-[-5px] rounded-full w-[20px] h-[20px] flex items-center justify-center" style="background-color: #5865F2;">
          <Icon name="simple-icons:discord" style="width: 12px; height: 12px;" class="text-white"/>
        </div>
      </div>
      
      <!-- Verification Status Indicator -->
      <button 
        v-if="store.user?.userId === displayUserId"
        class="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-background border shadow-sm hover:bg-muted transition-colors"
        :title="store.isCrossSigningReady ? 'Session Verified' : 'Verify Session'"
      >
        <svg 
          v-if="store.isCrossSigningReady" 
          class="text-green-500 h-3 w-3" 
          xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
        
        <svg 
          v-else 
          class="text-red-500 h-3 w-3"
          xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
      </button>
    </div>
    <div class="flex flex-col min-w-0 flex-1">
      <span class="text-sm font-medium leading-none truncate" :class="nameClasses">{{ displayName }}</span>
      <!-- <span v-if="displayUserId && !topic" class="text-xs text-muted-foreground truncate">{{ displayUserId }}</span> -->
      
      <!-- Topic if provided (from ProfileHeader) -->
      <p v-if="topic" class="text-xs text-muted-foreground truncate mt-1">{{ topic }}</p>

      <!-- Activity Status -->
      <ActivityStatus v-if="!topic" :user-id="displayUserId"/>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMatrixStore } from '~/stores/matrix';

interface User {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
}

const props = withDefaults(defineProps<{
  user?: User | null;
  userId?: string;
  name?: string;
  avatarUrl?: string | null;
  topic?: string;
  isCard?: boolean;
  nameClasses?: string;
  size?: 'full' | 'regular' | 'list';
}>(), {
  user: null,
  userId: "",
  name: "",
  avatarUrl: null,
  topic: "",
  isCard: false,
  nameClasses: "",
  size: "regular"
});

const store = useMatrixStore();

const displayUserId = computed(() => props.user?.userId || props.userId);
const displayName = computed(() => props.user?.displayName || props.name || 'Unknown');
const displayAvatarUrl = computed(() => props.user?.avatarUrl || props.avatarUrl);

const cardClasses = computed(() => {
  return props.isCard 
    ? "rounded-md border p-3 bg-background/50" 
    : "";
});
</script>
