<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { ref, watch } from "vue";
import type { ChatClient, PublicRoomView } from "@tumult/core";

import RoomDialog from "./RoomDialog.vue";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
    joined: [roomId: string];
}>();

const term = ref("");
const results = ref<PublicRoomView[]>([]);
const searched = ref(false);
const busy = ref(false);
const joining = ref<string | null>(null);
const error = ref("");
let request = 0;

async function search(): Promise<void> {
    if (busy.value) return;
    const seq = ++request;
    busy.value = true;
    error.value = "";
    try {
        const found = await props.client.publicRooms(term.value);
        if (seq === request) {
            results.value = found;
            searched.value = true;
        }
    } catch (cause) {
        if (seq === request) error.value = reportError(cause, "Couldn't load the room directory");
    } finally {
        if (seq === request) busy.value = false;
    }
}

function join(roomId: string): void {
    if (joining.value !== null) return;
    joining.value = roomId;
    error.value = "";
    void props.client
        .joinRoom(roomId)
        .then((joinedId) => emit("joined", joinedId))
        .catch((cause: unknown) => {
            error.value = reportError(cause, "Couldn't join that room");
        })
        .finally(() => {
            joining.value = null;
        });
}

watch(
    () => props.open,
    (isOpen) => {
        if (!isOpen) {
            request += 1;
            term.value = "";
            results.value = [];
            searched.value = false;
            busy.value = false;
            joining.value = null;
            error.value = "";
            return;
        }
        void search();
    },
    { immediate: true },
);
</script>

<template>
    <RoomDialog
        :open="props.open"
        title="Explore rooms"
        description="Find a public room on your homeserver and join it."
        submit-label="Search"
        :busy="busy"
        :error="error"
        @close="emit('close')"
        @submit="search"
    >
        <label class="tumult-dialog-field">
            <span class="tumult-dialog-label">Search the directory</span>
            <input v-model="term" class="tumult-dialog-input" type="search" placeholder="Room name or topic" />
        </label>
        <ul class="tumult-explore-results">
            <li v-for="room in results" :key="room.roomId">
                <div class="tumult-explore-room">
                    <div class="tumult-explore-text">
                        <strong>{{ room.name }}</strong>
                        <span class="tumult-explore-topic">{{ room.topic || room.roomId }}</span>
                        <small>{{ room.memberCount }} members</small>
                    </div>
                    <button
                        type="button"
                        class="tumult-dialog-button tumult-dialog-primary"
                        :disabled="joining !== null"
                        @click="join(room.roomId)"
                    >
                        {{ joining === room.roomId ? "Joining…" : "Join" }}
                    </button>
                </div>
            </li>
        </ul>
        <p v-if="searched && results.length === 0" class="tumult-dialog-hint">No public rooms matched.</p>
    </RoomDialog>
</template>

<style scoped>
.tumult-explore-results {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: var(--layout-slideover-width);
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-explore-room {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-raised);
}
.tumult-explore-text {
    display: flex;
    flex-direction: column;
    gap: var(--hairline);
    min-width: 0;
    font-size: var(--text-sm);
}
.tumult-explore-topic {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-explore-text small {
    color: var(--text-muted);
}
</style>
