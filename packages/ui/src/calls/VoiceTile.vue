<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { ChatClient, VoiceVideoSource } from "@tumult/core";

import Icon from "../icons/Icon.vue";

// One participant's video, drawn by the client into a <video> we own. Mounted
// only while the track is live (the participant's `camera`/`screen` flag), so
// "there is a track to attach" holds on mount and no retry is needed; a flag
// that flips off and on again is an unmount and a mount. The whole tile is the
// button: clicking it moves it into or out of the spotlight.
const props = defineProps<{
    client: ChatClient;
    userId: string;
    deviceId: string;
    source: VoiceVideoSource;
    label: string;
    speaking: boolean;
    /** In the spotlight (the large view) rather than the strip. */
    spotlit: boolean;
    /** A screen tile only: whether the share carries audio. Ignored for a camera. */
    audio?: boolean;
}>();

defineEmits<{ toggle: [] }>();

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
    <button
        type="button"
        class="tumult-voice-tile"
        :data-source="source"
        :data-speaking="speaking ? 'true' : undefined"
        :aria-pressed="spotlit"
        :aria-label="`${label}: ${spotlit ? 'remove from spotlight' : 'spotlight'}`"
        :title="spotlit ? 'Click to shrink' : 'Click to enlarge'"
        @click="$emit('toggle')"
    >
        <!-- Muted: audio plays through its own elements, so a sound here would double it. -->
        <video ref="video" class="tumult-voice-tile-video" autoplay playsinline muted />
        <span class="tumult-voice-tile-label">
            <!-- A silent share is common (Safari captures none; Chromium only a tab
                 with "share audio" ticked), so it is stated rather than left to guess. -->
            <span v-if="source === 'screen' && !audio" class="tumult-voice-tile-silent" title="This share has no audio">
                <Icon name="volume-off" />
                <span class="tumult-voice-tile-silent-text">No audio</span>
            </span>
            {{ label }}
        </span>
        <span class="tumult-voice-tile-pin" aria-hidden="true"><Icon :name="spotlit ? 'pin-off' : 'pin'" /></span>
    </button>
</template>

<style scoped>
.tumult-voice-tile {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-inset);
    color: var(--text-primary);
    cursor: pointer;
}
.tumult-voice-tile[data-speaking="true"] {
    border-color: var(--success);
}
.tumult-voice-tile:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
/* Letterboxed, never cropped: a shared screen loses its edges otherwise, and a
   face in a cell of the wrong shape is better small than cut. */
.tumult-voice-tile-video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.tumult-voice-tile-label {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    left: var(--space-2);
    bottom: var(--space-2);
    max-width: calc(100% - var(--space-4));
    padding: var(--space-0-5) var(--space-1-5);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-overlay);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-voice-tile-silent {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    color: var(--warning);
}
.tumult-voice-tile-pin {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: inline-flex;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--surface-overlay);
    opacity: 0;
    transition: opacity var(--motion-fast) var(--motion-ease);
}
.tumult-voice-tile:hover .tumult-voice-tile-pin,
.tumult-voice-tile:focus-visible .tumult-voice-tile-pin {
    opacity: 1;
}
</style>
