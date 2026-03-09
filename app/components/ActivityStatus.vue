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
            
            <div v-if="displayActivity.details" class="text-xs text-muted-foreground mt-1 truncate">
              {{ displayActivity.details }}
            </div>

            <div v-if="displayActivity.state" class="text-xs text-muted-foreground mt-0.5 truncate">
              {{ displayActivity.state }}
              <span v-if="displayActivity.partySize && displayActivity.partyMax">
                ({{ displayActivity.partySize }} of {{ displayActivity.partyMax }})
              </span>
            </div>

            <div v-if="gameStartTimestamp" class="flex items-center gap-1.5 mt-1.5 text-emerald-500 font-medium text-xs">
              <Icon name="solar:gamepad-bold" class="w-3.5 h-3.5 shrink-0" />
              <span class="tabular-nums tracking-tight">{{ elapsedDuration }}</span>
            </div>
            <div v-else-if="!displayActivity.details && !displayActivity.state" class="text-xs text-muted-foreground mt-1 truncate">
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

// --- 1. CORE STATE ---
const isSelf = computed(() => !props.userId || props.userId === store.user?.userId);
const presenceStatusMsg = ref<string | null>(null);
const presenceStatus = ref<string>('offline');

// --- 2. COMPUTED ---
const displayActivity = computed(() => {
  // Prefer local store details for self if running
  if (isSelf.value && store.activityDetails?.is_running) {
    return store.activityDetails;
  }

  if (presenceStatusMsg.value) {
    const msg = presenceStatusMsg.value;

    // 1. Check for known activity prefixes
    const prefixes = ['Playing ', '🎮 ', '🕹️ ', 'Game: ', 'Now Playing: '];
    let foundPrefix = null;
    for (const prefix of prefixes) {
      if (msg.startsWith(prefix)) {
        foundPrefix = prefix;
        break;
      }
    }

    if (foundPrefix) {
      const fullStatus = msg.substring(foundPrefix.length);
      const namePart = fullStatus.split(':')[0].split('(')[0].split(' - ')[0].trim();

      console.log(`[ActivityStatus] Detected game via prefix (${foundPrefix}): ${namePart}`);

      return {
          name: namePart,
          is_running: true
      };
    }

    // 2. Check for common apps/games (Heuristic for bridges without prefixes)
    const commonApps = [
        'Visual Studio Code', 'VS Code', 'IntelliJ', 'WebStorm', 'Cursor',
        'Minecraft', 'Roblox', 'League of Legends', 'Valorant', 'Counter-Strike',
        'Steam', 'Epic Games', 'Battle.net', 'Spotify', 'Apple Music', 'YouTube Music'
    ];
    for (const app of commonApps) {
        if (msg.includes(app)) {
            return {
                name: app,
                is_running: true
            };
        }
    }

    // 3. Fallback: If the message looks like a game (short, title case), treat as activity
    // but only if it's from a bridge (heuristic: user id starts with @discord_)
    if (props.userId?.startsWith('@discord_') && msg.length < 50 && /^[A-Z]/.test(msg)) {
       return {
           name: msg,
           is_running: true
       };
    }
  }
  return null;
});

const displayCustomStatus = computed(() => {
  // Prefer local store custom status for self
  if (isSelf.value && store.customStatus) {
    return store.customStatus;
  }

  if (presenceStatusMsg.value) {
    const msg = presenceStatusMsg.value;

    // If it's currently detected as an activity, don't show as custom status
    if (displayActivity.value?.is_running) {
        return null;
    }

    return msg;
  }
  return null;
});

const gameStartTimestamp = computed(() => (displayActivity.value as any)?.startTimestamp);

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

// --- 3. METHODS ---
const fetchPresence = () => {
    const targetUserId = props.userId || store.user?.userId;
    if (!targetUserId || !store.client) {
        // If we are looking at self and store.user isn't ready yet, don't clear
        if (!props.userId && !store.user?.userId) return;

        presenceStatusMsg.value = null;
        presenceStatus.value = 'offline';
        return;
    }
    const user = store.client.getUser(targetUserId);
    if (user) {
        if (isSelf.value) {
            console.log(`[ActivityStatus] Self presence: status="${user.presenceStatusMsg}", state="${user.presence}"`);
        }
        presenceStatusMsg.value = user.presenceStatusMsg || null;
        presenceStatus.value = user.presence || 'offline';
    } else {
        if (isSelf.value) {
            console.warn(`[ActivityStatus] Could not find User object for self (${targetUserId})`);
        }
        presenceStatusMsg.value = null;
        presenceStatus.value = 'offline';
    }
}

const handlePresenceEvent = (event: any, user: any) => {
    const targetUserId = props.userId || store.user?.userId;
    if (user && user.userId === targetUserId) {
        presenceStatusMsg.value = user.presenceStatusMsg || null;
        presenceStatus.value = user.presence || 'offline';
    }
}

const pollPresence = async () => {
    const targetUserId = props.userId || store.user?.userId;
    if (!store.client || !targetUserId) return;

    if (isSelf.value) {
        // For self, the store handles throttling and pushing to server
        store.refreshPresence();

        // Also fetch from server to catch bridge updates
        try {
            const data = await store.client.getPresence(store.user?.userId);
            if (data) {
                presenceStatus.value = data.presence || 'offline';
                presenceStatusMsg.value = data.status_msg || null;
            }
        } catch (e) {
            // Fallback to local user object
            const user = store.client.getUser(props.userId);
            if (user) {
                presenceStatus.value = user.presence || 'offline';
                presenceStatusMsg.value = user.presenceStatusMsg || null;
            }
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

    // Poll self presence more frequently to catch bridge updates quickly
    // For others, 5 minutes is fine. For self, let's do 30 seconds.
    pollPresence();
    pollInterval = window.setInterval(pollPresence, isSelf.value ? 30000 : 300000);
});

watch(isSelf, (val) => {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = window.setInterval(pollPresence, val ? 30000 : 300000);
});

onUnmounted(() => {
    if (store.client) {
        store.client.removeListener('User.presence' as any, handlePresenceEvent);
    }
    if (timerInterval) clearInterval(timerInterval);
    if (pollInterval) clearInterval(pollInterval);
});

watch([() => props.userId, () => store.user?.userId], fetchPresence);

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
