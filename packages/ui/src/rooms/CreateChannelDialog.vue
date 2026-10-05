<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "./RoomDialog.vue";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
    spaceId: string;
    spaceName: string;
}>();

const emit = defineEmits<{
    close: [];
    created: [roomId: string];
}>();

const name = ref("");
const topic = ref("");
const visibility = ref<"private" | "public">("private");
const aliasLocalpart = ref("");
const encrypted = ref(false);
const busy = ref(false);
const error = ref("");

const aliasError = computed<string | null>(() => {
    const raw = aliasLocalpart.value.trim();
    if (visibility.value !== "public" || raw === "") return null;
    const localpart = raw.startsWith("#") ? raw.slice(1) : raw;
    if (/[\s#:]/.test(localpart) || localpart === "") {
        return "An address can't contain spaces, # or :.";
    }
    return null;
});

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) return;
        name.value = "";
        topic.value = "";
        visibility.value = "private";
        aliasLocalpart.value = "";
        encrypted.value = false;
        busy.value = false;
        error.value = "";
    },
);

function submit(): void {
    if (busy.value) return;
    const trimmedName = name.value.trim();
    if (trimmedName === "") {
        error.value = "Give your channel a name.";
        return;
    }
    if (aliasError.value !== null) {
        error.value = aliasError.value;
        return;
    }
    const trimmedTopic = topic.value.trim();
    const rawAlias = aliasLocalpart.value.trim();
    const alias = rawAlias.startsWith("#") ? rawAlias.slice(1) : rawAlias;
    busy.value = true;
    error.value = "";
    void props.client
        .createChannel(props.spaceId, {
            name: trimmedName,
            visibility: visibility.value,
            encrypted: encrypted.value,
            ...(trimmedTopic !== "" ? { topic: trimmedTopic } : {}),
            ...(visibility.value === "public" && alias !== "" ? { aliasLocalpart: alias } : {}),
        })
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
        title="Create a channel"
        :description="`Add a channel to ${props.spaceName}.`"
        submit-label="Create channel"
        :busy="busy"
        :error="error"
        :submit-disabled="name.trim() === '' || aliasError !== null"
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
        <fieldset class="tumult-dialog-group">
            <legend class="tumult-dialog-label">Visibility</legend>
            <label class="tumult-dialog-radio">
                <input v-model="visibility" type="radio" value="private" />
                Private — only invited people
            </label>
            <label class="tumult-dialog-radio">
                <input v-model="visibility" type="radio" value="public" />
                Public — anyone can find and join
            </label>
        </fieldset>
        <label v-if="visibility === 'public'" class="tumult-dialog-field">
            <span class="tumult-dialog-label">Address (optional)</span>
            <input
                v-model="aliasLocalpart"
                class="tumult-dialog-input"
                type="text"
                maxlength="80"
                autocomplete="off"
                spellcheck="false"
                placeholder="general"
            />
            <span class="tumult-dialog-hint">Others can join with #name:your.server</span>
        </label>
        <label class="tumult-dialog-check">
            <input v-model="encrypted" type="checkbox" />
            Encrypt this channel
        </label>
    </RoomDialog>
</template>
