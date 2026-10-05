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

const target = ref("");
const busy = ref(false);
const error = ref("");

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) return;
        target.value = "";
        busy.value = false;
        error.value = "";
    },
);

function submit(): void {
    if (busy.value) return;
    const raw = target.value.trim();
    if (raw === "") {
        error.value = "Paste a room address (#name:server) or a room ID (!room:server).";
        return;
    }
    const idOrAlias = raw.startsWith("#") || raw.startsWith("!") ? raw : `#${raw}`;
    busy.value = true;
    error.value = "";
    void props.client
        .joinRoom(idOrAlias)
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
        title="Join a room"
        description="Paste a room address or a room ID. Public rooms can be joined by address; private ones need an invite."
        submit-label="Join"
        :busy="busy"
        :error="error"
        :submit-disabled="target.trim() === ''"
        @close="emit('close')"
        @submit="submit"
    >
        <label class="tumult-dialog-field">
            <span class="tumult-dialog-label">Room address or ID</span>
            <input
                v-model="target"
                class="tumult-dialog-input"
                type="text"
                maxlength="255"
                autocomplete="off"
                spellcheck="false"
                placeholder="#general:server.example"
            />
        </label>
    </RoomDialog>
</template>
