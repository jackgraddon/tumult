<template>
  <div 
    ref="contentRef"
    class="message-content text-sm leading-relaxed break-words max-w-full"
    :class="[
      isOwn ? 'text-primary-foreground' : 'text-foreground',
      formattedBody ? 'formatted-html' : 'whitespace-pre-wrap'
    ]"
    style="overflow-wrap: anywhere"
    @click="handleClick"
    v-html="processedHtml"
  />
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify';

// Security Enhancement: Add rel="noopener noreferrer" to all links.
// Registered globally once to avoid redundant hook registration during re-renders.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const props = defineProps<{
  body: string;
  formattedBody?: string;
  isOwn?: boolean;
}>();

const store = useMatrixStore();
const contentRef = ref<HTMLElement | null>(null);
const blobUrls: string[] = [];

// Escape HTML for plain text rendering
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function linkify(text: string): string {
  // Basic URL regex that handles most common cases
  const urlRegex = /(https?:\/\/[^\s<]+[^.,\s<])/g;
  return text.replace(urlRegex, (url) => {
    return `<a href="${url}" class="hover:underline cursor-pointer" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

// Prepare HTML content
const processedHtml = computed(() => {
  let rawHtml = '';

  // Plain text: escape HTML entities (whitespace-pre-wrap handles newlines)
  if (!props.formattedBody) {
    const escaped = escapeHtml(props.body);
    rawHtml = linkify(escaped);
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: ['a', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 'del', 's', 'strike'],
      ALLOWED_ATTR: ['href', 'class', 'target', 'rel']
    });
  }

  // HTML formatted body: parse and clean up
  const parser = new DOMParser();
  const doc = parser.parseFromString(props.formattedBody, 'text/html');

  // Remove <mx-reply> to avoid duplicate quoted text
  doc.querySelectorAll('mx-reply').forEach(el => el.remove());

  // Clean up leading whitespace and <br> tags left after mx-reply removal
  const body = doc.body;
  while (body.firstChild) {
    const node = body.firstChild;
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      node.remove();
    } else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      node.remove();
    } else {
      break; // Stop at first real content
    }
  }

  // Remove empty <p> tags
  doc.querySelectorAll('p').forEach(p => {
    if (!p.textContent?.trim() && !p.querySelector('img, br')) {
      p.remove();
    }
  });

  // Process images with mxc:// URLs for authenticated loading
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src?.startsWith('mxc://')) {
      img.dataset.mxc = src;
      img.removeAttribute('src');
      
      const isEmote = img.hasAttribute('data-mx-emoticon');

      if (isEmote) {
        // Style it to flow seamlessly inside a sentence
        img.classList.add(
          'loading-image', 
          'inline-block', 
          'h-[1.5em]', // Scales with text size
          'w-auto', 
          'align-middle', 
          'mx-0.5',
          'opacity-50'
        );
      } else {
        // Style it as a standard, standalone embedded image attachment
        img.classList.add(
          'loading-image', 
          'block', 
          'max-w-full', 
          'h-auto', 
          'my-2', 
          'rounded-md', 
          'opacity-50'
        );
      }
    }
  });

  const result = DOMPurify.sanitize(body.innerHTML, {
    ALLOWED_TAGS: [
      'blockquote', 'pre', 'code', 'p', 'ul', 'ol', 'li', 'a',
      'h1', 'h2', 'h3', 'h4', 'br', 'img', 'span', 'del',
      's', 'strike', 'u', 'i', 'em', 'b', 'strong', 'mx-reply'
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class',
      'rel', 'data-mxc', 'data-mx-emoticon'
    ],
  });
  console.log('[MessageContent] Processed HTML:', result);
  return result;
});

// Hydrate mxc:// images with authenticated URLs
async function hydrateImages() {
  if (!contentRef.value || !store.client) return;

  const images = contentRef.value.querySelectorAll('img[data-mxc]');
  
  for (const img of images) {
    const mxcUrl = (img as HTMLElement).dataset.mxc;
    if (!mxcUrl) continue;

    // Skip if already loaded
    if (img.getAttribute('src')) continue;

    try {
      const mxcParts = mxcUrl.replace('mxc://', '').split('/');
      const serverName = mxcParts[0];
      const mediaId = mxcParts[1];
      const downloadUrl = `${store.client.baseUrl}/_matrix/client/v1/media/download/${serverName}/${mediaId}`;

      const token = store.client.getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(downloadUrl, { headers });
      if (!res.ok) throw new Error(`Auth fetch failed: ${res.status}`);

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      blobUrls.push(objectUrl);

      img.setAttribute('src', objectUrl);
      img.classList.remove('opacity-50', 'loading-image');

    } catch (err) {
      console.error('Failed to load inline image:', err);
      img.setAttribute('alt', '[Failed to load image]');
      img.classList.remove('loading-image');
    }
  }
}

// Hydrate after mount and when content changes
onMounted(async () => {
  await nextTick();
  hydrateImages();
});

watch(() => props.formattedBody, async () => {
  await nextTick();
  hydrateImages();
});

function handleClick(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a');
  if (link) {
    const href = link.getAttribute('href');
    if (href) {
      // Security: Only allow safe protocols to be opened via the system shell.
      // This prevents exploitation of dangerous custom protocol handlers.
      const isSafeProtocol = /^(https?|mailto):/i.test(href);
      if (isSafeProtocol) {
        e.preventDefault();
        const isTauri = import.meta.client && !!(window as any).__TAURI_INTERNALS__;
        if (isTauri) {
          import('@tauri-apps/plugin-shell').then(({ open }) => open(href));
        } else {
          window.open(href, '_blank', 'noopener,noreferrer');
        }
      } else {
        // For unsafe or unknown protocols, we let the browser handle it 
        // (which in Tauri/Webview usually means doing nothing or showing a warning)
        console.warn('[MessageContent] Blocked attempt to open potentially unsafe protocol:', href);
        e.preventDefault();
      }
    }
  }
}

// Cleanup blobs on unmount
onUnmounted(() => {
  blobUrls.forEach(url => URL.revokeObjectURL(url));
});
</script>

<style scoped>
/* Placeholder for loading images */
:deep(.loading-image) {
  background-color: hsl(var(--muted));
  min-height: 1em;
}

/* Style HTML content from formatted messages */
.formatted-html :deep(blockquote) {
  border-left: 3px solid hsl(var(--border));
  padding-left: 0.75rem;
  margin: 0.25rem 0;
  opacity: 0.8;
}

.formatted-html :deep(pre) {
  background: hsl(var(--muted));
  padding: 0.5rem;
  border-radius: 0.375rem;
  overflow-x: auto;
  margin: 0.25rem 0;
}

.formatted-html :deep(code) {
  font-size: 0.8em;
  background: hsl(var(--muted) / 0.5);
  padding: 0.1em 0.3em;
  border-radius: 0.25rem;
}

.formatted-html :deep(pre code) {
  background: none;
  padding: 0;
}

.formatted-html :deep(p) {
  margin: 0;
}

.formatted-html :deep(ul),
.formatted-html :deep(ol) {
  padding-left: 1.25rem;
  margin: 0.25rem 0;
}

.formatted-html :deep(a) {
  text-decoration: underline;
  opacity: 0.9;
}

.formatted-html :deep(h1),
.formatted-html :deep(h2),
.formatted-html :deep(h3),
.formatted-html :deep(h4) {
  font-weight: 600;
  margin: 0.25rem 0;
}
</style>