<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatClient, MessageView } from "@tumult/core";

import { useComposerActions, type ComposerAction, type ComposerActionContext } from "./composer-actions.ts";
import { useCommands, type Command, type ResolvedCommand } from "./commands.ts";

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

// Both are per-shell and optional: the composer is an exported primitive, so a
// standalone use (or the thread composer, which carries no roomId) renders no
// plugin affordances instead of throwing.
const composerActions = useComposerActions();
const commands = useCommands();

const draft = ref("");
const inputEl = ref<HTMLInputElement | null>(null);
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

/** Actions need a room and a client to build their context, so no context = no row. */
const visibleActions = computed<ComposerAction[]>(() =>
    composerActions && props.roomId && props.client ? composerActions.all() : [],
);

function actionContext(): ComposerActionContext | null {
    if (!props.roomId || !props.client) return null;
    return {
        roomId: props.roomId,
        client: props.client,
        draft: draft.value,
        setDraft: (text: string) => {
            draft.value = text;
        },
    };
}

function runAction(action: ComposerAction): void {
    const ctx = actionContext();
    if (!ctx) return;
    const label = `[tumult] composer action "${action.id}" failed`;
    try {
        // Promise.resolve covers both a void return and a rejected promise.
        void Promise.resolve(action.run(ctx)).catch((error) => console.error(label, error));
    } catch (error) {
        console.error(label, error);
    }
}

/**
 * While the draft is exactly `/prefix` (no whitespace yet), offer the matching
 * commands. Once there is a space the user has picked one and is typing args,
 * so the list gets out of the way.
 */
const commandSuggestions = computed<Command[]>(() => {
    if (!commands || props.disabled || !props.roomId || !props.client) return [];
    const body = draft.value;
    if (!body.startsWith("/")) return [];
    const rest = body.slice(1);
    if (/\s/.test(rest)) return [];
    return commands.suggest(rest);
});

/** Clicking a suggestion completes the draft; Enter then runs it. */
function completeSuggestion(command: Command): void {
    const rest = draft.value.slice(1);
    if (!command.name.startsWith(rest.toLowerCase())) return; // stale click
    draft.value = `/${command.name} `;
    inputEl.value?.focus();
}

function executeCommand(resolved: ResolvedCommand): void {
    if (!props.roomId || !props.client) return;
    const { command, args, raw } = resolved;
    draft.value = "";
    clearTyping();
    const label = `[tumult] command "/${command.name}" failed`;
    try {
        void Promise.resolve(
            command.run({ roomId: props.roomId, client: props.client, args, raw }),
        ).catch((error) => console.error(label, error));
    } catch (error) {
        console.error(label, error);
    }
}

function submit(): void {
    const body = draft.value.trim();
    if (!body || props.disabled) return;
    const resolved = commands && props.roomId && props.client ? commands.resolve(body) : null;
    if (resolved) {
        executeCommand(resolved);
        return;
    }
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
        <!-- Slash-command suggestions: only while the draft is `/prefix`. -->
        <div
            v-if="commandSuggestions.length > 0"
            class="tumult-composer-commands"
            aria-label="Command suggestions"
        >
            <button
                v-for="command in commandSuggestions"
                :key="command.name"
                type="button"
                class="tumult-command-suggestion"
                @click="completeSuggestion(command)"
            >
                <span class="tumult-command-name">/{{ command.name }}</span>
                <span v-if="command.usage" class="tumult-command-usage">{{ command.usage }}</span>
                <span v-if="command.description" class="tumult-command-description">
                    {{ command.description }}
                </span>
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
            <button
                v-for="action in visibleActions"
                :key="action.id"
                type="button"
                class="tumult-composer-action"
                :title="action.label"
                :aria-label="action.label"
                :disabled="disabled"
                @click="runAction(action)"
            >
                {{ action.icon ?? action.label }}
            </button>
            <input
                id="tumult-composer-input"
                ref="inputEl"
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
    border-top: var(--border-width) solid var(--border-default);
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
    border-left: var(--timeline-quote-bar-width) solid var(--accent);
    background: var(--surface-pane);
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
    font-weight: var(--weight-semibold);
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
    padding: 0 var(--space-1-5);
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-md);
    line-height: var(--leading-none);
    cursor: pointer;
}
.tumult-composer-reply-cancel:hover {
    color: var(--text-primary);
}
.tumult-composer-reply-cancel:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    border-radius: var(--radius-sm);
}
.tumult-composer-label {
    position: absolute;
    width: var(--hairline);
    height: var(--hairline);
    overflow: hidden;
    clip: rect(0 0 0 0);
}
.tumult-composer-file {
    position: absolute;
    width: var(--hairline);
    height: var(--hairline);
    overflow: hidden;
    clip: rect(0 0 0 0);
}
.tumult-composer-attach {
    flex-shrink: 0;
    width: var(--control-md);
    height: var(--control-md);
    align-self: center;
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    font-size: var(--text-md);
    line-height: var(--leading-none);
    cursor: pointer;
}
.tumult-composer-attach:hover:not(:disabled) {
    background: var(--button-secondary-bg-hover);
}
.tumult-composer-attach:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: not-allowed;
}
.tumult-composer-action {
    flex-shrink: 0;
    width: var(--control-md);
    height: var(--control-md);
    align-self: center;
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    font-size: var(--text-md);
    line-height: var(--leading-none);
    cursor: pointer;
}
.tumult-composer-action:hover:not(:disabled) {
    background: var(--button-secondary-bg-hover);
}
.tumult-composer-action:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: not-allowed;
}
.tumult-composer-commands {
    display: flex;
    flex-direction: column;
    gap: var(--hairline);
    margin: var(--space-2) var(--space-3) 0;
    padding: var(--space-1);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
}
.tumult-command-suggestion {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
}
.tumult-command-suggestion:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-command-suggestion:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
.tumult-command-name {
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
}
.tumult-command-usage {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-command-description {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-composer-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--composer-input-border);
    border-radius: var(--control-radius);
    background: var(--composer-input-bg);
    color: var(--input-text);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-composer-input:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: calc(var(--hairline) * -1);
}
.tumult-composer-send {
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--control-radius);
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
}
.tumult-composer-send:hover:not(:disabled) {
    background: var(--button-primary-bg-hover);
}
.tumult-composer-send:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: not-allowed;
}
</style>
