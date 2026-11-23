<script setup lang="ts">
import { computed } from "vue";
import type { RelatedEventKind, RelatedEventView } from "@tumult/core";

import Icon from "../icons/Icon.vue";

const props = defineProps<{ events: readonly RelatedEventView[] }>();

const newest = computed(() => props.events[0]);
const headline = computed(() => {
    if (props.events.length === 0) return "";
    if (props.events.length > 1) return `${props.events.length} related updates`;
    return newest.value?.summary ?? "Related update";
});

function iconFor(kind: RelatedEventKind | undefined): string {
    switch (kind) {
        case "delivery":
            return "shield-check";
        case "poll-vote":
            return "poll";
        case "view-limited":
            return "alert";
        default:
            return "dots-horizontal";
    }
}

function timeOf(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
}

function sourceOf(event: RelatedEventView): string {
    return JSON.stringify({ type: event.type, content: event.content }, null, 2);
}
</script>

<template>
    <details
        v-if="events.length > 0"
        class="tumult-related"
        :data-related-count="events.length"
    >
        <summary class="tumult-related-summary">
            <Icon :name="iconFor(newest?.kind)" />
            <span>{{ headline }}</span>
        </summary>
        <div
            v-for="event in events"
            :key="event.id"
            class="tumult-related-item"
            :data-kind="event.kind"
            :data-event-type="event.type"
        >
            <div class="tumult-related-item-head">
                <span class="tumult-related-summary-text">{{ event.summary ?? "Related update" }}</span>
                <time class="tumult-related-time" :dateTime="new Date(event.timestamp).toISOString()">
                    {{ timeOf(event.timestamp) }}
                </time>
            </div>
            <p class="tumult-related-meta">{{ event.type }} · {{ event.senderId }}</p>
            <pre class="tumult-related-source">{{ sourceOf(event) }}</pre>
        </div>
    </details>
</template>

<style scoped>
.tumult-related {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-xs);
}
.tumult-related-summary {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: fit-content;
    cursor: pointer;
    color: var(--text-muted);
}
.tumult-related-summary:focus-visible {
    outline: var(--focus-ring-outline) solid var(--accent);
    outline-offset: var(--focus-ring-offset);
    border-radius: var(--radius-sm);
}
.tumult-related-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
}
.tumult-related-item[data-kind="delivery"] .tumult-related-summary-text {
    color: var(--text-primary);
}
.tumult-related-item[data-kind="metadata"] .tumult-related-summary-text {
    color: var(--text-secondary);
}
.tumult-related-item-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
}
.tumult-related-summary-text {
    font-weight: var(--weight-semibold);
    overflow-wrap: anywhere;
}
.tumult-related-time {
    color: var(--text-muted);
    white-space: nowrap;
}
.tumult-related-meta {
    margin: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
}
.tumult-related-source {
    margin: 0;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    font-family: var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
