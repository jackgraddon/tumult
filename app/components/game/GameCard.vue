<template>
  <div v-if="displayActivity" class="relative flex flex-col p-4 bg-secondary/30 border border-border/50 rounded-xl shadow-sm w-full transition-all hover:bg-secondary/40">
    <div class="flex items-center justify-between w-full mb-3">
      <span class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 flex items-center gap-1.5">
        <Icon name="solar:gamepad-bold" class="w-3.5 h-3.5" />
        Playing a game
      </span>
      <button v-if="isSelf" class="text-muted-foreground hover:text-foreground transition-colors">
        <Icon name="solar:menu-dots-bold" class="w-4 h-4" />
      </button>
    </div>

    <div class="flex items-start gap-4">
      <!-- Game Icon -->
      <div class="relative w-20 h-20 shrink-0 rounded-2xl bg-muted overflow-hidden flex items-center justify-center shadow-inner border border-border/40 group">
        <img
          v-if="iconUrl"
          :src="iconUrl"
          :alt="displayActivity.name"
          class="w-full h-full object-cover transition-transform group-hover:scale-110"
        />
        <Icon v-else name="solar:gamepad-bold" class="w-10 h-10 text-muted-foreground/20" />

        <!-- Live Indicator -->
        <div class="absolute top-1.5 left-1.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-background rounded-full shadow-sm animate-pulse"></div>
      </div>

      <!-- Game Info -->
      <div class="flex flex-col min-w-0 flex-1 py-0.5">
        <h4 class="font-bold text-[16px] leading-tight text-foreground truncate w-full tracking-tight">
          {{ displayActivity.name }}
        </h4>

        <div v-if="displayActivity.details" class="text-[13px] text-foreground/80 mt-1 truncate leading-snug">
          {{ displayActivity.details }}
        </div>

        <div v-if="displayActivity.state" class="text-[12px] text-muted-foreground mt-0.5 truncate italic">
          {{ displayActivity.state }}
        </div>

        <!-- Elapsed Timer -->
        <div v-if="gameStartTimestamp" class="flex items-center gap-1.5 mt-2.5 text-emerald-500 font-semibold text-[11px] bg-emerald-500/10 px-2 py-0.5 rounded-full w-fit">
          <span class="tabular-nums tracking-tighter">{{ elapsedDuration }} elapsed</span>
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

const displayActivity = computed(() => store.resolveActivity(props.userId));

const gameStartTimestamp = computed(() => (displayActivity.value as any)?.startTimestamp);

const iconUrl = computed(() => {
  const game = displayActivity.value;
  if (!game || !(game as any).applicationId || !(game as any).iconHash) return null;
  return `https://cdn.discordapp.com/app-icons/${(game as any).applicationId}/${(game as any).iconHash}.png?size=256`;
});

// --- Timer Logic ---
const elapsedDuration = ref('');
let timerInterval: any = null;

const updateDuration = () => {
  const start = gameStartTimestamp.value;
  if (!start) {
    elapsedDuration.value = '';
    return;
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
