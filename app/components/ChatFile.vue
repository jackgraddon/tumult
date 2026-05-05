<template>
  <div class="chat-file-container w-full">
    
    <!-- Image Player -->
    <div v-if="isImage" class="relative overflow-hidden rounded-lg bg-muted/20" :style="placeholderStyle">
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-black/5 backdrop-blur-sm z-10">
        <Icon name="svg-spinners:ring-resize" class="h-6 w-6 text-primary" />
      </div>
      <img
        v-if="finalImageUrl"
        :src="finalImageUrl"
        :alt="alt || 'Image'"
        class="max-w-full h-auto object-contain rounded-md cursor-zoom-in hover:opacity-90 transition-opacity"
        :width="displayWidth || undefined"
        :height="displayHeight || undefined"
        loading="lazy"
        @click="uiStore.openMediaPreview({ url: finalImageUrl, type: 'image', alt: alt })"
      >
      <div v-else-if="!isLoading" class="w-full h-48 flex items-center justify-center text-muted-foreground text-sm bg-muted/50">
        <span>Failed to load image</span>
      </div>
    </div>

    <!-- Video Player -->
    <div v-else-if="isVideo" class="relative overflow-hidden rounded-lg border border-border bg-black/5 max-w-[400px]">
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-sm z-10">
        <Icon name="svg-spinners:ring-resize" class="h-6 w-6 text-primary" />
      </div>
      <video 
        v-if="finalImageUrl"
        :src="finalImageUrl" 
        :controls="!isGif"
        :autoplay="isGif || props.info?.['fi.mau.autoplay']"
        :loop="isGif || props.info?.['fi.mau.loop']"
        :muted="isGif || props.info?.['fi.mau.no_audio']"
        playsinline
        class="w-full max-h-[400px] object-contain cursor-zoom-in"
        preload="metadata"
        @error="handleVideoError"
        @click="uiStore.openMediaPreview({ url: finalImageUrl, type: 'video', alt: alt })"
      />
      <div v-else class="w-full h-48 flex items-center justify-center text-muted-foreground text-sm">
        <span v-if="!isLoading">Failed to load video</span>
      </div>
    </div>

    <!-- Audio Player -->
    <div v-else-if="isAudio" class="relative rounded-lg border border-border bg-card p-2 min-w-[250px] max-w-[400px]">
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-black/5 backdrop-blur-sm z-10 rounded-lg">
        <Icon name="svg-spinners:ring-resize" class="h-5 w-5 text-primary" />
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted-foreground truncate px-1">{{ alt || 'Audio File' }}</span>
        <audio v-if="finalImageUrl" :src="finalImageUrl" controls class="w-full h-10"/>
      </div>
    </div>

    <!-- Generic File Card -->
    <div v-else class="flex items-center justify-between p-3 rounded-md bg-muted/50 border min-w-[250px] max-w-sm gap-3">
      <div class="flex items-center gap-3 overflow-hidden">
        <div class="flex items-center justify-center w-10 h-10 rounded bg-background shrink-0 text-muted-foreground shadow-sm">
          <Icon name="solar:document-text-bold" class="w-6 h-6" />
        </div>
        <div class="flex flex-col overflow-hidden">
          <span class="text-sm font-medium truncate" :title="alt || 'File'">{{ alt || 'File' }}</span>
          <span class="text-[10px] text-muted-foreground uppercase mt-0.5">
            {{ encryptedFile ? 'Encrypted File' : 'File' }}
          </span>
        </div>
      </div>
      
      <UiButton 
        variant="secondary" 
        size="sm" 
        class="shrink-0 h-8 rounded-full px-3"
        :disabled="isDownloading"
        @click="downloadFile"
      >
        <Icon v-if="isDownloading" name="svg-spinners:ring-resize" class="h-4 w-4 mr-1.5" />
        <Icon v-else name="solar:download-linear" class="h-4 w-4 mr-1.5" />
        <span>{{ isDownloading ? '...' : 'Save' }}</span>
      </UiButton>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { toast } from 'vue-sonner';
import { fetchAuthenticatedDownload, decryptAttachment } from '~/utils/matrix-media';

const props = defineProps<{
  mxcUrl?: string;
  encryptedFile?: any;
  alt?: string;
  mimetype?: string;
  msgtype?: string;
  info?: any;
  // Dimension props primarily for images
  maxWidth?: number;
  maxHeight?: number;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
}>();

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();

// --- 1. Media Type Detection ---
const isImage = computed(() => props.mimetype?.startsWith('image/') || props.msgtype === 'm.image');
const isVideo = computed(() => props.mimetype?.startsWith('video/') || props.msgtype === 'm.video');
const isAudio = computed(() => props.mimetype?.startsWith('audio/') || props.msgtype === 'm.audio');
const isInlineMedia = computed(() => isImage.value || isVideo.value || isAudio.value);

const isGif = computed(() => {
  // Matrix-style GIF detection
  return isVideo.value && (
    props.info?.['fi.mau.gif'] === true || 
    props.info?.['fi.mau.discord.gifv'] === true
  );
});

// --- 2. State & Hooks ---
const internalMediaUrl = ref<string | null>(null);
const isMediaLoading = ref(false);
const isDownloading = ref(false);

// Use standard hook for unencrypted images to get thumbnails
const validStandardMxc = computed(() => {
  if (isImage.value && !props.encryptedFile && props.mxcUrl?.startsWith('mxc://')) {
    return props.mxcUrl;
  }
  return null;
});

const { imageUrl: standardUrl, isLoading: standardLoading } = useAuthenticatedMedia(
  validStandardMxc,
  props.maxWidth || 800,
  props.maxHeight || 600,
  'scale'
);

