<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "./RoomDialog.vue";
import UserPicker from "./UserPicker.vue";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
    created: [roomId: string];
}>();

const userId = ref<string | null>(null);
const encrypted = ref(false);
const busy = ref(false);
const error = ref("");

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) return;
        userId.value = null;
        encrypted.value = false;
        busy.value = false;
        error.value = "";
    },
);

function submit(): void {
    if (busy.value) return;
    if (!userId.value) {
        error.value = "Pick who you want to message.";
        return;
    }
    const picked = userId.value;
    busy.value = true;
    error.value = "";
    void props.client
        .createDm({ userId: picked, encrypted: encrypted.value })
        .then((roomId) => emit("created", roomId))
        .catch((cause: unknown) => {
            error.value = reportError(cause, "Couldn't start the conversation");
        })
        .finally(() => {
            busy.value = false;
        });
}
</script>

<template>
    <RoomDialog
        :open="props.open"
        title="New message"
        description="Search the directory, or type a full @user:server address."
        submit-label="Start chat"
        :busy="busy"
        :error="error"
        :submit-disabled="userId === null"
        @close="emit('close')"
        @submit="submit"
    >
        <UserPicker v-model="userId" :client="props.client" label="Search people" />
        <label class="tumult-dialog-check">
            <input v-model="encrypted" type="checkbox" />
            Encrypt this conversation
        </label>
    </RoomDialog>
</template>
