<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "./RoomDialog.vue";
import type { LeaveTarget } from "../actions.ts";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
    target: LeaveTarget | null;
}>();

const emit = defineEmits<{
    close: [];
    left: [roomId: string];
}>();

const busy = ref(false);
const error = ref("");

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) return;
        busy.value = false;
        error.value = "";
    },
);

function submit(): void {
    const target = props.target;
    if (busy.value || !target) return;
    busy.value = true;
    error.value = "";
    void props.client
        .leave(target.id)
        .then(() => emit("left", target.id))
        .catch((cause: unknown) => {
            error.value = reportError(cause, `Couldn't leave ${target.name}`);
        })
        .finally(() => {
            busy.value = false;
        });
}
</script>

<template>
    <RoomDialog
        :open="props.open"
        :title="props.target ? `Leave ${props.target.name}?` : 'Leave this room?'"
        :description="
            props.target?.isSpace
                ? 'You will lose access to everything inside this space until you rejoin.'
                : 'You will stop receiving messages here. You can rejoin a public room later, or ask to be invited back.'
        "
        submit-label="Leave"
        danger
        :busy="busy"
        :error="error"
        @close="emit('close')"
        @submit="submit"
    />
</template>
