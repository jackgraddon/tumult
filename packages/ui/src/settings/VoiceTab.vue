<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { computed, ref } from "vue";
import { DEFAULT_VOICE_SETTINGS } from "@tumult/core/contract";
import type { VoiceSettings } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import type { SettingsTabProps } from "./tabs.ts";

// Microphone processing for voice and video calls. The browser's echo canceller,
// noise suppressor and auto-gain exist for a laptop microphone in a room, and
// they colour a clean signal, so someone with a good microphone can turn them
// off. A change applies to a call already open; there is nothing to save.
const props = defineProps<SettingsTabProps>();

const settings = useSubscribable(props.client.voiceSettings);
const voice = useSubscribable(props.client.voice);
const error = ref<string | null>(null);

interface Option {
    key: keyof VoiceSettings;
    label: string;
    detail: string;
}

const OPTIONS: Option[] = [
    {
        key: "echoCancellation",
        label: "Echo cancellation",
        detail: "Stops other people hearing themselves through your speakers. Keep it on unless you always wear headphones.",
    },
    {
        key: "noiseSuppression",
        label: "Noise suppression",
        detail: "Filters steady background noise such as fans, at some cost to how natural your voice sounds. Turn it off for a quiet room and a good microphone.",
    },
    {
        key: "autoGainControl",
        label: "Automatic gain",
        detail: "Levels your volume for you. Turn it off to keep your own dynamics, and set your level in your system's sound settings.",
    },
];

const isDefault = computed(() => OPTIONS.every((option) => settings.value[option.key] === DEFAULT_VOICE_SETTINGS[option.key]));
const raw = computed(() => OPTIONS.every((option) => !settings.value[option.key]));

async function change(change: Partial<VoiceSettings>): Promise<void> {
    error.value = null;
    try {
        await props.client.setVoiceSettings(change);
    } catch (cause) {
        // The choice is saved even when re-opening the live microphone fails.
        error.value = reportError(cause, "Couldn't save voice settings");
    }
}

function toggle(option: Option, event: Event): void {
    void change({ [option.key]: (event.target as HTMLInputElement).checked });
}
</script>

<template>
    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Microphone processing</h3>
        <p class="tumult-settings-note">
            These apply to your microphone only, never to a screen you share.
            <template v-if="voice">They are applied to your current call as you change them.</template>
        </p>
        <ul class="tumult-voice-options">
            <li v-for="option in OPTIONS" :key="option.key" class="tumult-voice-option">
                <label class="tumult-dialog-check">
                    <input type="checkbox" :checked="settings[option.key]" :data-testid="`voice-${option.key}`" @change="toggle(option, $event)" />
                    {{ option.label }}
                </label>
                <p class="tumult-settings-note">{{ option.detail }}</p>
            </li>
        </ul>
        <p v-if="raw" class="tumult-settings-note" role="status">
            Sending your microphone unprocessed. Wear headphones, or others may hear themselves echo.
        </p>
        <p v-if="error" class="tumult-voice-error" role="alert">Could not update the live microphone: {{ error }}</p>
        <button type="button" class="tumult-voice-reset" :disabled="isDefault" @click="change({ ...DEFAULT_VOICE_SETTINGS })">
            Reset to defaults
        </button>
    </section>
</template>

<style scoped>
.tumult-voice-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
}
.tumult-voice-option .tumult-settings-note {
    margin: var(--space-0-5) 0 0;
    padding-left: var(--space-6);
}
.tumult-voice-error {
    color: var(--danger);
    font-size: var(--text-sm);
}
.tumult-voice-reset {
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    font: inherit;
    cursor: pointer;
}
.tumult-voice-reset:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: default;
}
</style>
