<template>
  <div class="flex flex-col gap-1 min-w-0">
    <!-- Game Activity -->
    <template v-if="displayActivity?.is_running && displayActivity?.name">
      <div v-if="variant === 'small'" class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground min-w-0 w-full">
        <Icon name="solar:gamepad-bold" class="w-4 h-4 text-emerald-500 shrink-0" />
        <span class="truncate min-w-0">Playing <span class="text-foreground">{{ displayActivity.name }}</span></span>
      </div>

      <GameCard v-else-if="variant === 'large'" :user-id="userId" />
    </template>

    <!-- Custom Status -->
    <template v-else-if="displayCustomStatus">
      <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground min-w-0 w-full">
        <Icon name="solar:chat-round-line-bold" class="w-4 h-4 text-blue-500 shrink-0" />
        <span class="text-foreground truncate min-w-0">{{ displayCustomStatus }}</span>
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

const isSelf = computed(() => {
  const currentUserId = store.client?.getUserId();
  return !props.userId || (currentUserId && props.userId === currentUserId);
});

const sanitize = (val: any) => {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || s === 'undefined' || s === 'null' || s === 'None') return null;
  return s;
};

const displayActivity = computed(() => store.resolveActivity(props.userId as string | null));

const displayCustomStatus = computed(() => {
  // Prefer local store custom status for self
  if (isSelf.value && store.customStatus) {
    return sanitize(store.customStatus);
  }
  
  if (presenceStatusMsg.value && !presenceStatusMsg.value.startsWith('Playing ')) {
      return sanitize(presenceStatusMsg.value);
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
  return `https://cdn.discordapp.com/app-icons/${(game as any).applicationId}/${(game as any).iconHash}.png?size=128`;
});

// --- Duration Timer Logic ---
const elapsedDuration = ref('0:00');
let timerInterval: number | null = null;

const updateDuration = () => {
  const game = displayActivity.value;
  let start = (game as any)?.startTimestamp;
  if (!game || !start) {
    elapsedDuration.value = '';
    return;
  }

  // Handle Unix seconds vs milliseconds
  if (start < 10000000000) {
    start *= 1000;
  }
  
  const now = Date.now();
  const diffInSeconds = Math.max(0, Math.floor((now - start) / 1000));
  
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
