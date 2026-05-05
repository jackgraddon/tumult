<template>
  <div 
    v-if="preview || youtubeEmbedUrl || directMediaInfo" 
    class="link-preview mb-1 mt-1 flex gap-3 min-w-[200px]"
  > 
    <div class="flex flex-col gap-2 flex-1 overflow-hidden">

      <!-- Author -->
      <div v-if="resolvedAuthor" class="text-xs font-semibold text-foreground">
        {{ resolvedAuthor }}
      </div>

      <!-- Title -->
      <h4 v-if="resolvedTitle" class="text-sm font-semibold hover:underline underline-offset-2 cursor-pointer">
        <a :href="url" target="_blank" rel="noopener noreferrer">{{ resolvedTitle }}</a>
      </h4>

      <!-- Description -->
      <p v-if="resolvedDescription" class="text-xs text-muted-foreground/90 leading-relaxed max-w-prose">
        {{ resolvedDescription }}
      </p>

      <!-- 1. Direct File / OpenGraph Video/Audio -->
      <div v-if="directMediaInfo" class="mt-1">
        <ChatFile
          :mxc-url="directMediaInfo.url"
          :alt="String(resolvedTitle || 'Media')"
          :mimetype="directMediaInfo.mimetype"
          :msgtype="directMediaInfo.msgtype"
        />
      </div>

      <!-- 2. YouTube Embed -->
      <div v-else-if="youtubeEmbedUrl" class="relative aspect-video w-full min-w-md overflow-hidden rounded-lg">
        <iframe
          :src="youtubeEmbedUrl"
          class="absolute inset-0 h-full w-full"
          frameborder="0"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
          allowfullscreen
        />
      </div>

      <!-- 3. Standard Image Card -->
      <div v-else-if="resolvedImage" class="relative overflow-hidden rounded-lg">
        <ChatFile 
          :mxc-url="resolvedImage" 
          :alt="resolvedTitle ? String(resolvedTitle) : 'Link preview image'"
          msgtype="m.image"
        />
      </div>
    </div>
  </div>
  <div v-else class="py-1">
    <a :href="url" target="_blank" rel="noopener noreferrer" class="text-sm hover:underline break-all opacity-80">{{ url }}</a>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { IPreviewUrlResponse } from 'matrix-js-sdk';
import ChatFile from '~/components/ChatFile.vue';

const props = defineProps<{
  url: string;
  timestamp: number;
  isOwn?: boolean;
}>();

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();
const preview = ref<IPreviewUrlResponse | null>(null);

const resolvedTitle = computed(() => preview.value?.['og:title'] || preview.value?.['title'] || preview.value?.['twitter:title']);
const resolvedDescription = computed(() => preview.value?.['og:description'] || preview.value?.['description'] || preview.value?.['twitter:description']);
const resolvedAuthor = computed(() => preview.value?.['author_name'] || preview.value?.['og:article:author'] || preview.value?.['twitter:creator']);
const resolvedImage = computed(() => {
  const img = preview.value?.['og:image'] || preview.value?.['image'] || preview.value?.['matrix:image:url'] || preview.value?.['twitter:image'];
  return typeof img === 'string' ? img : undefined;
});

// --- Media Router Logic ---

const isYouTube = computed(() => props.url.includes('youtube.com') || props.url.includes('youtu.be'));

const directMediaInfo = computed(() => {
  const urlStr = props.url.toLowerCase();
  
  // 1. Check direct file extensions
  if (urlStr.endsWith('.mp4') || urlStr.endsWith('.webm') || urlStr.endsWith('.ogv')) {
    return { url: props.url, mimetype: 'video/mp4', msgtype: 'm.video' };
  }
  if (urlStr.endsWith('.mp3') || urlStr.endsWith('.wav') || urlStr.endsWith('.ogg')) {
    return { url: props.url, mimetype: 'audio/mpeg', msgtype: 'm.audio' };
  }
  if (urlStr.endsWith('.png') || urlStr.endsWith('.jpg') || urlStr.endsWith('.jpeg') || urlStr.endsWith('.gif') || urlStr.endsWith('.webp')) {
    return { url: props.url, mimetype: 'image/jpeg', msgtype: 'm.image' };
  }

  // 2. Check OpenGraph Video/Audio from Synapse scrape
  // Exclude YouTube here so it uses the dedicated embed logic
  if (isYouTube.value) return null;

  const ogVideo = preview.value?.['og:video:url'] || preview.value?.['og:video'] || preview.value?.['matrix:video:url'];
  if (ogVideo) {
    return { url: String(ogVideo), mimetype: 'video/mp4', msgtype: 'm.video' };
  }

  const ogAudio = preview.value?.['og:audio:url'] || preview.value?.['og:audio'] || preview.value?.['matrix:audio:url'];
  if (ogAudio) {
    return { url: String(ogAudio), mimetype: 'audio/mpeg', msgtype: 'm.audio' };
  }

  return null;
});

const youtubeEmbedUrl = computed(() => {
  if (!isYouTube.value) return null;
  try {
    const urlObj = new URL(props.url);
    let videoId = '';
    if (urlObj.hostname.includes('youtube.com')) {
      videoId = urlObj.searchParams.get('v') || '';
    } else if (urlObj.hostname.includes('youtu.be')) {
      videoId = urlObj.pathname.slice(1);
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  } catch {
    return null;
  }
});

async function fetchPreview() {
  if (!store.client) return;
  
  try {
    const res = await store.client.getUrlPreview(props.url, props.timestamp);
    if (res && (res['og:title'] || res['title'] || res['author_name'] || res['og:image'] || res['image'] || res['og:video:url'] || res['og:audio:url'])) {
      preview.value = res;
    }
  } catch (err) {
    console.error('Failed to fetch URL preview:', err);
  }
}

onMounted(() => {
  fetchPreview();
});

watch(() => props.url, () => {
  fetchPreview();
});
</script>
