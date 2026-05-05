<template>
  <div v-if="displayActivity" class="relative flex flex-col p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl shadow-sm w-full transition-all hover:bg-emerald-500/15">
    <div class="flex items-center justify-between w-full mb-3">
      <span class="text-[10px] font-bold uppercase tracking-widest text-emerald-500 flex items-center gap-1.5">
        <Icon name="solar:gamepad-bold" class="w-3.5 h-3.5" />
        Playing a game
      </span>
    </div>

    <div class="flex items-start gap-4">
      <!-- Game Icon -->
      <div class="relative w-20 h-20 shrink-0 group">
        <div class="w-20 h-20 rounded-2xl bg-muted overflow-hidden flex items-center justify-center shadow-inner border border-border/40">
          <img 
            v-if="iconUrl" 
            :src="iconUrl" 
            :alt="displayActivity.name"
            class="w-full h-full object-cover transition-transform group-hover:scale-110"
          >
          <Icon v-else name="solar:gamepad-bold" class="w-10 h-10 text-muted-foreground/20" />
        </div>
        
        <!-- Small Overlay Icon -->
        <div v-if="smallIconUrl" class="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-background border-2 border-background overflow-hidden shadow-sm">
          <img :src="smallIconUrl" class="w-full h-full object-cover" >
        </div>
        
        <!-- Live Indicator -->
        <div class="absolute top-1.5 left-1.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-background rounded-full shadow-sm animate-pulse"/>
      </div>

      <!-- Game Info -->
      <div class="flex flex-col min-w-0 flex-1 py-0.5">
        <h4 class="font-bold text-[16px] leading-tight text-foreground truncate w-full tracking-tight">
          {{ displayActivity.name }}
        </h4>
        
        <div v-if="displayActivity.details" class="text-[14px] font-medium text-foreground/90 mt-1 truncate leading-snug">
          {{ displayActivity.details }}
        </div>
        
        <div v-if="displayActivity.state" class="text-[13px] text-muted-foreground mt-0.5 truncate">
          {{ displayActivity.state }}
        </div>
        
        <!-- Elapsed Timer -->
        <div v-if="gameStartTimestamp" class="flex items-center gap-1.5 mt-2 text-emerald-500 font-bold text-[12px]">
          <Icon name="solar:gamepad-bold" class="w-4 h-4 shrink-0" />
          <span class="tabular-nums tracking-tighter">{{ elapsedDuration }}</span>
        </div>
        <div v-else class="text-[11px] text-muted-foreground/70 mt-2 flex items-center gap-1">
           <Icon name="solar:clock-circle-bold" class="w-3 h-3" />
           Currently in-game
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';

const props = defineProps<{
  userId?: string | null;
}>();

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();

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

const displayActivity = computed(() => presenceStore.resolveActivities(props.userId ?? null).game);

const gameStartTimestamp = computed(() => (displayActivity.value as any)?.startTimestamp);

const isSnowflake = (id: string) => /^\d{17,20}$/.test(id);

const iconUrl = computed(() => {
  const game = displayActivity.value;
  if (!game || !(game as any).applicationId || !(game as any).iconHash) return null;
  
  const icon = (game as any).iconHash;
  const appId = (game as any).applicationId;

  // External assets from RPC
  if (icon.startsWith('mp:external/')) {
     return `https://media.discordapp.net/${icon.replace('mp:', '')}`;
  }
  
  // Custom application assets (often used for RPC icons)
  if (icon.startsWith('spotify:')) {
     return `https://i.scdn.co/image/${icon.replace('spotify:', '')}`;
  }

  // If the icon is a Snowflake ID (numeric), it's a rich presence asset
  if (isSnowflake(icon)) {
    return `https://cdn.discordapp.com/app-assets/${appId}/${icon}.png?size=256`;
  }

  // Otherwise, assume it's an application icon hash (hex)
  return `https://cdn.discordapp.com/app-icons/${appId}/${icon}.png?size=256`;
});

const smallIconUrl = computed(() => {
  const game = displayActivity.value;
  if (!game || !(game as any).applicationId || !(game as any).smallIconHash) return null;
  
  const icon = (game as any).smallIconHash;
  const appId = (game as any).applicationId;

  if (isSnowflake(icon)) {
    return `https://cdn.discordapp.com/app-assets/${appId}/${icon}.png?size=128`;
  }
  
  return `https://cdn.discordapp.com/app-icons/${appId}/${icon}.png?size=128`;
});

// --- Timer Logic ---
const elapsedDuration = ref('');
let timerInterval: any = null;

const updateDuration = () => {
  let start = gameStartTimestamp.value;
  if (!start) {
    elapsedDuration.value = '';
    return;
  }

  // Handle Unix seconds vs milliseconds (arRPC standard is ms, but some games/bridges might use s)
  if (start < 10000000000) {
    start *= 1000;
  }
  
  const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
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
  updateDuration();
  timerInterval = setInterval(updateDuration, 1000);
});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
});

watch(gameStartTimestamp, (newVal) => {
  if (newVal) updateDuration();
});
</script>
