<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import type { DeviceView } from "@tumult/core";

import Avatar from "../primitives/Avatar.vue";
import Icon from "../icons/Icon.vue";
import { copyText } from "../clipboard.ts";
import { useSubscribable } from "../subscribable.ts";
import type { SettingsTabProps } from "./tabs.ts";

const props = defineProps<SettingsTabProps>();

const profile = useSubscribable(props.client.profile);
const session = useSubscribable(props.client.session);

// --- Profile form ------------------------------------------------------------

const displayName = ref("");
const file = ref<File | null>(null);
const removing = ref(false);
const busy = ref(false);
const error = ref("");
const saved = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// The preview blob URL must be revoked whenever it stops being the shown
// avatar, and when the page unmounts (switching page or closing settings).
let previewUrl: string | null = null;

function revokePreview(): void {
    if (previewUrl !== null) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
}

onScopeDispose(revokePreview);

/** Seed the form from the live profile, dropping any pending edit. */
function reset(): void {
    revokePreview();
    displayName.value = profile.value?.displayName ?? "";
    file.value = null;
    removing.value = false;
    error.value = "";
    if (fileInput.value) fileInput.value.value = "";
}

// The page mounts on every visit (inactive tabs unmount), so seeding once is a
// fresh form each time. The profile can also land after mount (it is a feed):
// adopt it then, unless the user has started typing.
reset();
watch(
    () => profile.value?.displayName,
    () => {
        if (!dirty.value) reset();
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

watch(dirty, (isDirty) => {
    if (isDirty) saved.value = false;
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
            reset();
            saved.value = true;
        })
        .catch((cause: unknown) => {
            error.value = reportError(cause, "Couldn't save your profile");
        })
        .finally(() => {
            busy.value = false;
        });
}

// --- User id -----------------------------------------------------------------

const copied = ref(false);

async function copyUserId(): Promise<void> {
    const userId = session.value?.userId;
    if (!userId) return;
    const ok = await copyText(userId);
    if (!ok) console.error("Could not copy user id to the clipboard");
    copied.value = ok;
}

// --- Devices -----------------------------------------------------------------

// `null` while loading, a string when the read failed: an empty list is a real
// answer, so it must not double as "unknown".
const devices = ref<DeviceView[] | null>(null);
const devicesError = ref("");

async function loadDevices(): Promise<void> {
    devicesError.value = "";
    try {
        devices.value = await props.client.listDevices();
    } catch (cause) {
        devices.value = null;
        devicesError.value = reportError(cause, "Couldn't load your sessions");
    }
}

onMounted(() => void loadDevices());

const sortedDevices = computed(() =>
    [...(devices.value ?? [])].sort(
        (a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.lastSeenTs ?? 0) - (a.lastSeenTs ?? 0),
    ),
);

function lastSeen(device: DeviceView): string {
    if (device.isCurrent) return "This device";
    if (device.lastSeenTs === null) return "Last seen unknown";
    return `Last seen ${new Date(device.lastSeenTs).toLocaleString()}`;
}
</script>

<template>
    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Profile</h3>
        <p class="tumult-settings-note">
            Your display name and avatar are visible to everyone who shares a room with you.
        </p>
        <form class="tumult-account-profile" novalidate @submit.prevent="submit">
            <div class="tumult-account-avatar">
                <Avatar :label="displayName || profile?.userId || '?'" :src="avatarPreview" size="lg" />
                <div class="tumult-account-avatar-actions">
                    <input
                        ref="fileInput"
                        class="tumult-account-file"
                        type="file"
                        accept="image/*"
                        tabindex="-1"
                        aria-hidden="true"
                        @change="onFileSelected"
                    />
                    <button type="button" class="tumult-dialog-button" @click="fileInput?.click()">
                        Choose image…
                    </button>
                    <button v-if="removing" type="button" class="tumult-dialog-button" @click="removing = false">
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
            <p v-if="removing" class="tumult-settings-note">Your avatar will be removed when you save.</p>
            <p v-if="error" class="tumult-dialog-error" role="alert">{{ error }}</p>
            <p v-else-if="saved" class="tumult-dialog-status" role="status">Saved.</p>
            <div class="tumult-dialog-actions">
                <button type="button" class="tumult-dialog-button" :disabled="!dirty || busy" @click="reset">
                    Reset
                </button>
                <button
                    type="submit"
                    class="tumult-dialog-button tumult-dialog-primary"
                    :disabled="!dirty || busy"
                >
                    {{ busy ? "Saving…" : "Save" }}
                </button>
            </div>
        </form>
    </section>

    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">User ID</h3>
        <div class="tumult-account-id">
            <code class="tumult-account-id-value">{{ session?.userId ?? "Signed out" }}</code>
            <button
                type="button"
                class="tumult-dialog-button"
                :disabled="!session"
                @click="copyUserId"
            >
                {{ copied ? "Copied" : "Copy" }}
            </button>
        </div>
    </section>

    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Sessions</h3>
        <p class="tumult-settings-note">
            Every device signed in to this account. Verify an unverified one from the Security page.
        </p>
        <p v-if="devicesError" class="tumult-dialog-error" role="alert">
            Could not load your sessions: {{ devicesError }}
            <button type="button" class="tumult-dialog-button" @click="loadDevices">Retry</button>
        </p>
        <p v-else-if="devices === null" class="tumult-dialog-status" role="status">Loading…</p>
        <ul v-else class="tumult-account-devices">
            <li v-for="device in sortedDevices" :key="device.id" class="tumult-account-device">
                <Icon :name="device.verified ? 'shield-check' : 'alert'" />
                <span class="tumult-account-device-text">
                    <span class="tumult-account-device-name">{{ device.displayName ?? device.id }}</span>
                    <span class="tumult-account-device-detail">
                        {{ device.verified ? "Verified" : "Unverified" }} · {{ lastSeen(device) }} · {{ device.id }}
                    </span>
                </span>
            </li>
        </ul>
    </section>
</template>

<style scoped>
.tumult-account-profile {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.tumult-account-avatar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.tumult-account-avatar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.tumult-account-file {
    display: none;
}
.tumult-account-profile .tumult-dialog-actions {
    margin-top: 0;
}
.tumult-account-id {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}
.tumult-account-id-value {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--control-radius);
    background: var(--surface-inset);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
}
.tumult-account-devices {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-account-device {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    font-size: var(--icon-md);
}
.tumult-account-device-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.tumult-account-device-name {
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
}
.tumult-account-device-detail {
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}
</style>
