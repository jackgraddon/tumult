<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { computed, ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "./RoomDialog.vue";
import UserPicker from "./UserPicker.vue";
import IconButton from "../primitives/IconButton.vue";
import Icon from "../icons/Icon.vue";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
    created: [roomId: string];
}>();

interface Invitee {
    key: number;
    userId: string | null;
}

let nextKey = 1;
const name = ref("");
const invitees = ref<Invitee[]>([{ key: nextKey++, userId: null }]);
const encrypted = ref(false);
const busy = ref(false);
const error = ref("");

const people = computed(() => [
    ...new Set(invitees.value.map((i) => i.userId?.trim()).filter((id): id is string => Boolean(id))),
]);
const canSubmit = computed(() => name.value.trim().length > 0 && people.value.length > 0);

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) return;
        name.value = "";
        invitees.value = [{ key: nextKey++, userId: null }];
        encrypted.value = false;
        busy.value = false;
        error.value = "";
    },
);

function addInvitee(): void {
    invitees.value.push({ key: nextKey++, userId: null });
}

function removeInvitee(key: number): void {
    invitees.value = invitees.value.filter((i) => i.key !== key);
}

function submit(): void {
    if (busy.value) return;
    if (!canSubmit.value) {
        error.value = "Give the group a name and invite at least one person.";
        return;
    }
    busy.value = true;
    error.value = "";
    void props.client
        .createGroup({ name: name.value.trim(), userIds: people.value, encrypted: encrypted.value })
        .then((roomId) => emit("created", roomId))
        .catch((cause: unknown) => {
            error.value = reportError(cause, "Couldn't create the group");
        })
        .finally(() => {
            busy.value = false;
        });
}
</script>

<template>
    <RoomDialog
        :open="props.open"
        title="New group"
        description="Name the group and invite the people you want in it."
        submit-label="Create group"
        :busy="busy"
        :error="error"
        :submit-disabled="!canSubmit"
        @close="emit('close')"
        @submit="submit"
    >
        <label class="tumult-dialog-field">
            <span class="tumult-dialog-label">Group name</span>
            <input v-model="name" class="tumult-dialog-input" type="text" placeholder="Weekend trip" />
        </label>
        <div class="tumult-dialog-field">
            <span class="tumult-dialog-label">People</span>
            <div v-for="(invitee, index) in invitees" :key="invitee.key" class="tumult-group-person">
                <UserPicker
                    :model-value="invitee.userId"
                    :client="props.client"
                    :label="`Person ${index + 1}`"
                    @update:model-value="invitee.userId = $event"
                />
                <IconButton
                    v-if="invitees.length > 1"
                    label="Remove this person"
                    @click="removeInvitee(invitee.key)"
                >
                    <Icon name="close" />
                </IconButton>
            </div>
            <button type="button" class="tumult-dialog-button tumult-group-add" @click="addInvitee">
                Add another person
            </button>
        </div>
        <label class="tumult-dialog-check">
            <input v-model="encrypted" type="checkbox" />
            Encrypt this group
        </label>
    </RoomDialog>
</template>

<style scoped>
.tumult-group-person {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1);
}
.tumult-group-person > :first-child {
    flex: 1;
    min-width: 0;
}
.tumult-group-add {
    align-self: flex-start;
}
</style>
