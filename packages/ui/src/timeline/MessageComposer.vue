<script setup lang="ts">
import { ref, watch } from "vue";
import type { ChatClient, MessageView } from "@tumult/core";

const props = defineProps<{
    disabled?: boolean;
    /** Shown as the input placeholder when disabled for an unimplemented slice. */
    sendDisabledReason?: string;
    roomId?: string;
    client?: ChatClient;
    /** Message being replied to; shows the quote strip until sent or cancelled. */
    replyTo?: MessageView | null;
}>();

const emit = defineEmits<{
    send: [body: string];
    sendFile: [file: File];
    cancelReply: [];
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
    <!-- Root is a column wrapper so the reply strip sits above the input row. -->
    <div class="tumult-composer">
        <div v-if="replyTo" class="tumult-composer-reply" role="status">
            <div class="tumult-composer-reply-text">
                <span class="tumult-composer-reply-name" :title="replyTo.senderId">
                    Replying to {{ replyTo.senderName }}
                </span>
                <span class="tumult-composer-reply-body">{{ replyTo.body }}</span>
            </div>
            <button
                type="button"
                class="tumult-composer-reply-cancel"
                aria-label="Cancel reply"
                @click="emit('cancelReply')"
            >
                ×
            </button>
        </div>
        <form class="tumult-composer-row" @submit.prevent="submit">
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
    </div>
</template>

<style scoped>
.tumult-composer {
    display: flex;
    flex-direction: column;
    background: var(--composer-bg);
    border-top: 1px solid var(--border-default);
}
.tumult-composer-row {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
}
.tumult-composer-reply {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-3) 0;
    padding: var(--space-1) var(--space-2);
    border-left: 3px solid var(--accent);
    background: var(--surface-pane, var(--surface-base));
}
.tumult-composer-reply-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.tumult-composer-reply-name {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
}
.tumult-composer-reply-body {
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-composer-reply-cancel {
    flex-shrink: 0;
    padding: 0 6px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-md);
    line-height: 1;
    cursor: pointer;
}
.tumult-composer-reply-cancel:hover {
    color: var(--text-primary);
}
.tumult-composer-reply-cancel:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    border-radius: var(--radius-sm);
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
