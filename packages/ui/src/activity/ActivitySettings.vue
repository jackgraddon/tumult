<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { computed, ref, watch } from "vue";

import type { SettingsTabProps } from "../settings/tabs.ts";
import { useActivityController } from "./controller.ts";
import { ACTIVITY_TYPES, activityElapsed, activityHeadline, activitySeconds } from "./document.ts";

defineProps<SettingsTabProps>();

const activity = useActivityController();

interface ButtonDraft {
    label: string;
    url: string;
}

const MAX_BUTTONS = 2;

const type = ref<string>("playing");
const name = ref("");
const details = ref("");
const state = ref("");
const emoji = ref("");
const buttons = ref<ButtonDraft[]>([]);
const busy = ref(false);
const saved = ref(false);
const error = ref("");

/** The saved manual draft, not the live native activity: edits are for later. */
watch(
    () => activity.draft.value,
    (document) => {
        type.value = document?.type ?? "playing";
        name.value = document?.name ?? "";
        details.value = document?.details ?? "";
        state.value = document?.state ?? "";
        emoji.value = document?.emoji ?? "";
        buttons.value = (document?.buttons ?? []).map((button) => ({ label: button.label, url: button.url }));
        saved.value = false;
        error.value = "";
    },
    { immediate: true },
);

const live = computed(() => activity.current.value);
const headline = computed(() => (live.value ? activityHeadline(live.value) : ""));
const secondLine = computed(() => (live.value ? activitySeconds(live.value) : ""));
const elapsed = computed(() => (live.value ? activityElapsed(live.value) : ""));

async function save(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    saved.value = false;
    error.value = "";
    // An untouched empty row is not a button; a half-filled one is a validation
    // error from the shared document rather than a link with no label or URL.
    const cleaned = buttons.value
        .map((button) => ({ label: button.label.trim(), url: button.url.trim() }))
        .filter((button) => button.label || button.url);
    try {
        await activity.setManual({
            type: type.value,
            name: name.value,
            details: details.value,
            state: state.value,
            emoji: emoji.value,
            buttons: cleaned,
        });
        buttons.value = cleaned;
        saved.value = true;
    } catch (cause) {
        error.value = reportError(cause, "Couldn't save your activity");
    } finally {
        busy.value = false;
    }
}

async function clear(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    saved.value = false;
    error.value = "";
    try {
        await activity.setManual(null);
        type.value = "playing";
        name.value = "";
        details.value = "";
        state.value = "";
        emoji.value = "";
        buttons.value = [];
    } catch (cause) {
        error.value = reportError(cause, "Couldn't clear your activity");
    } finally {
        busy.value = false;
    }
}

function addButton(): void {
    if (buttons.value.length >= MAX_BUTTONS) return;
    buttons.value = [...buttons.value, { label: "", url: "" }];
}

function removeButton(index: number): void {
    buttons.value = buttons.value.filter((_, at) => at !== index);
}

function onMirror(event: Event): void {
    activity.setMirror((event.target as HTMLInputElement).checked);
}
</script>

