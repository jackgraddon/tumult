<template>
  <div class="flex flex-col gap-1 min-w-0">
    <!-- Game Activity -->
    <template v-if="displayActivity?.is_running && displayActivity?.name">
      <div v-if="variant === 'small'" class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground w-full">
        <Icon name="solar:gamepad-bold" class="w-4 h-4 text-emerald-500 shrink-0" />
        <span class="truncate">Playing <span class="text-foreground">{{ displayActivity.name }}</span></span>
      </div>

      <div v-else-if="variant === 'large'" class="relative flex flex-col p-3.5 bg-card border border-border rounded-xl shadow-sm w-full max-w-sm">
        <div class="flex items-center justify-between w-full mb-2">
          <span class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Playing
          </span>
          <button class="text-muted-foreground hover:text-foreground transition-colors">
            <Icon name="solar:menu-dots-bold" class="w-4 h-4" />
          </button>
        </div>

        <div class="flex items-center gap-3.5">
          <div class="relative w-16 h-16 shrink-0 rounded-2xl bg-muted overflow-hidden flex items-center justify-center shadow-inner border border-border/50">
            <img 
              v-if="iconUrl" 
              :src="iconUrl" 
              :alt="displayActivity.name"
              class="w-full h-full object-cover"
            />
            <Icon v-else name="solar:gamepad-bold" class="w-8 h-8 text-muted-foreground/30" />
            
            <div class="absolute top-1 left-1 w-2.5 h-2.5 bg-emerald-500 border-2 border-card rounded-full shadow-sm"></div>
          </div>

          <div class="flex flex-col min-w-0 w-full">
            <h4 class="font-semibold text-[15px] leading-tight text-foreground truncate w-full">
              {{ displayActivity.name }}
            </h4>
            
            <div v-if="gameStartTimestamp" class="flex items-center gap-1.5 mt-1.5 text-emerald-500 font-medium text-xs">
              <Icon name="solar:gamepad-bold" class="w-3.5 h-3.5 shrink-0" />
              <span class="tabular-nums tracking-tight">{{ elapsedDuration }}</span>
            </div>
            <div v-else class="text-xs text-muted-foreground mt-1 truncate">
              Currently in-game
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Custom Status -->
    <template v-else-if="displayCustomStatus">
      <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground w-full">
        <Icon name="solar:chat-round-line-bold" class="w-4 h-4 text-blue-500 shrink-0" />
        <span class="text-foreground truncate">{{ displayCustomStatus }}</span>
      </div>
    </template>

    <!-- Basic Presence -->
    <template v-else-if="showBasicPresence">
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <div class="h-2 w-2 rounded-full shrink-0" :class="presenceDotColor"></div>
        <span class="truncate capitalize">{{ displayPresenceText }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch, onUnmounted } from 'vue';

const props = withDefaults(defineProps<{
  userId?: string | null;
  variant?: 'small' | 'large';
  showBasicPresence?: boolean;
}>(), {
  variant: 'small',
  showBasicPresence: true
});

const store = useMatrixStore();

// Presence state
const presenceStatusMsg = ref<string | null>(null);
const presenceStatus = ref<string>('offline');

const fetchPresence = () => {
    if (!props.userId || !store.client) {
        presenceStatusMsg.value = null;
        presenceStatus.value = 'offline';
        return;
    }
    const user = store.client.getUser(props.userId);
    if (user) {
        presenceStatusMsg.value = user.presenceStatusMsg || null;
        presenceStatus.value = user.presence || 'offline';
    } else {
        presenceStatusMsg.value = null;
        presenceStatus.value = 'offline';
    }
}

const handlePresenceEvent = (event: any, user: any) => {
    if (user && user.userId === props.userId) {
        presenceStatusMsg.value = user.presenceStatusMsg || null;
        presenceStatus.value = user.presence || 'offline';
    }
}

const pollPresence = async () => {
    if (!store.client || !props.userId) return;

    if (isSelf.value) {
        // For self, the store handles throttling and pushing to server
        store.refreshPresence();
        // Update local state from the user object to stay in sync
        const user = store.client.getUser(props.userId);
        if (user) {
            presenceStatus.value = user.presence || 'offline';
            presenceStatusMsg.value = user.presenceStatusMsg || null;
        }
    } else {
        // For others, pull the latest from the server
        try {
            const data = await store.client.getPresence(props.userId);
            if (data) {
                presenceStatus.value = data.presence || 'offline';
                presenceStatusMsg.value = data.status_msg || null;
            }
        } catch (e) {
            console.warn(`[ActivityStatus] Failed to poll presence for ${props.userId}:`, e);
        }
    }
};

