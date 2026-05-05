<template>
  <div v-if="displayActivity" class="relative flex flex-col p-4 bg-[#AA5CC3]/10 border border-[#AA5CC3]/20 rounded-xl shadow-sm w-full transition-all hover:bg-[#AA5CC3]/15">
    <div class="flex items-center justify-between w-full mb-3">
      <span class="text-[10px] font-bold uppercase tracking-widest text-[#AA5CC3] flex items-center gap-1.5">
        <Icon :name="displayActivity.is_paused ? 'solar:pause-bold' : 'solar:music-note-bold'" class="w-3.5 h-3.5" />
        {{ displayActivity.is_paused ? 'Music Paused' : 'Listening to music' }}
      </span>
    </div>

    <div class="flex items-start gap-4">
      <!-- Album Art -->
      <div class="relative w-20 h-20 shrink-0 group">
        <div class="w-20 h-20 rounded-lg bg-muted overflow-hidden flex items-center justify-center shadow-inner border border-border/40">
          <img
            v-if="displayActivity.coverUrl"
            :src="displayActivity.coverUrl"
            :alt="displayActivity.name"
            class="w-full h-full object-cover transition-transform group-hover:scale-110"
          >
          <Icon v-else name="solar:music-note-bold" class="w-10 h-10 text-muted-foreground/20" />
        </div>

        <!-- Live Indicator -->
        <div class="absolute top-1.5 left-1.5 w-2.5 h-2.5 bg-[#AA5CC3] border-2 border-background rounded-full shadow-sm animate-pulse"/>
      </div>

      <!-- Music Info -->
      <div class="flex flex-col min-w-0 flex-1 py-0.5">
        <h4 class="font-bold text-[16px] leading-tight text-foreground truncate w-full tracking-tight">
          {{ displayActivity.name }}
        </h4>

        <div v-if="displayActivity.details" class="text-[14px] font-medium text-foreground/90 mt-1 truncate leading-snug">
          {{ displayActivity.details }}
        </div>

        <!-- Progress Timer -->
        <div class="flex flex-col gap-1.5 mt-3">
          <div class="flex items-center justify-between text-[11px] font-bold tabular-nums text-[#AA5CC3]">
            <span>{{ elapsedFormatted }}</span>
            <span v-if="totalDuration">{{ durationFormatted }}</span>
          </div>
          <!-- Progress Bar -->
          <div v-if="displayActivity.duration" class="h-1.5 w-full bg-muted rounded-full overflow-hidden border border-border/20">
            <div
              class="h-full bg-[#AA5CC3] transition-all duration-1000 ease-linear"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useMatrixStore } from '~/stores/matrix';

const props = defineProps<{
  userId?: string | null;
}>();

const store = useMatrixStore();
const uiStore = useUIStore();
const presenceStore = usePresenceStore();

const isSelf = computed(() => {
  const currentUserId = store.client?.getUserId();
  return !props.userId || (currentUserId && props.userId === currentUserId);
});

const displayActivity = computed(() => presenceStore.resolveActivities(props.userId ?? null).music);

const startTime = computed(() => (displayActivity.value as any)?.startTimestamp);
const totalDuration = computed(() => (displayActivity.value as any)?.duration ? Math.floor((displayActivity.value as any).duration) : 0);
const remoteCurrentTime = computed(() => (displayActivity.value as any)?.currentTime ? Math.floor((displayActivity.value as any).currentTime) : 0);

// --- Timer Logic ---
const elapsedSeconds = ref(0);
let timerInterval: any = null;

const updateDuration = () => {
  if (!displayActivity.value) return;

  if (displayActivity.value.is_paused) {
    // If paused, the elapsed time should be locked to the reported current time
    elapsedSeconds.value = remoteCurrentTime.value;
    return;
  }

  let start = startTime.value;
  if (!start) {
    elapsedSeconds.value = remoteCurrentTime.value;
    return;
  }

  // Handle Unix seconds vs milliseconds
  if (start < 10000000000) {
    start *= 1000;
  }

  // Calculate how many seconds have passed since the "start" of the track
  // (Start time is basically now - current_pos)
  const calculatedSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));

  // Reconcile with remoteCurrentTime:
  // If we are more than 5 seconds off the last reported remote current time,
  // snap to calculated time BUT only if the remote update was recent-ish.
  // Actually, startTime (now - current_pos) is the most reliable way to
  // maintain a continuous clock between presence updates.

  elapsedSeconds.value = calculatedSeconds;

  // Cap at total duration if known
  if (totalDuration.value > 0 && elapsedSeconds.value > totalDuration.value) {
    elapsedSeconds.value = totalDuration.value;
  }
};

const formatTime = (seconds: number) => {
  const rounded = Math.floor(seconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const elapsedFormatted = computed(() => formatTime(elapsedSeconds.value));
const durationFormatted = computed(() => totalDuration.value ? formatTime(totalDuration.value) : '');

const progressPercent = computed(() => {
  if (!totalDuration.value || totalDuration.value <= 0) return 0;
  return Math.min(100, (elapsedSeconds.value / totalDuration.value) * 100);
});

onMounted(() => {
  updateDuration();
  timerInterval = setInterval(updateDuration, 1000);
});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
});

watch([startTime, remoteCurrentTime, () => displayActivity.value?.is_paused], (newVals, oldVals) => {
  updateDuration();
}, { immediate: true });
</script>