<template>
    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Activity</h3>
        <p class="tumult-settings-note">
            Your activity appears beside your name and on your profile card. It is stored
            in an extended profile field, so people who share a room with you can see it.
        </p>

        <p v-if="activity.native.value" class="tumult-activity-notice" role="status">
            A native app is publishing your activity. It takes priority over the form below;
            your saved activity returns when that app stops.
        </p>
        <p v-if="activity.supported.value === false" class="tumult-activity-notice" role="status">
            Your homeserver does not support extended profile fields. Activity below is
            kept for this session only and cannot be shown to other people.
        </p>
        <p v-if="live" class="tumult-activity-preview" :data-source="activity.source.value">
            <strong>{{ headline }}</strong>
            <template v-if="secondLine"> · {{ secondLine }}</template>
            <template v-if="elapsed"> · {{ elapsed }}</template>
        </p>

        <form class="tumult-activity-form" novalidate @submit.prevent="save">
            <div class="tumult-activity-row">
                <div class="tumult-dialog-field">
                    <label class="tumult-dialog-label" for="tumult-activity-type">Type</label>
                    <select id="tumult-activity-type" v-model="type" class="tumult-dialog-input">
                        <option v-for="option in ACTIVITY_TYPES" :key="option" :value="option">
                            {{ option.charAt(0).toUpperCase() + option.slice(1) }}
                        </option>
                    </select>
                </div>
                <div class="tumult-dialog-field">
                    <label class="tumult-dialog-label" for="tumult-activity-emoji">Emoji <span class="tumult-activity-optional">optional</span></label>
                    <input
                        id="tumult-activity-emoji"
                        v-model="emoji"
                        class="tumult-dialog-input"
                        type="text"
                        maxlength="16"
                        autocomplete="off"
                        placeholder="🎧"
                    />
                </div>
            </div>
            <div class="tumult-dialog-field">
                <label class="tumult-dialog-label" for="tumult-activity-name">Name</label>
                <input
                    id="tumult-activity-name"
                    v-model="name"
                    class="tumult-dialog-input"
                    type="text"
                    maxlength="128"
                    autocomplete="off"
                    placeholder="What you are doing"
                />
            </div>
            <div class="tumult-dialog-field">
                <label class="tumult-dialog-label" for="tumult-activity-details">Details <span class="tumult-activity-optional">optional</span></label>
                <input
                    id="tumult-activity-details"
                    v-model="details"
                    class="tumult-dialog-input"
                    type="text"
                    maxlength="128"
                    autocomplete="off"
                />
            </div>
            <div class="tumult-dialog-field">
                <label class="tumult-dialog-label" for="tumult-activity-state">State <span class="tumult-activity-optional">optional</span></label>
                <input
                    id="tumult-activity-state"
                    v-model="state"
                    class="tumult-dialog-input"
                    type="text"
                    maxlength="128"
                    autocomplete="off"
                />
            </div>
            <div class="tumult-dialog-field tumult-activity-buttons-field">
                <div class="tumult-activity-buttons-heading">
                    <span class="tumult-dialog-label">Buttons <span class="tumult-activity-optional">optional</span></span>
                    <button
                        type="button"
                        class="tumult-dialog-button tumult-activity-add-button"
                        :disabled="busy || buttons.length >= MAX_BUTTONS"
                        @click="addButton"
                    >
                        Add button
                    </button>
                </div>
                <p class="tumult-settings-note">
                    Up to two links, shown on your profile card. Labels are short; URLs must be http(s).
                </p>
                <div v-for="(button, index) in buttons" :key="index" class="tumult-activity-button-row">
                    <input
                        v-model="button.label"
                        class="tumult-dialog-input"
                        type="text"
                        :aria-label="`Activity button ${index + 1} label`"
                        maxlength="32"
                        autocomplete="off"
                        placeholder="Listen on…"
                    />
                    <input
                        v-model="button.url"
                        class="tumult-dialog-input"
                        type="url"
                        :aria-label="`Activity button ${index + 1} URL`"
                        maxlength="512"
                        autocomplete="off"
                        placeholder="https://…"
                    />
                    <button
                        type="button"
                        class="tumult-dialog-button tumult-activity-remove-button"
                        :aria-label="`Remove activity button ${index + 1}`"
                        :disabled="busy"
                        @click="removeButton(index)"
                    >
                        Remove
                    </button>
                </div>
            </div>

            <p v-if="error || activity.error.value" class="tumult-dialog-error" role="alert">
                {{ error || activity.error.value }}
            </p>
            <p v-else-if="saved" class="tumult-dialog-status" role="status">Saved.</p>
            <div class="tumult-dialog-actions">
                <button type="button" class="tumult-dialog-button" :disabled="busy" @click="clear">
                    Clear
                </button>
                <button type="submit" class="tumult-dialog-button tumult-dialog-primary" :disabled="busy">
                    {{ busy ? "Saving…" : "Save activity" }}
                </button>
            </div>
        </form>
    </section>

    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Status text</h3>
        <p class="tumult-settings-note">
            Also copy a plain-text line into your status message, for clients that do not
            understand rich activity. A status you set yourself is never overwritten.
        </p>
        <label class="tumult-dialog-check">
            <input type="checkbox" :checked="activity.mirror.value" data-testid="activity-mirror" @change="onMirror" />
            Mirror activity into my status message
        </label>
    </section>
</template>

<style scoped>
.tumult-activity-notice {
    padding: var(--space-3);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-inset);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-activity-preview {
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-activity-preview[data-source="native"] strong {
    color: var(--accent);
}
.tumult-activity-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.tumult-activity-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
}
.tumult-activity-optional {
    color: var(--text-muted);
    font-weight: var(--weight-normal);
}
.tumult-activity-buttons-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.tumult-activity-add-button,
.tumult-activity-remove-button {
    width: auto;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
}
.tumult-activity-buttons-field .tumult-settings-note {
    margin: var(--space-1) 0 0;
}
.tumult-activity-button-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
}
</style>