let pollInterval: number | null = null;

onMounted(() => {
    fetchPresence();
    if (store.client) {
        store.client.on('User.presence' as any, handlePresenceEvent);
    }
    
    // Start polling every 5 minutes
    pollInterval = window.setInterval(pollPresence, 5 * 60 * 1000);
});

onUnmounted(() => {
    if (store.client) {
        store.client.removeListener('User.presence' as any, handlePresenceEvent);
    }
    if (timerInterval) clearInterval(timerInterval);
    if (pollInterval) clearInterval(pollInterval);
});

watch(() => props.userId, fetchPresence);

const isSelf = computed(() => !props.userId || props.userId === store.user?.userId);

const displayActivity = computed(() => {
  // Prefer local store details for self if running
  if (isSelf.value && store.activityDetails?.is_running) {
    return store.activityDetails; 
  }
  
  if (presenceStatusMsg.value && presenceStatusMsg.value.startsWith('Playing ')) {
      return {
          name: presenceStatusMsg.value.substring(8),
          is_running: true
      };
  }
  return null;
});

const displayCustomStatus = computed(() => {
  // Prefer local store custom status for self
  if (isSelf.value && store.customStatus) {
    return store.customStatus;
  }
  
  if (presenceStatusMsg.value && !presenceStatusMsg.value.startsWith('Playing ')) {
      return presenceStatusMsg.value;
  }
  return null;
});

const effectivePresence = computed(() => {
    if (isSelf.value) return store.isIdle ? 'unavailable' : 'online';
    return presenceStatus.value;
});

const presenceDotColor = computed(() => {
    if (effectivePresence.value === 'online') return 'bg-emerald-500';
    if (effectivePresence.value === 'unavailable') return 'bg-yellow-500';
    return 'bg-gray-400 dark:bg-gray-600';
});

const displayPresenceText = computed(() => {
    if (effectivePresence.value === 'online') return 'Online';
    if (effectivePresence.value === 'unavailable') return 'Idle';
    return 'Offline';
});

const gameStartTimestamp = computed(() => (displayActivity.value as any)?.startTimestamp);

// --- Compute the Discord CDN Image URL for games ---
const iconUrl = computed(() => {
  const game = displayActivity.value;
  if (!game || !(game as any).applicationId || !(game as any).iconHash) return null;

  const icon = (game as any).iconHash;
  // If icon is an external URL (sometimes happens with some RPC clients), return it directly
  if (icon.startsWith('http')) return icon;

  // Otherwise, assume it's a Discord Asset ID
  // arRPC often provides these IDs which need a specific format
  if (icon.startsWith('mp:')) {
    return `https://media.discordapp.net/${icon.replace('mp:', 'external/')}`;
  }

  return `https://cdn.discordapp.com/app-icons/${(game as any).applicationId}/${icon}.png?size=128`;
});

// --- Duration Timer Logic ---
const elapsedDuration = ref('0:00');
let timerInterval: number | null = null;

const updateDuration = () => {
  const game = displayActivity.value;
  if (!game || !(game as any).startTimestamp) {
    elapsedDuration.value = '';
    return;
  }
  
  const now = Date.now();
  const diffInSeconds = Math.max(0, Math.floor((now - (game as any).startTimestamp) / 1000));
  
  const hours = Math.floor(diffInSeconds / 3600);
  const minutes = Math.floor((diffInSeconds % 3600) / 60);
  const seconds = diffInSeconds % 60;

  if (hours > 0) {
    elapsedDuration.value = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
    elapsedDuration.value = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
};

onMounted(() => {
  const game = displayActivity.value;
  if (game && (game as any).startTimestamp) {
    updateDuration();
    // Use window.setInterval to avoid NodeJS typing conflicts in Nuxt
    timerInterval = window.setInterval(updateDuration, 1000);
  }
});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
});

watch(() => (displayActivity.value as any)?.startTimestamp, (newTimestamp) => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (newTimestamp) {
    updateDuration();
    timerInterval = window.setInterval(updateDuration, 1000);
  } else {
    elapsedDuration.value = '';
  }
});
</script>
