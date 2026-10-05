<script setup lang="ts">
import { ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "./RoomDialog.vue";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
    created: [roomId: string];
}>();

const name = ref("");
const topic = ref("");
const busy = ref(false);
const error = ref("");

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) return;
        name.value = "";
        topic.value = "";
        busy.value = false;
        error.value = "";
    },
);

function submit(): void {
    if (busy.value) return;
    const trimmedName = name.value.trim();
    if (trimmedName === "") {
        error.value = "Give your space a name.";
        return;
    }
    const trimmedTopic = topic.value.trim();
    busy.value = true;
    error.value = "";
    void props.client
        .createSpace({ name: trimmedName, ...(trimmedTopic !== "" ? { topic: trimmedTopic } : {}) })
        .then((roomId) => emit("created", roomId))
        .catch((cause: unknown) => {
            error.value = cause instanceof Error ? cause.message : String(cause);
        })
        .finally(() => {
            busy.value = false;
        });
}
</script>

<template>
    <RoomDialog
        :open="props.open"
        title="Create a space"
        description="A space is a server — a group of channels with its own members and icon."
        submit-label="Create space"
        :busy="busy"
        :error="error"
        :submit-disabled="name.trim() === ''"
        @close="emit('close')"
        @submit="submit"
    >
        <label class="tumult-dialog-field">
            <span class="tumult-dialog-label">Name</span>
            <input v-model="name" class="tumult-dialog-input" type="text" maxlength="80" required />
        </label>
        <label class="tumult-dialog-field">
            <span class="tumult-dialog-label">Topic (optional)</span>
            <textarea v-model="topic" class="tumult-dialog-textarea" maxlength="500"></textarea>
        </label>
    </RoomDialog>
</template>
