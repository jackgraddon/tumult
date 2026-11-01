<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "./RoomDialog.vue";
import UserPicker from "./UserPicker.vue";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
    roomId: string;
}>();

const emit = defineEmits<{
    close: [];
}>();

const userId = ref<string | null>(null);
const invited = ref<string | null>(null);
const busy = ref(false);
const error = ref("");
const pickerKey = ref(0);

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) return;
        userId.value = null;
        invited.value = null;
        busy.value = false;
        error.value = "";
        pickerKey.value += 1;
    },
);

function submit(): void {
    if (busy.value) return;
    if (invited.value !== null) {
        invited.value = null;
        userId.value = null;
        error.value = "";
        pickerKey.value += 1;
        return;
    }
    if (!userId.value) {
        error.value = "Pick who you want to invite.";
        return;
    }
    const picked = userId.value;
    busy.value = true;
    error.value = "";
    void props.client
        .invite(props.roomId, picked)
        .then(() => {
            invited.value = picked;
        })
        .catch((cause: unknown) => {
            error.value = reportError(cause, `Couldn't invite ${picked}`);
        })
        .finally(() => {
            busy.value = false;
        });
}
</script>

<template>
    <RoomDialog
        :open="props.open"
        title="Invite to this room"
        description="Search the directory, or type a full @user:server address."
        :submit-label="invited !== null ? 'Invite someone else' : 'Invite'"
        :busy="busy"
        :error="error"
        :submit-disabled="invited === null && userId === null"
        @close="emit('close')"
        @submit="submit"
    >
        <p v-if="invited" class="tumult-dialog-status" role="status">
            Invited {{ invited }}
        </p>
        <UserPicker v-else :key="pickerKey" v-model="userId" :client="props.client" label="Search people" />
    </RoomDialog>
</template>
