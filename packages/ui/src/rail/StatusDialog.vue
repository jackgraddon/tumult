<script setup lang="ts">
import { ref, watch } from "vue";
import type { ChatClient, OwnPresenceState } from "@tumult/core";

import RoomDialog from "../rooms/RoomDialog.vue";
import { useSubscribable } from "../subscribable.ts";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
}>();

const ownPresence = useSubscribable(props.client.ownPresence);

const presence = ref<OwnPresenceState>("online");
const message = ref("");
const busy = ref(false);
const error = ref("");

// The dialog's slot content unmounts on close, but this component's refs
// survive — so seed from the live feed on every open. A first open before the
// server has answered seeds an empty message, which clears nothing by itself.
watch(
    () => props.open,
    (isOpen) => {
        if (!isOpen) return;
        presence.value = ownPresence.value?.presence ?? "online";
        message.value = ownPresence.value?.statusMessage ?? "";
        busy.value = false;
        error.value = "";
    },
);

function submit(): void {
    if (busy.value) return;
    const text = message.value.trim();
    busy.value = true;
    error.value = "";
    // An empty field clears the status: the contract reads a missing
    // status message as "none", so we omit it rather than sending "".
    props.client
        .setOwnPresence(presence.value, text === "" ? undefined : text)
        .then(() => {
            emit("close");
        })
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
        title="Set a status"
        description="Your presence and status message are visible to people who share a room with you."
        submit-label="Save"
        :busy="busy"
        :error="error"
        @close="emit('close')"
        @submit="submit"
    >
        <fieldset class="tumult-dialog-group">
            <legend class="tumult-dialog-label">Presence</legend>
            <label class="tumult-dialog-radio">
                <input v-model="presence" type="radio" name="tumult-status-presence" value="online" />
                Online
            </label>
            <label class="tumult-dialog-radio">
                <input v-model="presence" type="radio" name="tumult-status-presence" value="unavailable" />
                Away
            </label>
            <label class="tumult-dialog-radio">
                <input v-model="presence" type="radio" name="tumult-status-presence" value="offline" />
                Offline
            </label>
        </fieldset>
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-status-message">Status message</label>
            <input
                id="tumult-status-message"
                v-model="message"
                class="tumult-dialog-input"
                type="text"
                autocomplete="off"
                placeholder="What are you up to?"
            />
            <p class="tumult-dialog-hint">Leave empty to clear your status.</p>
        </div>
    </RoomDialog>
</template>
