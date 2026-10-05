<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "./RoomDialog.vue";
import Avatar from "../primitives/Avatar.vue";
import { useSubscribable } from "../subscribable.ts";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
}>();

const profile = useSubscribable(props.client.profile);

const displayName = ref("");
const file = ref<File | null>(null);
const removing = ref(false);
const busy = ref(false);
const error = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

// The dialog's slot content unmounts on close (Reka closes the content), but
// this component's script state survives — so seed from the live profile on
// every open rather than only resetting on close. The preview blob URL must
// be revoked whenever it stops being the shown avatar.
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
        displayName.value = profile.value?.displayName ?? "";
        file.value = null;
        removing.value = false;
        busy.value = false;
        error.value = "";
    },
);

const avatarPreview = computed<string | null>(() => {
    if (removing.value) return null;
    if (file.value !== null) return previewUrl;
    return profile.value?.avatarUrl ?? null;
});

const dirty = computed(() => {
    const current = profile.value;
    const nameChanged = displayName.value.trim() !== (current?.displayName ?? "");
    const avatarChanged =
        file.value !== null || (removing.value && (current?.avatarUrl ?? null) !== null);
    return nameChanged || avatarChanged;
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
    if (busy.value || !dirty.value) return;
    const current = profile.value;
    const params: { displayName?: string; avatar?: Blob | null } = {};
    const name = displayName.value.trim();
    if (name !== (current?.displayName ?? "")) params.displayName = name;
    if (file.value !== null) params.avatar = file.value;
    else if (removing.value) params.avatar = null;
    busy.value = true;
    error.value = "";
    props.client
        .setProfile(params)
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
        title="Edit profile"
        description="Your display name and avatar are visible to everyone who shares a room with you."
        submit-label="Save"
        :busy="busy"
        :error="error"
        :submit-disabled="!dirty"
        @close="emit('close')"
        @submit="submit"
    >
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-profile-name">Display name</label>
            <input
                id="tumult-profile-name"
                v-model="displayName"
                class="tumult-dialog-input"
                type="text"
                autocomplete="nickname"
                placeholder="Leave empty to use your username"
            />
        </div>
        <div class="tumult-dialog-field tumult-profile-field">
            <span class="tumult-dialog-label">Avatar</span>
            <div class="tumult-profile-avatar">
                <Avatar :label="displayName || profile?.userId || '?'" :src="avatarPreview" size="lg" />
                <div class="tumult-profile-avatar-actions">
                    <input
                        ref="fileInput"
                        class="tumult-profile-file"
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
                        v-else-if="file !== null || (profile?.avatarUrl ?? null) !== null"
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
                        ? "Your avatar will be removed when you save."
                        : "A new avatar replaces the current one when you save."
                }}
            </p>
        </div>
    </RoomDialog>
</template>

<style scoped>
.tumult-profile-field > .tumult-dialog-label {
    display: block;
    margin-bottom: var(--space-1);
}
.tumult-profile-avatar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.tumult-profile-avatar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.tumult-profile-file {
    display: none;
}
</style>
