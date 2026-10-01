<script setup lang="ts">
import { computed } from "vue";
import type { MessageView } from "@tumult/core";

import { useTimelineRegistry } from "./registry.ts";
import Avatar from "../primitives/Avatar.vue";
import DecryptionPlaceholder from "./renderers/DecryptionPlaceholder.vue";
import UnknownEvent from "./renderers/UnknownEvent.vue";

const props = defineProps<{
    message: MessageView;
    /** True when the previous row shares sender+day: compact continuation. */
    grouped: boolean;
}>();

const registry = useTimelineRegistry();
const renderer = computed(() => registry.resolve(props.message, UnknownEvent));
const time = computed(() =>
    new Date(props.message.timestamp).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }),
);
</script>

<template>
    <!--
        Cross-cutting state is gated HERE, before renderer resolution.
        The registered renderer never sees pending/failed payloads, so no
        future game renderer can get the E2EE placeholder states wrong.
    -->
    <div
        class="tumult-row"
        :data-grouped="grouped ? 'true' : 'false'"
        :data-status="message.status"
        :data-decryption="message.decryption"
    >
        <Avatar v-if="!grouped" :label="message.senderId" size="sm" class="tumult-row-avatar" />
        <div class="tumult-row-body">
            <div v-if="!grouped" class="tumult-row-header">
                <span class="tumult-row-sender">{{ message.senderId }}</span>
                <time class="tumult-row-time" :dateTime="new Date(message.timestamp).toISOString()">
                    {{ time }}
                </time>
                <span v-if="message.status === 'sending'" class="tumult-row-flag">sending…</span>
                <span v-else-if="message.status === 'failed'" class="tumult-row-flag tumult-row-flag-failed">
                    not sent
                </span>
            </div>
            <DecryptionPlaceholder
                v-if="message.decryption === 'pending' || message.decryption === 'failed'"
                :message="message"
            />
            <component :is="renderer" v-else :message="message" />
        </div>
    </div>
</template>

<style scoped>
.tumult-row {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
}
.tumult-row[data-grouped="true"] {
    padding-top: 0;
    padding-bottom: 0;
}
.tumult-row:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-row-avatar {
    margin-top: 2px;
}
.tumult-row-body {
    min-width: 0;
    flex: 1;
}
.tumult-row-header {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
}
.tumult-row-sender {
    font-weight: 600;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
}
.tumult-row-time {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-row-flag {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-style: italic;
}
.tumult-row-flag-failed {
    color: var(--danger);
}
</style>
