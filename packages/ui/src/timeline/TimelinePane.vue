<script setup lang="ts">
import type { ChatClient, RoomSummary } from "@tumult/core";

import TimelineBody from "./TimelineBody.vue";

defineProps<{
    client: ChatClient;
    room: RoomSummary | undefined;
}>();
</script>

<template>
    <section class="tumult-timeline-pane" aria-label="Timeline">
        <header class="tumult-timeline-header">
            <h2>{{ room?.name ?? "Select a room" }}</h2>
            <p v-if="room?.topic" class="tumult-timeline-topic">{{ room.topic }}</p>
        </header>
        <!-- Keyed so one room's subscription is torn down before the next mounts. -->
        <TimelineBody v-if="room" :key="room.id" :client="client" :room-id="room.id" />
        <div v-else class="tumult-timeline-empty">
            <p>Pick a channel or conversation to start reading.</p>
        </div>
    </section>
</template>

<style scoped>
.tumult-timeline-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--timeline-bg);
    color: var(--text-primary);
}
.tumult-timeline-header {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-default);
}
.tumult-timeline-header h2 {
    margin: 0;
    font-size: var(--text-md);
}
.tumult-timeline-topic {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-timeline-empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--text-muted);
}
</style>
