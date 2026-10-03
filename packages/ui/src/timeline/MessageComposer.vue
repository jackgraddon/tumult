<script setup lang="ts">
import { ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

const props = defineProps<{
    disabled?: boolean;
    /** Shown as the input placeholder when disabled for an unimplemented slice. */
    sendDisabledReason?: string;
    roomId?: string;
    client?: ChatClient;
}>();

const emit = defineEmits<{
    send: [body: string];
    sendFile: [file: File];
}>();

const draft = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
let typingSent = false;
let typingTimer: ReturnType<typeof setTimeout> | null = null;

function clearTyping(): void {
    if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
    }
    if (typingSent && props.client && props.roomId) {
        typingSent = false;
        void props.client.sendTyping(props.roomId, false).catch(() => undefined);
    }
}

// Report typing while the draft is non-empty; clear on empty/blur/send.
watch(draft, (value) => {
    if (props.disabled || !props.client || !props.roomId) return;
    if (value.trim().length > 0) {
        if (!typingSent) {
            typingSent = true;
            void props.client.sendTyping(props.roomId, true).catch(() => undefined);
        }
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = setTimeout(clearTyping, 15_000);
    } else {
        clearTyping();
    }
});

function submit(): void {
    const body = draft.value.trim();
    if (!body || props.disabled) return;
    emit("send", body);
    draft.value = "";
    clearTyping();
}

function openFilePicker(): void {
    if (props.disabled) return;
    fileInput.value?.click();
}

function onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file && !props.disabled) {
        emit("sendFile", file);
    }
    // Reset so picking the same file again fires the change event.
    input.value = "";
}
</script>

<template>
    <form class="tumult-composer" @submit.prevent="submit">
        <label class="tumult-composer-label" for="tumult-composer-input">Message</label>
        <button
            class="tumult-composer-attach"
            type="button"
            title="Attach a file"
            :disabled="disabled"
            @click="openFilePicker"
        >
            +
        </button>
        <input
            ref="fileInput"
            class="tumult-composer-file"
            type="file"
            tabindex="-1"
            aria-hidden="true"
            @change="onFileSelected"
        />
        <input
            id="tumult-composer-input"
            v-model="draft"
            class="tumult-composer-input"
            type="text"
            :placeholder="sendDisabledReason ?? 'Send a message'"
            autocomplete="off"
            :disabled="disabled"
        />
        <button class="tumult-composer-send" type="submit" :disabled="disabled || draft.trim().length === 0">
            Send
        </button>
    </form>
</template>

<style scoped>
.tumult-composer {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--composer-bg);
    border-top: 1px solid var(--border-default);
}
.tumult-composer-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
}
.tumult-composer-file {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
}
.tumult-composer-attach {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    align-self: center;
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font-size: var(--text-md);
    line-height: 1;
    cursor: pointer;
}
.tumult-composer-attach:hover:not(:disabled) {
    background: var(--surface-hover, var(--surface-base));
}
.tumult-composer-attach:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.tumult-composer-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-composer-input:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: -1px;
}
.tumult-composer-send {
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--control-radius);
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
}
.tumult-composer-send:hover:not(:disabled) {
    background: var(--button-primary-bg-hover);
}
.tumult-composer-send:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
