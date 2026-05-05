<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-vue-next';

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();

const media = computed(() => uiStore.mediaPreview);
const isOpen = computed({
  get: () => !!media.value,
  set: (val) => {
    if (!val) uiStore.closeMediaPreview();
  }
});

// --- Zoom and Pan State ---
const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);
const isDragging = ref(false);
const isInteracting = ref(false);
const startPos = ref({ x: 0, y: 0 });
let interactionTimeout: any = null;

function setInteracting() {
  isInteracting.value = true;
  if (interactionTimeout) clearTimeout(interactionTimeout);
  interactionTimeout = setTimeout(() => {
    isInteracting.value = false;
  }, 150);
}

onUnmounted(() => {
  if (interactionTimeout) clearTimeout(interactionTimeout);
});

function resetTransform() {
  scale.value = 1;
  translateX.value = 0;
  translateY.value = 0;
}

// Reset on open/change
watch(() => media.value?.url, resetTransform);
watch(isOpen, (val) => {
  if (val) resetTransform();
});

function close() {
  uiStore.closeMediaPreview();
}

// --- Zoom Logic ---
function zoomIn() {
  scale.value = Math.min(10, scale.value * 1.5);
}

function zoomOut() {
  scale.value = Math.max(0.1, scale.value / 1.5);
  if (scale.value <= 1) resetTransform();
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  setInteracting();
  
  const zoomSpeed = 0.001;
  const delta = -e.deltaY;
  const oldScale = scale.value;
  // Exponential zoom for consistency
  const newScale = Math.max(0.1, Math.min(10, oldScale + (delta * zoomSpeed * oldScale)));
  
  if (newScale === oldScale) return;

  // Zoom towards mouse point
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const mouseX = e.clientX - rect.left - rect.width / 2;
  const mouseY = e.clientY - rect.top - rect.height / 2;

  const ratio = newScale / oldScale;
  translateX.value = mouseX - (mouseX - translateX.value) * ratio;
  translateY.value = mouseY - (mouseY - translateY.value) * ratio;
  
  scale.value = newScale;

  if (newScale <= 1) resetTransform();
}

// --- Panning Logic ---
function handlePointerDown(e: PointerEvent) {
  if (scale.value <= 1) return;
  isDragging.value = true;
  startPos.value = { x: e.clientX - translateX.value, y: e.clientY - translateY.value };
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  translateX.value = e.clientX - startPos.value.x;
  translateY.value = e.clientY - startPos.value.y;
}

function handlePointerUp() {
  isDragging.value = false;
}

const transformStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  // CRITICAL: Disable transition during active interaction to eliminate "jumping" and lag.
  transition: (isDragging.value || isInteracting.value) ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0, 0.2, 1)',
  cursor: scale.value > 1 ? (isDragging.value ? 'grabbing' : 'grab') : 'default'
}));
</script>

<template>
  <UiDialog v-model:open="isOpen">
    <UiDialogContent
      class="fixed inset-0 z-[200] flex items-center justify-center !translate-x-0 !translate-y-0 !top-0 !left-0 !right-0 !bottom-0 !max-w-none sm:!max-w-none !bg-transparent !border-none !shadow-none !rounded-none p-0 outline-none focus:outline-none overflow-hidden"
      :show-close-button="false"
      @pointer-down-outside="close"
      @interact-outside="close"
    >
      <!-- Custom Background (Shadcn overlay is too simple, so we layer our own blur behind the content) -->
      <div 
        class="fixed inset-0 bg-neutral-950/90 backdrop-blur-xl z-[-1] transition-opacity duration-300 pointer-events-auto"
        @click="close"
      />

      <!-- Toolbar -->
      <div class="absolute top-6 right-6 flex items-center gap-2 z-[110] animate-in fade-in slide-in-from-right-4 duration-500">
        <!-- Zoom Controls -->
        <div class="flex items-center gap-1 bg-neutral-900/40 backdrop-blur-md rounded-full border border-white/5 p-1 shadow-2xl">
          <button 
            class="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-all outline-none"
            title="Zoom Out"
            @click="zoomOut"
          >
            <ZoomOut class="w-4.5 h-4.5" />
          </button>
          <span class="text-[10px] font-mono font-bold text-white/40 min-w-10 text-center select-none">
            {{ Math.round(scale * 100) }}%
          </span>
          <button 
            class="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-all outline-none"
            title="Zoom In"
            @click="zoomIn"
          >
            <ZoomIn class="w-4.5 h-4.5" />
          </button>
          <div class="w-px h-4 bg-white/10 mx-1" />
          <button 
            class="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-all outline-none"
            title="Reset Zoom"
            @click="resetTransform"
          >
            <Maximize2 class="w-4.5 h-4.5" />
          </button>
        </div>

        <!-- Close Button -->
        <button 
          class="p-3 rounded-full bg-neutral-900/40 backdrop-blur-md hover:bg-white/10 text-white/50 hover:text-white transition-all outline-none border border-white/5 hover:scale-110 active:scale-95 group shadow-2xl"
          title="Close (Esc)"
          @click="close"
        >
          <X class="w-5.5 h-5.5" />
        </button>
      </div>

      <div 
        class="relative w-full h-full p-4 md:p-12 flex items-center justify-center overflow-hidden outline-none" 
        @click.self="close"
        @wheel.passive="handleWheel"
      >
        <!-- Media Container with Pan/Zoom -->
        <div 
          class="relative w-full h-full flex items-center justify-center pointer-events-none"
          :style="transformStyle"
        >
          <!-- Image Preview -->
          <img 
            v-if="media?.type === 'image'" 
            :src="media.url" 
            :alt="media.alt" 
            class="max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] object-contain shadow-[0_0_80px_rgba(0,0,0,0.8)] rounded-sm select-none pointer-events-auto"
            @click.stop
            @pointerdown="handlePointerDown"
            @pointermove="handlePointerMove"
            @pointerup="handlePointerUp"
            @pointercancel="handlePointerUp"
          >
          
          <!-- Video Preview -->
          <video 
            v-else-if="media?.type === 'video'" 
            :src="media.url" 
            controls 
            autoplay 
            class="max-w-[min(100%,1400px)] max-h-full object-contain shadow-[0_0_80px_rgba(0,0,0,0.8)] rounded-sm pointer-events-auto"
            @click.stop
            @pointerdown="handlePointerDown"
            @pointermove="handlePointerMove"
            @pointerup="handlePointerUp"
            @pointercancel="handlePointerUp"
          />
        </div>
        
        <!-- Caption / Info -->
        <div 
          v-if="media?.alt && scale <= 1.05" 
          class="absolute bottom-10 left-1/2 -translate-x-1/2 bg-neutral-950/40 backdrop-blur-md px-6 py-3 rounded-2xl text-white/90 text-sm font-medium border border-white/5 shadow-2xl pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          {{ media.alt }}
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>

<style scoped>
/* Ensure the dialog takes up the full viewport and doesn't scroll behind */
:deep(body) {
  overflow: hidden;
}

/* Base entry animation for Content */
[data-state='open'] {
  animation: modal-overlay-show 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modal-overlay-show {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
