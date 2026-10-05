<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import type { ChatClient, RoomSummary } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import IconButton from "../primitives/IconButton.vue";
import SearchPanel from "./SearchPanel.vue";
import TimelineBody from "./TimelineBody.vue";

const props = defineProps<{
    client: ChatClient;
    room: RoomSummary | undefined;
    threadsEnabled?: boolean;
}>();

// Must be declared and re-emitted: an undeclared listener on this component
// falls through to the root <section> as a native attribute and never fires.
const emit = defineEmits<{
    "open-thread": [rootEventId: string];
}>();

const typing = useSubscribable(props.client.typing);
const typingUsers = computed(() => (props.room ? typing.value.rooms[props.room.id] ?? [] : []));

function typingLabel(users: string[]): string {
    if (users.length === 0) return "";
    if (users.length === 1) return `${users[0]} is typing…`;
    if (users.length === 2) return `${users[0]} and ${users[1]} are typing…`;
    return `${users[0]} and ${users.length - 1} others are typing…`;
}

const searchOpen = ref(false);
// Nonce makes a repeat jump to the SAME hit re-fire the viewport watch.
const focusRequest = shallowRef<{ id: string; nonce: number } | null>(null);
let focusNonce = 0;

function onJumped(eventId: string): void {
    focusRequest.value = { id: eventId, nonce: ++focusNonce };
}

// Room switch: forget a pending jump and close the panel (fresh search scope).
watch(
    () => props.room?.id,
    () => {
        searchOpen.value = false;
        focusRequest.value = null;
    },
);
</script>

<template>
    <section class="tumult-timeline-pane" aria-label="Timeline">
        <header class="tumult-timeline-header">
            <div class="tumult-timeline-header-text">
                <h2>{{ room?.name ?? "Select a room" }}</h2>
                <p v-if="room?.topic" class="tumult-timeline-topic">{{ room.topic }}</p>
                <p v-if="typingUsers.length > 0" class="tumult-timeline-typing" role="status">
                    {{ typingLabel(typingUsers) }}
                </p>
            </div>
            <IconButton
                v-if="room"
                label="Search this room"
                :aria-pressed="searchOpen"
                @click="searchOpen = !searchOpen"
                >🔍</IconButton
            >
        </header>
        <!-- Keyed so one room's subscription is torn down before the next mounts. -->
        <TimelineBody
            v-if="room"
            :key="room.id"
            :client="client"
            :room-id="room.id"
            :threads-enabled="threadsEnabled"
            :fully-read-event-id="room.fullyReadEventId"
            :focus-request="focusRequest"
            @open-thread="(id) => emit('open-thread', id)"
        />
        <div v-else class="tumult-timeline-empty">
            <p>Pick a channel or conversation to start reading.</p>
        </div>
        <SearchPanel
            v-if="searchOpen && room"
            :client="client"
            :room-id="room.id"
            @jumped="onJumped"
            @close="searchOpen = false"
        />
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
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-default);
}
.tumult-timeline-header-text {
    min-width: 0;
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
.tumult-timeline-typing {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-style: italic;
}
.tumult-timeline-empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--text-muted);
}
</style>
