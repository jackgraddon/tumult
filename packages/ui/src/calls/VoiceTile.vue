<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { ChatClient, VoiceVideoSource } from "@tumult/core";

// One participant's video, drawn by the client into a <video> we own. Mounted
// only while the track is live (the participant's `camera`/`screen` flag), so
// "there is a track to attach" holds on mount and no retry is needed; a flag
// that flips off and on again is an unmount and a mount.
const props = defineProps<{
    client: ChatClient;
    userId: string;
    deviceId: string;
    source: VoiceVideoSource;
    label: string;
    speaking: boolean;
}>();

const video = ref<HTMLVideoElement | null>(null);
let detach: (() => void) | null = null;

onMounted(() => {
    if (video.value) detach = props.client.attachVoiceVideo(props.userId, props.deviceId, props.source, video.value);
});
onBeforeUnmount(() => {
    detach?.();
    detach = null;
});
</script>

<template>
    <figure class="tumult-voice-tile" :data-source="source" :data-speaking="speaking ? 'true' : undefined">
        <!-- Muted: audio plays through its own elements, so a sound here would double it. -->
        <video ref="video" class="tumult-voice-tile-video" autoplay playsinline muted />
        <figcaption class="tumult-voice-tile-label">{{ label }}</figcaption>
    </figure>
</template>

<style scoped>
.tumult-voice-tile {
    position: relative;
    margin: 0;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-inset);
}
.tumult-voice-tile[data-speaking="true"] {
    border-color: var(--success);
}
/* A shared screen is the thing being looked at: it takes a whole row. */
.tumult-voice-tile[data-source="screen"] {
    grid-column: 1 / -1;
}
.tumult-voice-tile-video {
    width: 100%;
    height: 100%;
    /* A screen must not be cropped; a face may be. */
    object-fit: cover;
}
.tumult-voice-tile[data-source="screen"] .tumult-voice-tile-video {
    object-fit: contain;
}
.tumult-voice-tile-label {
    position: absolute;
    left: var(--space-2);
    bottom: var(--space-2);
    padding: var(--space-0-5) var(--space-1-5);
    border-radius: var(--radius-sm);
    background: var(--surface-overlay);
    color: var(--text-primary);
    font-size: var(--text-xs);
}
</style>
