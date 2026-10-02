<script setup lang="ts">
import { ref, watch } from "vue";
import { AvatarFallback, AvatarImage, AvatarRoot } from "reka-ui";

import { useMediaResolver } from "../media.ts";

const props = defineProps<{
    /** `mxc://` URI (resolved via the shell's media resolver) or a loadable URL. */
    src?: string | null | undefined;
    label: string;
    size?: "sm" | "md" | "lg";
}>();

const PX = { sm: 24, md: 32, lg: 48 } as const;
const resolveMedia = useMediaResolver();

// `mxc://` can't go in an <img>: authenticated media needs the access token,
// so the shell fetches it and hands back a blob: URL. Until then — or if it
// fails — Reka's fallback shows initials.
const resolved = ref<string | null>(null);
watch(
    () => [props.src, props.size] as const,
    ([src, size], _old, onCleanup) => {
        let stale = false;
        onCleanup(() => {
            stale = true;
        });
        resolved.value = null;
        if (!src) return;
        if (!src.startsWith("mxc://")) {
            resolved.value = src;
            return;
        }
        if (!resolveMedia) return;
        resolveMedia(src, PX[size ?? "md"]).then(
            (url) => {
                if (!stale) resolved.value = url;
            },
            () => {
                // Leave the initials fallback in place.
            },
        );
    },
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
        <AvatarImage v-if="resolved" :src="resolved" :alt="label" />
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
    color: var(--button-primary-text);
    font-size: var(--text-xs);
    font-weight: 600;
    overflow: hidden;
    user-select: none;
}
.tumult-avatar[data-size="sm"] {
    width: 24px;
    height: 24px;
}
.tumult-avatar[data-size="md"] {
    width: 32px;
    height: 32px;
}
.tumult-avatar[data-size="lg"] {
    width: 48px;
    height: 48px;
    font-size: var(--text-sm);
    border-radius: var(--control-radius);
}
.tumult-avatar-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
}
</style>
