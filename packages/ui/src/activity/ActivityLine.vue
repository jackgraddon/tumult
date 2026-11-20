<script setup lang="ts">
import { computed } from "vue";

import type { ActivityProps } from "../members/activity.ts";
import { activityElapsed, activityHeadline, activitySeconds, parseActivity } from "./document.ts";

const props = defineProps<ActivityProps>();

const value = computed(() => parseActivity(props.value));
const headline = computed(() => (value.value ? activityHeadline(value.value) : ""));
const seconds = computed(() => (value.value ? activitySeconds(value.value) : ""));
const elapsed = computed(() => (value.value ? activityElapsed(value.value) : ""));
const title = computed(() =>
    [headline.value, seconds.value, elapsed.value].filter(Boolean).join(" · "),
);
</script>

<template>
    <span
        v-if="value"
        class="tumult-activity"
        :class="`tumult-activity--${props.variant}`"
        :data-activity-type="value.type"
        :title="title"
    >
        <span v-if="value.emoji" class="tumult-activity-emoji">{{ value.emoji }}</span>
        <span class="tumult-activity-headline">{{ headline }}</span>
        <span v-if="seconds" class="tumult-activity-secondary">{{ seconds }}</span>
        <span v-if="elapsed" class="tumult-activity-elapsed">· {{ elapsed }}</span>
    </span>
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
</style>
