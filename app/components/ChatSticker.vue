<template>
  <div
    class="relative inline-flex items-center justify-center w-32 h-32 sm:w-40 sm:h-40 cursor-default"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Animated image (GIF / APNG / animated WebP) -->
    <!-- Swap src on hover: thumbnail at rest, full animation on hover -->
    <!-- The browser restarts the GIF from frame 1 on every src change -->
    <img
      v-if="isAnimated && (animatedUrl || thumbnailDisplayUrl)"
      :src="isHovered ? (animatedUrl ?? thumbnailDisplayUrl) : (thumbnailDisplayUrl ?? animatedUrl)"
      :alt="alt || 'Sticker'"
      class="max-w-full max-h-full object-contain drop-shadow-md rounded-2xl"
      loading="lazy"
      @load="emit('load')"
    >

    <!-- Static image -->
    <img
      v-else-if="!isAnimated && imageUrl"
      :src="imageUrl"
      :alt="alt || 'Sticker'"
      class="max-w-full max-h-full object-contain drop-shadow-md rounded-2xl"
      loading="lazy"
      @load="emit('load')"
    >

    <!-- Loading state -->
    <div v-else-if="isLoading" class="flex items-center justify-center text-muted-foreground/50">
      <Icon name="svg-spinners:ring-resize" class="w-6 h-6" />
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex flex-col items-center justify-center text-destructive/50">
      <Icon name="solar:danger-triangle-bold" class="h-6 w-6 mb-1" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  mxcUrl?: string | null;
  encryptedFile?: any;
  alt?: string;
  mimetype?: string | null;
  // Unencrypted thumbnail mxc (shown at rest for animated stickers)
  thumbnailMxcUrl?: string | null;
  // Encrypted thumbnail (for animated stickers in encrypted rooms)
  encryptedThumbnail?: any;
}>();

const emit = defineEmits<{
  (e: 'load'): void;
}>();

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();
const isHovered = ref(false);

// --- Mimetype helper ---

const isAnimated = computed(() =>
  props.mimetype === 'image/gif' ||
  props.mimetype === 'image/apng' ||
  props.mimetype === 'image/webp'
  // WebP may or may not be animated — safe to treat as animated
  // since a static WebP in an <img> renders fine regardless
);

// --- Thumbnail (rest state for animated stickers) ---

const encryptedThumbnailUrl = ref<string | null>(null);
const encryptedThumbnailLoading = ref(false);

const validThumbnailMxc = computed(() =>
  !props.encryptedThumbnail && props.thumbnailMxcUrl ? props.thumbnailMxcUrl : null
);

const { imageUrl: standardThumbnailUrl } = useAuthenticatedMedia(
  validThumbnailMxc,
  256,
  256,
  'scale'
);

const thumbnailDisplayUrl = computed(() =>
  encryptedThumbnailUrl.value || standardThumbnailUrl.value
);

const loadEncryptedThumbnail = async () => {
  if (!props.encryptedThumbnail || !store.client) return;

  if (encryptedThumbnailUrl.value) {
    URL.revokeObjectURL(encryptedThumbnailUrl.value);
    encryptedThumbnailUrl.value = null;
  }

  encryptedThumbnailLoading.value = true;
  try {
    const response = await fetchAuthenticatedDownload(store.client, props.encryptedThumbnail.url);
    const arrayBuffer = await response.arrayBuffer();
    const decryptedBuffer = await decryptAttachment(arrayBuffer, props.encryptedThumbnail);
    const blob = new Blob([decryptedBuffer], {
      type: props.encryptedThumbnail.mimetype || 'image/png'
    });
    encryptedThumbnailUrl.value = URL.createObjectURL(blob);
  } catch (err) {
    console.warn('[ChatSticker] Thumbnail decryption failed:', err);
  } finally {
    encryptedThumbnailLoading.value = false;
  }
};

// --- Full animation URL (hover state) ---
// Bypasses thumbnail resizing — the Matrix media API strips animation frames
// when a resize is applied, so we resolve the mxc directly for the animated src.

const animatedUrl = computed(() => {
  if (!isAnimated.value) return null;
  if (props.encryptedFile) return encryptedImageUrl.value; // decrypted blob URL
  if (props.mxcUrl && store.client) {
    return store.client.mxcUrlToHttp(props.mxcUrl) ?? null;
  }
  return null;
});

// --- Main encrypted file loader (unchanged from your original) ---

const encryptedImageUrl = ref<string | null>(null);
const encryptedLoading = ref(false);
const encryptedError = ref<unknown>(null);

// Only pass to useAuthenticatedMedia for static images —
// animated images resolve their URL directly above to avoid resize stripping frames
const validStandardMxc = computed(() => {
  if (isAnimated.value) return null;
  if (!props.encryptedFile && props.mxcUrl) return props.mxcUrl;
  return null;
});

const { imageUrl: standardUrl, isLoading: standardLoading, error: standardError } = useAuthenticatedMedia(
  validStandardMxc,
  256,
  256,
  'scale'
);

const imageUrl = computed(() => encryptedImageUrl.value || standardUrl.value);
const isLoading = computed(() =>
  encryptedLoading.value ||
  standardLoading.value ||
  encryptedThumbnailLoading.value
);
const error = computed(() => encryptedError.value || standardError.value);

const loadEncrypted = async () => {
  if (!props.encryptedFile || !store.client) return;

  if (encryptedImageUrl.value) {
    URL.revokeObjectURL(encryptedImageUrl.value);
    encryptedImageUrl.value = null;
  }

  encryptedLoading.value = true;
  encryptedError.value = null;

  try {
    const response = await fetchAuthenticatedDownload(store.client, props.encryptedFile.url);
    const arrayBuffer = await response.arrayBuffer();
    const decryptedBuffer = await decryptAttachment(arrayBuffer, props.encryptedFile);
    const blob = new Blob([decryptedBuffer], {
      type: props.encryptedFile.mimetype || 'image/png'
    });
    encryptedImageUrl.value = URL.createObjectURL(blob);
  } catch (err) {
    console.error('[ChatSticker] Decryption failed:', err);
    encryptedError.value = err;
  } finally {
    encryptedLoading.value = false;
  }
};

// --- Watchers ---

watch(() => props.encryptedFile, (newFile) => {
  if (newFile) loadEncrypted();
}, { immediate: true });

watch(() => props.encryptedThumbnail, (newThumb) => {
  if (newThumb) loadEncryptedThumbnail();
}, { immediate: true });

// --- Cleanup ---

onUnmounted(() => {
  if (encryptedImageUrl.value) URL.revokeObjectURL(encryptedImageUrl.value);
  if (encryptedThumbnailUrl.value) URL.revokeObjectURL(encryptedThumbnailUrl.value);
});
</script>