<script setup lang="ts">
import { ref, watch } from "vue";
import { AvatarFallback, AvatarImage, AvatarRoot } from "reka-ui";

import { useMediaResolver } from "../media.ts";
import { AvatarMedia } from "./avatarMedia.ts";

const props = defineProps<{
    /** `mxc://` URI (resolved via the shell's media resolver) or a loadable URL. */
    src?: string | null | undefined;
    label: string;
    size?: "xs" | "sm" | "md" | "lg";
}>();

const resolveMedia = useMediaResolver();

// `mxc://` can't go in an <img>: authenticated media needs the access token,
// so the shell fetches it and hands back a blob: URL. Until then — or if it
// fails — Reka's fallback shows initials. The request-id discipline lives in
// {@link AvatarMedia} so the cold-commit behaviour is unit-tested without a DOM.
const resolved = ref<string | null>(null);
const media = new AvatarMedia((url) => {
    resolved.value = url;
});
watch(
    () => [props.src, props.size] as const,
    () => media.run({ src: props.src, size: props.size, resolveMedia }),
    { immediate: true },
);

function initials(label: string): string {
    const words = label.trim().split(/\s+/);
    if (words.length >= 2) return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
    return label.slice(0, 2).toUpperCase();
}
</script>

<template>
    <AvatarRoot class="tumult-avatar" :data-size="size ?? 'md'" :aria-label="label">
        <AvatarImage v-if="resolved" class="tumult-avatar-img" :src="resolved" :alt="label" />
        <AvatarFallback class="tumult-avatar-fallback" aria-hidden="true">{{ initials(label) }}</AvatarFallback>
    </AvatarRoot>
</template>

<style scoped>
.tumult-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    background: var(--avatar-bg);
    color: var(--avatar-text);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    overflow: hidden;
    user-select: none;
}
.tumult-avatar[data-size="xs"] {
    width: var(--avatar-xs);
    height: var(--avatar-xs);
    font-size: var(--avatar-initials-size);
    border-radius: var(--radius-sm);
}
.tumult-avatar[data-size="sm"] {
    width: var(--avatar-sm);
    height: var(--avatar-sm);
}
.tumult-avatar[data-size="md"] {
    width: var(--avatar-md);
    height: var(--avatar-md);
}
.tumult-avatar[data-size="lg"] {
    width: var(--avatar-lg);
    height: var(--avatar-lg);
    font-size: var(--text-sm);
    border-radius: var(--control-radius);
}
.tumult-avatar-img {
    /* The server's thumbnail is rarely exactly the box size (Synapse snaps to
       its configured sizes), so size it to the box or it renders at natural
       size and the box crops a zoomed-in corner. */
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.tumult-avatar-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
}
</style>
