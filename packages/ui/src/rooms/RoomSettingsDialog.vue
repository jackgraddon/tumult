<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import type {
    ChatClient,
    HistoryVisibility,
    JoinRule,
    RoomSettingsPatch,
    RoomSummary,
} from "@tumult/core";

import Avatar from "../primitives/Avatar.vue";
import RoomDialog from "./RoomDialog.vue";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
    room: RoomSummary | undefined;
}>();

const emit = defineEmits<{
    close: [];
}>();

const name = ref("");
const topic = ref("");
const joinRule = ref<JoinRule>("invite");
const historyVisibility = ref<HistoryVisibility>("shared");
const canonicalAlias = ref("");
const file = ref<File | null>(null);
const removing = ref(false);
const busy = ref(false);
const error = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

// Same lifecycle as ProfileDialog: the Reka content unmounts on close but this
// component's script state survives, so seed from the live summary on every
// open. The preview blob URL must be revoked whenever it stops being shown.
let previewUrl: string | null = null;

function revokePreview(): void {
    if (previewUrl !== null) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
}

onScopeDispose(revokePreview);

watch(
    () => props.open,
    (isOpen) => {
        if (!isOpen) {
            revokePreview();
            return;
        }
        const room = props.room;
        name.value = room?.name ?? "";
        topic.value = room?.topic ?? "";
        joinRule.value = room?.joinRule ?? "invite";
        historyVisibility.value = room?.historyVisibility ?? "shared";
        canonicalAlias.value = room?.canonicalAlias ?? "";
        file.value = null;
        removing.value = false;
        busy.value = false;
        error.value = "";
    },
);

const avatarPreview = computed<string | null>(() => {
    if (removing.value) return null;
    if (file.value !== null) return previewUrl;
    return props.room?.avatarUrl ?? null;
});

const dirty = computed(() => {
    const room = props.room;
    if (!room) return false;
    return (
        name.value.trim() !== room.name ||
        topic.value.trim() !== (room.topic ?? "") ||
        joinRule.value !== room.joinRule ||
        historyVisibility.value !== room.historyVisibility ||
        canonicalAlias.value.trim() !== (room.canonicalAlias ?? "") ||
        file.value !== null ||
        (removing.value && (room.avatarUrl ?? null) !== null)
    );
});

function onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] ?? null;
    revokePreview();
    file.value = picked;
    removing.value = false;
    if (picked !== null) previewUrl = URL.createObjectURL(picked);
}

function removeAvatar(): void {
    revokePreview();
    file.value = null;
    removing.value = true;
    // Reset so choosing the same file again fires a change event.
    if (fileInput.value) fileInput.value.value = "";
}

function undoRemove(): void {
    removing.value = false;
}

function submit(): void {
    if (busy.value || !props.room || !dirty.value) return;
    const room = props.room;
    const patch: RoomSettingsPatch = {};
    const trimmedName = name.value.trim();
    if (trimmedName !== room.name) patch.name = trimmedName;
    const trimmedTopic = topic.value.trim();
    if (trimmedTopic !== (room.topic ?? "")) patch.topic = trimmedTopic === "" ? null : trimmedTopic;
    if (file.value !== null) patch.avatar = file.value;
    else if (removing.value && (room.avatarUrl ?? null) !== null) patch.avatar = null;
    if (joinRule.value !== room.joinRule) patch.joinRule = joinRule.value;
    if (historyVisibility.value !== room.historyVisibility) {
        patch.historyVisibility = historyVisibility.value;
    }
    const trimmedAlias = canonicalAlias.value.trim();
    if (trimmedAlias !== (room.canonicalAlias ?? "")) {
        patch.canonicalAlias = trimmedAlias === "" ? null : trimmedAlias;
    }
    busy.value = true;
    error.value = "";
    props.client
        .updateRoomSettings(room.id, patch)
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
        title="Room settings"
        :description="`Settings for ${props.room?.name ?? 'this room'}`"
        submit-label="Save"
        :busy="busy"
        :error="error"
        :submit-disabled="!dirty"
        @close="emit('close')"
        @submit="submit"
    >
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-settings-name">Room name</label>
            <input
                id="tumult-settings-name"
                v-model="name"
                class="tumult-dialog-input"
                type="text"
                placeholder="Leave empty to use the room's default name"
            />
        </div>
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-settings-topic">Topic</label>
            <textarea
                id="tumult-settings-topic"
                v-model="topic"
                class="tumult-dialog-textarea"
                placeholder="What is this room about?"
            />
        </div>
        <div class="tumult-dialog-field tumult-settings-field">
            <span class="tumult-dialog-label">Avatar</span>
            <div class="tumult-settings-avatar">
                <Avatar :label="name || props.room?.name || '?'" :src="avatarPreview" size="lg" />
                <div class="tumult-settings-avatar-actions">
                    <input
                        ref="fileInput"
                        class="tumult-settings-file"
                        type="file"
                        accept="image/*"
                        tabindex="-1"
                        aria-hidden="true"
                        @change="onFileSelected"
                    />
                    <button type="button" class="tumult-dialog-button" @click="fileInput?.click()">
                        Choose image…
                    </button>
                    <button v-if="removing" type="button" class="tumult-dialog-button" @click="undoRemove">
                        Undo
                    </button>
                    <button
                        v-else-if="file !== null || (props.room?.avatarUrl ?? null) !== null"
                        type="button"
                        class="tumult-dialog-button"
                        @click="removeAvatar"
                    >
                        Remove
                    </button>
                </div>
            </div>
            <p class="tumult-dialog-hint">
                {{
                    removing
                        ? "The avatar will be removed when you save."
                        : "A new avatar replaces the current one when you save."
                }}
            </p>
        </div>
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-settings-join">Who can join?</label>
            <select id="tumult-settings-join" v-model="joinRule" class="tumult-dialog-select">
                <option value="public">Anyone (public room)</option>
                <option value="invite">Only invited people</option>
                <option value="knock">Anyone, pending approval</option>
            </select>
        </div>
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-settings-history">
                History new members can see
            </label>
            <select
                id="tumult-settings-history"
                v-model="historyVisibility"
                class="tumult-dialog-select"
            >
                <option value="shared">Everything (shared)</option>
                <option value="invited">From their invitation</option>
                <option value="joined">From when they joined</option>
                <option value="world_readable">Anyone on the internet</option>
            </select>
        </div>
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-settings-alias">Canonical alias</label>
            <input
                id="tumult-settings-alias"
                v-model="canonicalAlias"
                class="tumult-dialog-input"
                type="text"
                placeholder="#room:server"
            />
            <p class="tumult-dialog-hint">
                The address people use to find and join this room. Leave empty to remove it.
            </p>
        </div>
    </RoomDialog>
</template>

<style scoped>
.tumult-settings-field > .tumult-dialog-label {
    display: block;
    margin-bottom: var(--space-1);
}
.tumult-settings-avatar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.tumult-settings-avatar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.tumult-settings-file {
    display: none;
}
.tumult-dialog-select {
    width: 100%;
    padding: var(--space-2);
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-dialog-select:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
</style>