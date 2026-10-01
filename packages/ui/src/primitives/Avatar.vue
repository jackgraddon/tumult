<script setup lang="ts">
import { AvatarFallback, AvatarImage, AvatarRoot } from "reka-ui";

defineProps<{
    src?: string | null | undefined;
    label: string;
    size?: "sm" | "md" | "lg";
}>();

function initials(label: string): string {
    const words = label.trim().split(/\s+/);
    if (words.length >= 2) return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
    return label.slice(0, 2).toUpperCase();
}
</script>

<template>
    <AvatarRoot class="tumult-avatar" :data-size="size ?? 'md'" :aria-label="label">
        <AvatarImage v-if="src" :src="src" :alt="label" />
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
