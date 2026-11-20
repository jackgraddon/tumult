<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";

import type { ActivityProps } from "../members/activity.ts";
import { useMediaResolver } from "../media.ts";
import {
    activityElapsed,
    activityHeadline,
    activityProgress,
    activitySeconds,
    parseActivity,
} from "./document.ts";

const props = defineProps<ActivityProps>();
const resolveMedia = useMediaResolver();

const value = computed(() => parseActivity(props.value));
const card = computed(() => props.variant === "card");
const now = ref(Date.now());

// Only the card variant has room for artwork. Keep this logic out of the row so
// a virtualized member row never starts thumbnail fetches for every activity it
// scrolls past. A generation counter makes a slow mxc resolution harmless if the
// activity changes while it is in flight.
const resolvedMedia = ref<(string | null)[]>([]);
let mediaGeneration = 0;
watch(
    () => [props.variant, value.value?.media] as const,
    ([variant, media]) => {
        const generation = ++mediaGeneration;
        const items = variant === "card" ? media ?? [] : [];
        resolvedMedia.value = items.map((item) => (item.url.startsWith("mxc://") ? null : item.url));
        if (!resolveMedia) return;
        items.forEach((item, index) => {
            if (!item.url.startsWith("mxc://")) return;
            void resolveMedia(item.url, 160).then(
                (url) => {
                    if (generation === mediaGeneration) resolvedMedia.value[index] = url;
                },
                () => {
                    // A failed thumbnail leaves that image out of the card.
                },
            );
        });
    },
    { immediate: true },
);

const mediaImages = computed(() => {
    const labels = value.value?.media ?? [];
    return resolvedMedia.value.flatMap((url, index) =>
        url ? [{ url, label: labels[index]?.label ?? "" }] : [],
    );
});

// A live bar needs a clock, but only while a card is open and only when the
// producer actually gave us both ends. Row/self variants keep the static elapsed
// text exactly as before.
let clock: ReturnType<typeof setInterval> | undefined;
watch(
    [card, () => value.value?.endsAt],
    ([isCard, endsAt]) => {
        const wanted = isCard && endsAt !== undefined;
        if (wanted && !clock) clock = setInterval(() => (now.value = Date.now()), 1000);
        if (!wanted && clock) {
            clearInterval(clock);
            clock = undefined;
        }
    },
    { immediate: true },
);
onScopeDispose(() => {
    mediaGeneration += 1;
    if (clock) clearInterval(clock);
});

const headline = computed(() => (value.value ? activityHeadline(value.value) : ""));
const seconds = computed(() => (value.value ? activitySeconds(value.value) : ""));
const elapsed = computed(() => (value.value ? activityElapsed(value.value, now.value) : ""));
const progress = computed(() => {
    const activity = value.value;
    return activity && card.value ? activityProgress(activity, now.value) : null;
});
const progressPercent = computed(() => Math.round(progress.value?.percent ?? 0));
const title = computed(() =>
    [headline.value, seconds.value, progress.value ? `${progress.value.elapsed} / ${progress.value.duration}` : elapsed.value]
        .filter(Boolean)
        .join(" · "),
);
</script>

<template>
    <component
        v-if="value"
        :is="props.variant === 'card' ? 'div' : 'span'"
        class="tumult-activity"
        :class="`tumult-activity--${props.variant}`"
        :data-activity-type="value.type"
        :title="title"
    >
        <span class="tumult-activity-text">
            <span v-if="value.emoji" class="tumult-activity-emoji">{{ value.emoji }}</span>
            <span class="tumult-activity-headline">{{ headline }}</span>
            <span v-if="seconds" class="tumult-activity-secondary">{{ seconds }}</span>
            <span v-if="elapsed" class="tumult-activity-elapsed">· {{ elapsed }}</span>
        </span>
        <template v-if="props.variant === 'card'">
            <span v-if="mediaImages.length" class="tumult-activity-media" :data-activity-media-count="mediaImages.length">
                <img
                    v-for="(image, index) in mediaImages"
                    :key="`${index}-${image.url}`"
                    class="tumult-activity-media-image"
                    :src="image.url"
                    :alt="image.label"
                    :title="image.label || undefined"
                    data-activity-media
                />
            </span>
            <template v-if="progress">
                <span
                    class="tumult-activity-progress"
                    role="progressbar"
                    aria-label="Activity progress"
                    :aria-valuemin="0"
                    :aria-valuemax="100"
                    :aria-valuenow="progressPercent"
                    data-activity-progress
                >
                    <span class="tumult-activity-progress-fill" :style="{ width: `${progress.percent}%` }"></span>
                </span>
                <span class="tumult-activity-progress-time">{{ progress.elapsed }} / {{ progress.duration }}</span>
            </template>
        </template>
    </component>
</template>

<style scoped>
.tumult-activity {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-tight);
}
.tumult-activity > * {
    flex: none;
}
.tumult-activity-text {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
}
.tumult-activity-headline,
.tumult-activity-secondary {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
.tumult-activity-headline {
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
}
.tumult-activity--row .tumult-activity-headline {
    font-weight: var(--weight-normal);
    color: inherit;
}
.tumult-activity-secondary,
.tumult-activity-elapsed {
    color: var(--text-muted);
}
.tumult-activity-elapsed {
    font-variant-numeric: tabular-nums;
}

/* The profile card is not virtualized: give artwork and progress their own
   fixed-size block instead of squeezing them onto a one-line subtitle. */
.tumult-activity--card {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    overflow: visible;
    white-space: normal;
    font-size: var(--text-sm);
}
.tumult-activity--card .tumult-activity-text {
    flex-wrap: wrap;
    overflow-wrap: anywhere;
}
.tumult-activity--card .tumult-activity-headline {
    overflow: visible;
    text-overflow: clip;
}
.tumult-activity-media {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}
.tumult-activity-media-image {
    width: var(--activity-media-size);
    height: var(--activity-media-size);
    flex: none;
    object-fit: cover;
    border-radius: var(--activity-media-radius);
    background: var(--surface-inset);
}
.tumult-activity-progress {
    position: relative;
    display: block;
    width: 100%;
    height: var(--activity-progress-height);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--surface-inset);
}
.tumult-activity-progress-fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--accent);
}
.tumult-activity-progress-time {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
}
</style>