// Unified URL & Loading State
const finalImageUrl = computed(() => {
  if (isImage.value && standardUrl.value) return standardUrl.value;
  return internalMediaUrl.value;
});

const isLoading = computed(() => isMediaLoading.value || (isImage.value && standardLoading.value));

// --- 3. Dimension Handling (For Images) ---
const displayWidth = computed(() => {
  if (!props.intrinsicWidth || !props.intrinsicHeight) return null;
  const maxW = props.maxWidth || 400;
  return Math.min(props.intrinsicWidth, maxW);
});

const displayHeight = computed(() => {
  if (!props.intrinsicWidth || !props.intrinsicHeight) return null;
  const maxW = props.maxWidth || 400;
  if (props.intrinsicWidth <= maxW) return props.intrinsicHeight;
  return Math.round(props.intrinsicHeight * (maxW / props.intrinsicWidth));
});

const placeholderStyle = computed(() => {
  if (!isImage.value || !displayWidth.value || !displayHeight.value) return {};
  return {
    width: `${displayWidth.value}px`,
    aspectRatio: `${displayWidth.value} / ${displayHeight.value}`,
  };
});

// --- 4. Memory Management ---
onUnmounted(() => {
  if (internalMediaUrl.value && internalMediaUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(internalMediaUrl.value);
  }
});

// --- 5. Loading Logic ---

// We check if the SW is actually controlling the page before using the proxy.
// If it's not, the proxy URL will 404.
const isSWActive = computed(() => !!(import.meta.client && navigator.serviceWorker?.controller));

const loadMedia = async () => {
  if (!isInlineMedia.value || !store.client) return;

  // FAST PATH: Unencrypted (Streaming / Direct Web URLs)
  if (props.mxcUrl && !props.encryptedFile) {
    if (props.mxcUrl.startsWith('mxc://')) {
      // For images, useAuthenticatedMedia (standardUrl) handles the thumbnailing
      // For video/audio, we use the Service Worker proxy for authenticated streaming
      if (!isImage.value) {
        if (isSWActive.value) {
          const mxcParts = props.mxcUrl.replace('mxc://', '').split('/');
          const serverName = mxcParts[0];
          const mediaId = mxcParts[1];
          const matrixMediaUrl = `${store.client.baseUrl}/_matrix/client/v1/media/download/${serverName}/${mediaId}`;
          const accessToken = store.client.getAccessToken();

          const proxyData = btoa(JSON.stringify({
            mediaUrl: matrixMediaUrl,
            accessToken
          }));
          
          internalMediaUrl.value = `/_media_proxy/?data=${encodeURIComponent(proxyData)}`;
        } else {
          // If SW is not active yet, fall back to full download (blob)
          await loadMediaViaBlob();
        }
      }
    } else {
      // Direct web URL (https://...) - use as-is
      internalMediaUrl.value = props.mxcUrl;
    }
    return;
  }

  // SLOW PATH: Encrypted (Decryption required)
  if (props.encryptedFile && props.encryptedFile.url) {
    await loadMediaViaBlob();
  }
};

const loadMediaViaBlob = async () => {
  if (internalMediaUrl.value) {
    URL.revokeObjectURL(internalMediaUrl.value);
    internalMediaUrl.value = null;
  }

  isMediaLoading.value = true;
  try {
    let blob: Blob;

    if (props.encryptedFile && props.encryptedFile.url) {
      const mxc = props.encryptedFile.url;
      const response = await fetchAuthenticatedDownload(store.client, mxc);
      const arrayBuffer = await response.arrayBuffer();
      const decryptedBuffer = await decryptAttachment(arrayBuffer, props.encryptedFile);
      
      const mimetype = props.encryptedFile.mimetype || props.mimetype || 'application/octet-stream';
      blob = new Blob([decryptedBuffer], { type: mimetype });
    } else if (props.mxcUrl) {
      const response = await fetchAuthenticatedDownload(store.client, props.mxcUrl);
      blob = await response.blob();
    } else {
      return;
    }
    
    internalMediaUrl.value = URL.createObjectURL(blob);
  } catch (err) {
    console.error('Failed to load media via blob fallback:', err);
  } finally {
    isMediaLoading.value = false;
  }
};

const handleVideoError = async (e: Event) => {
  const video = e.target as HTMLVideoElement;
  if (!video.src) return;

  // If the proxy URL failed, and we're not already using a blob, try falling back to blob.
  if (video.src.includes('/_media_proxy/') && !internalMediaUrl.value?.startsWith('blob:')) {
    console.warn('[ChatFile] Video proxy failed, falling back to blob...', video.error);
    await loadMediaViaBlob();
  }
};

onMounted(loadMedia);
watch(() => props.encryptedFile, loadMedia);

// --- 6. Manual File Download ---
async function downloadFile() {
  if (!store.client) return;

  isDownloading.value = true;
  try {
    let blob: Blob;

    if (props.encryptedFile && props.encryptedFile.url) {
      const mxcUrl = props.encryptedFile.url;
      const response = await fetchAuthenticatedDownload(store.client, mxcUrl);
      const arrayBuffer = await response.arrayBuffer();
      const decryptedBuffer = await decryptAttachment(arrayBuffer, props.encryptedFile);
      
      const mimetype = props.encryptedFile.mimetype || props.mimetype || 'application/octet-stream';
      blob = new Blob([decryptedBuffer], { type: mimetype });
    } else if (props.mxcUrl) {
      const response = await fetchAuthenticatedDownload(store.client, props.mxcUrl);
      blob = await response.blob();
    } else {
      throw new Error('No URL provided');
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = props.alt || 'downloaded_file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('File downloaded');

  } catch (err: any) {
    console.error('Download error:', err);
    toast.error(`Download failed: ${err.message || 'Unknown error'}`);
  } finally {
    isDownloading.value = false;
  }
}
</script>
