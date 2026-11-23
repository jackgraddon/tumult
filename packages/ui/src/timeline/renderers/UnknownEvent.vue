<script setup lang="ts">
import { computed } from "vue";
import type { MessageView } from "@tumult/core";

import Icon from "../../icons/Icon.vue";
import { describeUnknownEvent } from "../unknownEvent.ts";

const props = defineProps<{ message: MessageView }>();

const description = computed(() => describeUnknownEvent(props.message));
const source = computed(() =>
    JSON.stringify({ type: props.message.type, content: props.message.content }, null, 2),
);
</script>

<template>
    <div
        class="tumult-unknown"
        data-unsupported-event="true"
        :data-event-type="message.type"
    >
        <p class="tumult-unknown-head">
            <Icon name="alert" />
            <span>{{ description.label }}</span>
        </p>
        <p v-if="description.detail" class="tumult-unknown-detail">{{ description.detail }}</p>
        <details class="tumult-unknown-details">
            <summary class="tumult-unknown-summary">Details</summary>
            <p class="tumult-unknown-type">Event type: <code>{{ message.type }}</code></p>
            <pre class="tumult-unknown-source">{{ source }}</pre>
        </details>
    </div>
</template>

<style scoped>
.tumult-unknown {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-unknown-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    color: var(--text-secondary);
    font-weight: var(--weight-semibold);
}
.tumult-unknown-detail {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.tumult-unknown-summary {
    cursor: pointer;
    font-size: var(--text-xs);
}
.tumult-unknown-summary:focus-visible {
    outline: var(--focus-ring-outline) solid var(--accent);
    outline-offset: var(--focus-ring-offset);
    border-radius: var(--radius-sm);
}
.tumult-unknown-type {
    margin: 0;
    font-size: var(--text-xs);
}
.tumult-unknown-type code,
.tumult-unknown-source {
    font-family: var(--font-mono);
}
.tumult-unknown-source {
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--text-xs);
}
</style>
