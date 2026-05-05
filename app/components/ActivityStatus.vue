<template>
  <div class="flex flex-col gap-1 min-w-0">
    <!-- Activities -->
    <template v-if="activities.game || activities.music">
      <!-- Small Variant -->
      <div v-if="variant === 'small'" class="flex flex-col gap-0.5">
        <!-- Game (Small) -->
        <div v-if="activities.game?.is_running" class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground min-w-0 w-full">
          <Icon name="solar:gamepad-bold" class="w-4 h-4 text-emerald-500 shrink-0" />
          <span class="truncate min-w-0">
            Playing <span class="text-foreground">{{ activities.game.name }}</span>
          </span>
        </div>
        <!-- Music (Small) -->
        <div v-else-if="activities.music?.is_running" class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground min-w-0 w-full">
          <Icon
            :name="activities.music.is_paused ? 'solar:pause-bold' : 'solar:music-note-bold'"
            class="w-4 h-4 text-[#AA5CC3] shrink-0"
          />
          <span class="truncate min-w-0">
            {{ activities.music.is_paused ? 'Music Paused' : 'Listening to' }}
            <span class="text-foreground">{{ activities.music.name }}</span>
          </span>
        </div>
      </div>

      <!-- Large Variant -->
      <div v-else-if="variant === 'large'" class="flex flex-col gap-2">
        <GameCard v-if="activities.game?.is_running" :user-id="userId" />
        <MusicCard v-if="activities.music?.is_running" :user-id="userId" />
      </div>
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
        <div class="h-2 w-2 rounded-full shrink-0" :class="presenceDotColor"/>
        <span class="truncate capitalize">{{ displayPresenceText }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch, onUnmounted } from 'vue';
import MusicCard from '~/components/MusicCard.vue';
import GameCard from '~/components/GameCard.vue';

const props = withDefaults(defineProps<{
  userId?: string | null;
  variant?: 'small' | 'large';
  showBasicPresence?: boolean;
}>(), {
  variant: 'small',
  showBasicPresence: true
});

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const { presenceService } = useServices();
const presenceStore = usePresenceStore();

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
        // For self, the service handles throttling and pushing to server
        presenceService.refreshPresence();
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

const activities = computed(() => presenceStore.resolveActivities(props.userId as string | null));

const displayCustomStatus = computed(() => {
  // Prefer local store custom status for self
  if (isSelf.value && store.customStatus) {
    return sanitize(store.customStatus);
  }
  
  if (presenceStatusMsg.value && !presenceStatusMsg.value.startsWith('Playing ') && !presenceStatusMsg.value.startsWith('{')) {
      return sanitize(presenceStatusMsg.value);
  }
  return null;
});

const effectivePresence = computed(() => {
    if (isSelf.value) {
        // Stay online if we have a live activity, even if idle
        const { game, music } = presenceStore.resolveActivities(null);
        const hasLiveActivity = (game?.is_running && !game?.is_paused) || (music?.is_running && !music?.is_paused);
        return (store.isIdle && !hasLiveActivity) ? 'unavailable' : 'online';
    }
    return presenceStatus.value;
});

const presenceDotColor = computed(() => {
    if (effectivePresence.value === 'online') return 'bg-[var(--status-online)]';
    if (effectivePresence.value === 'unavailable') return 'bg-[var(--status-idle)]';
    return 'bg-[var(--status-offline)]';
});

const displayPresenceText = computed(() => {
    if (effectivePresence.value === 'online') return 'Online';
    if (effectivePresence.value === 'unavailable') return 'Idle';
    return 'Offline';
});

</script>
