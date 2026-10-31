<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { computed, ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "../rooms/RoomDialog.vue";
import type { MemberModeration } from "../actions.ts";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
    /** The kick/ban/unban request being confirmed; null when closed. */
    action: MemberModeration | null;
}>();

const emit = defineEmits<{
    close: [];
}>();

const busy = ref(false);
const error = ref("");
const reason = ref("");

// Reka unmounts the content on close but this script survives, so every open
// must start from a clean slate (the RoomDialog dialogs' shared rule).
watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) return;
        busy.value = false;
        error.value = "";
        reason.value = "";
    },
);

const title = computed(() => {
    switch (props.action?.kind) {
        case "kick":
            return "Kick member";
        case "ban":
            return "Ban member";
        case "unban":
            return "Unban member";
        default:
            return "";
    }
});

const description = computed(() => {
    const name = props.action?.member.displayName ?? "this member";
    switch (props.action?.kind) {
        case "kick":
            return `Remove ${name} from this room? They can rejoin if the join rule allows it.`;
        case "ban":
            return `Ban ${name} from this room? They cannot rejoin until the ban is lifted.`;
        case "unban":
            return `Lift the ban on ${name}? They can rejoin if the join rule allows it.`;
        default:
            return "";
    }
});

const submitLabel = computed(() => {
    switch (props.action?.kind) {
        case "kick":
            return "Kick";
        case "ban":
            return "Ban";
        case "unban":
            return "Unban";
        default:
            return "Confirm";
    }
});

// Only kicking and banning take a reason; unban has nothing to explain.
const wantsReason = computed(() => props.action?.kind === "kick" || props.action?.kind === "ban");

function submit(): void {
    const action = props.action;
    if (busy.value || !action) return;
    busy.value = true;
    error.value = "";
    const trimmed = reason.value.trim();
    const promise =
        action.kind === "kick"
            ? props.client.kick(action.roomId, action.member.userId, trimmed || undefined)
            : action.kind === "ban"
              ? props.client.ban(action.roomId, action.member.userId, trimmed || undefined)
              : props.client.unban(action.roomId, action.member.userId);
    void promise
        .then(() => emit("close"))
        .catch((cause: unknown) => {
            error.value = reportError(cause, `Couldn't ${action.kind} ${action.member.displayName}`);
        })
        .finally(() => {
            busy.value = false;
        });
}
</script>

<template>
    <RoomDialog
        :open="props.open"
        :title="title"
        :description="description"
        :submit-label="submitLabel"
        :danger="props.action?.kind !== 'unban'"
        :busy="busy"
        :error="error"
        @close="emit('close')"
        @submit="submit"
    >
        <div v-if="wantsReason" class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-moderation-reason">Reason (optional)</label>
            <textarea
                id="tumult-moderation-reason"
                v-model="reason"
                class="tumult-dialog-textarea"
                rows="2"
                :disabled="busy"
                placeholder="Shown to other moderators"
            />
        </div>
    </RoomDialog>
</template>
