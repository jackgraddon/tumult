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
// isSelf must be defined before it is used in any computed or methods
const isSelf = computed(() => !props.userId || props.userId === store.user?.userId);
const presenceStatusMsg = ref<string | null>(null);
const presenceStatus = ref<string>('offline');

// --- 2. COMPUTED ---
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

const displayActivity = computed(() => {
  if (isSelf.value && store.activityDetails?.is_running) {
    return store.activityDetails;
  }

  if (presenceStatusMsg.value) {
    const msg = presenceStatusMsg.value;
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
      return { name: namePart, is_running: true };
    }

    const commonApps = ['VS Code', 'Visual Studio Code', 'Minecraft', 'Spotify', 'Roblox'];
    for (const app of commonApps) {
        if (msg.includes(app)) return { name: app, is_running: true };
    }

    if (props.userId?.startsWith('@discord_') && msg.length < 50 && /^[A-Z]/.test(msg)) {
       return { name: msg, is_running: true };
    }
  }
  return null;
});

const displayCustomStatus = computed(() => {
  if (displayActivity.value?.is_running) return null;
  if (isSelf.value && store.customStatus) return store.customStatus;
  return presenceStatusMsg.value;
});

const gameStartTimestamp = computed(() => (displayActivity.value as any)?.startTimestamp);

const iconUrl = computed(() => {
  const game = displayActivity.value;
  if (!game || !(game as any).applicationId || !(game as any).iconHash) return null;
  const icon = (game as any).iconHash;
  if (icon.startsWith('http')) return icon;
  if (icon.startsWith('mp:')) return `https://media.discordapp.net/${icon.replace('mp:', 'external/')}`;
  return `https://cdn.discordapp.com/app-icons/${(game as any).applicationId}/${icon}.png?size=128`;
});

// --- 3. METHODS ---
const fetchPresence = () => {
    const targetUserId = props.userId || store.user?.userId;
    if (!targetUserId || !store.client) return;

    const user = store.client.getUser(targetUserId);
    if (user) {
        presenceStatusMsg.value = user.presenceStatusMsg || null;
        presenceStatus.value = user.presence || 'offline';
    }
}

const pollPresence = async () => {
    const targetUserId = props.userId || store.user?.userId;
    if (!store.client || !targetUserId) return;

    if (isSelf.value) {
        store.refreshPresence();
    }

    try {
        const data = await store.client.getPresence(targetUserId);
        if (data) {
            presenceStatus.value = data.presence || 'offline';
            presenceStatusMsg.value = data.status_msg || null;
        }
    } catch (e) {
        console.warn('[ActivityStatus] Failed to poll presence:', e);
    }
};

// --- Duration Timer Logic ---
const elapsedDuration = ref('0:00');
let timerInterval: number | null = null;
let pollInterval: number | null = null;

const updateDuration = () => {
  if (!gameStartTimestamp.value) {
    elapsedDuration.value = '0:00';
    return;
  }
  const diff = Math.max(0, Math.floor((Date.now() - gameStartTimestamp.value) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) {
    elapsedDuration.value = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  } else {
    elapsedDuration.value = `${m}:${s.toString().padStart(2, '0')}`;
  }
};

onMounted(() => {
    fetchPresence();
    if (store.client) {
        store.client.on('User.presence' as any, fetchPresence);
    }

    pollPresence();
    pollInterval = window.setInterval(pollPresence, isSelf.value ? 30000 : 300000);

    if (gameStartTimestamp.value) {
        updateDuration();
        timerInterval = window.setInterval(updateDuration, 1000);
    }
});

onUnmounted(() => {
    if (store.client) {
        store.client.removeListener('User.presence' as any, fetchPresence);
    }
    if (timerInterval) clearInterval(timerInterval);
    if (pollInterval) clearInterval(pollInterval);
});

watch([() => props.userId, () => store.user?.userId], fetchPresence);

watch(isSelf, (val) => {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = window.setInterval(pollPresence, val ? 30000 : 300000);
});

watch(gameStartTimestamp, (newVal) => {
  if (timerInterval) clearInterval(timerInterval);
  if (newVal) {
    updateDuration();
    timerInterval = window.setInterval(updateDuration, 1000);
  }
});
</script>
