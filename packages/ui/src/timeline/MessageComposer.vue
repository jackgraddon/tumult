<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { AttachmentSendResult, ChatClient, MessageView, OutgoingAttachment } from "@tumult/core";

import { applyUploadLimit, fileIcon, formatBytes, previewKind, settleTray, toOutgoing } from "./attachments.ts";
import { heicToJpeg, looksHeic } from "./heic.ts";
import type { StagedAttachment } from "./attachments.ts";

import { useComposerActions, type ComposerAction, type ComposerActionContext } from "./composer-actions.ts";
import { useCommands, type Command, type ResolvedCommand } from "./commands.ts";
import { useDrafts } from "./drafts.ts";

const props = defineProps<{
    disabled?: boolean;
    /** Shown as the input placeholder when disabled for an unimplemented slice. */
    sendDisabledReason?: string;
    roomId?: string;
    client?: ChatClient;
    /** Message being replied to; shows the quote strip until sent or cancelled. */
    replyTo?: MessageView | null;
    /**
     * Sends the staged tray with the draft as its caption. Without it there is
     * no attach button and nothing can be staged (the thread composer), rather
     * than a picker whose files go nowhere.
     */
    sendAttachments?: (
        attachments: OutgoingAttachment[],
        caption: string,
    ) => Promise<AttachmentSendResult[]>;
}>();

const emit = defineEmits<{
    send: [body: string];
    cancelReply: [];
}>();

// Both are per-shell and optional: the composer is an exported primitive, so a
// standalone use (or the thread composer, which carries no roomId) renders no
// plugin affordances instead of throwing.
const composerActions = useComposerActions();
const commands = useCommands();
const drafts = useDrafts();

// Restore a half-typed draft for this room before the first paint, so a reload
// or a room switch resumes the composer where it left off rather than blank. A
// standalone composer (the thread one carries no roomId) keeps a non-persistent
// draft instead of restoring one.
const draft = ref(drafts && props.roomId ? drafts.get(props.roomId) ?? "" : "");
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

// Persist the draft to the per-room store on every change. An empty value is a
// clear (a send, a command, or a wiped input drops the entry via `set`), so the
// half-typed text is restored but a finished message is not. The store debounces
// the durable write; the in-memory map is authoritative this session.
watch(draft, (value) => {
    if (drafts && props.roomId) drafts.set(props.roomId, value);
});

// Flush a pending write on teardown so an unmount (room switch, logout) does not
// lose the last draft still waiting for its debounce.
onBeforeUnmount(() => drafts?.flush());

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
    if (props.disabled) return;
    if (converting.value) return;
    if (pending.value.length > 0) {
        // With files staged the draft is their caption, never a command.
        void sendTray(body);
        return;
    }
    if (!body) return;
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

// --- Attachment tray -------------------------------------------------------

const tray = ref<StagedAttachment[]>([]);
let nextAttachmentId = 1;
/** What a send takes: staged plus failed (a send retries both). */
const pending = computed(() =>
    tray.value.filter((item) => item.status === "staged" || item.status === "failed"),
);
/** Send waits for every HEIC to finish converting rather than send it raw. */
const converting = computed(() => tray.value.some((item) => item.status === "converting"));
const canStage = computed(() => !!props.sendAttachments && !props.disabled);

/**
 * The homeserver's advertised `m.upload.size` — read once, the first time a
 * file is staged. A proxy in front of the server may still refuse less.
 */
const uploadLimit = ref<number | null>(null);
let uploadLimitRequested = false;
function requestUploadLimit(): void {
    if (uploadLimitRequested || !props.client) return;
    uploadLimitRequested = true;
    void props.client.uploadLimit().then(
        (limit) => (uploadLimit.value = limit),
        () => undefined,
    );
}
// Judge every settled file against the limit, whichever arrives last.
watch([tray, uploadLimit], ([items, limit]) => {
    const next = applyUploadLimit(items, limit);
    if (next.some((item, i) => item !== items[i])) tray.value = next;
});

function stage(files: Iterable<File>): void {
    if (!canStage.value) return;
    requestUploadLimit();
    for (const file of files) {
        if (looksHeic(file)) {
            const item: StagedAttachment = {
                id: nextAttachmentId++,
                file,
                previewUrl: null,
                altText: "",
                status: "converting",
            };
            tray.value = [...tray.value, item];
            void convertHeic(item.id, file);
            continue;
        }
        const kind = previewKind(file);
        const item: StagedAttachment = {
            id: nextAttachmentId++,
            file,
            previewUrl: kind === "image" || kind === "video" ? URL.createObjectURL(file) : null,
            altText: "",
            status: "staged",
        };
        tray.value = [...tray.value, item];
        if (kind === "image" && item.previewUrl) measureImage(item.id, item.previewUrl);
    }
}

/**
 * Swap a HEIC for its JPEG. A file that does not decode stays as it is and
 * sends as a plain file chip — honest, if not viewable everywhere.
 */
async function convertHeic(id: number, file: File): Promise<void> {
    let converted: File | null = null;
    try {
        converted = await heicToJpeg(file);
    } catch (error) {
        console.warn(`[tumult] could not convert "${file.name}" to JPEG; sending it as-is`, error);
    }
    // Removed while converting: nothing to update.
    if (!tray.value.some((item) => item.id === id)) return;
    const previewUrl = converted ? URL.createObjectURL(converted) : null;
    tray.value = tray.value.map((item) =>
        item.id === id ? { ...item, file: converted ?? item.file, previewUrl, status: "staged" as const } : item,
    );
    if (previewUrl) measureImage(id, previewUrl);
}

/** Intrinsic size goes on the event so receivers reserve the box pre-decode. */
function measureImage(id: number, url: string): void {
    const img = new Image();
    img.onload = () => setDims(id, img.naturalWidth, img.naturalHeight);
    img.src = url;
}

function onVideoMetadata(id: number, event: Event): void {
    const video = event.target as HTMLVideoElement;
    setDims(id, video.videoWidth, video.videoHeight);
}

function setDims(id: number, width: number, height: number): void {
    if (!(width > 0) || !(height > 0)) return;
    tray.value = tray.value.map((item) => (item.id === id ? { ...item, width, height } : item));
}

/**
 * The browser cannot decode this file (HEIC outside Safari, TIFF, …): show
 * the file chip instead of a broken image. The file itself still sends.
 */
function dropPreview(id: number): void {
    tray.value = tray.value.map((item) => {
        if (item.id !== id || !item.previewUrl) return item;
        URL.revokeObjectURL(item.previewUrl);
        return { ...item, previewUrl: null };
    });
}

function setAltText(id: number, altText: string): void {
    tray.value = tray.value.map((item) => (item.id === id ? { ...item, altText } : item));
}

function release(items: readonly StagedAttachment[]): void {
    for (const item of items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

function removeStaged(id: number): void {
    const item = tray.value.find((candidate) => candidate.id === id);
    if (!item || item.status === "sending") return;
    release([item]);
    tray.value = tray.value.filter((candidate) => candidate.id !== id);
    inputEl.value?.focus();
}

async function sendTray(caption: string): Promise<void> {
    const send = props.sendAttachments;
    if (!send) return;
    const batch = pending.value;
    const ids = new Set(batch.map((item) => item.id));
    tray.value = tray.value.map((item) => (ids.has(item.id) ? { ...item, status: "sending" as const } : item));
    draft.value = "";
    clearTyping();
    let results: AttachmentSendResult[] | null = null;
    let thrown: unknown;
    try {
        results = await send(toOutgoing(batch), caption);
    } catch (error) {
        thrown = error;
        console.error("[tumult] attachment send failed", error);
    }
    for (const [i, result] of (results ?? []).entries()) {
        if (!result.ok) console.error(`[tumult] upload of "${batch[i]?.file.name}" failed`, result.error);
    }
    // Settle against the batch as sent (alt text included), then splice the
    // survivors back where they were; anything staged meanwhile stays put.
    const { keep, sent } = settleTray(batch, results, thrown, uploadLimit.value);
    release(sent);
    const kept = new Map(keep.map((item) => [item.id, item]));
    tray.value = tray.value.flatMap((item) => {
        if (!ids.has(item.id)) return [item];
        const survivor = kept.get(item.id);
        return survivor ? [survivor] : [];
    });
}

onBeforeUnmount(() => release(tray.value));

function onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    stage(Array.from(input.files ?? []));
    // Reset so picking the same file again fires the change event.
    input.value = "";
}

/** Pasted files stage; pasted text falls through to the input untouched. */
function onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0 || !canStage.value) return;
    event.preventDefault();
    stage(files);
}

function hasFiles(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");
}

function onDragOver(event: DragEvent): void {
    if (!canStage.value || !hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onDrop(event: DragEvent): void {
    if (!canStage.value || !hasFiles(event)) return;
    event.preventDefault();
    stage(Array.from(event.dataTransfer?.files ?? []));
}
</script>

<template>
    <!-- Root is a column wrapper so the reply strip sits above the input row. -->
    <div class="tumult-composer" @dragover="onDragOver" @drop="onDrop">
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
                <Icon name="close" />
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
        <!-- Staged attachments: nothing uploads until the message is sent. -->
        <ul v-if="tray.length > 0" class="tumult-composer-tray" aria-label="Attachments">
            <li
                v-for="item in tray"
                :key="item.id"
                class="tumult-composer-attachment"
                :data-status="item.status"
                :data-kind="previewKind(item.file)"
            >
                <div class="tumult-composer-attachment-preview">
                    <img
                        v-if="previewKind(item.file) === 'image' && item.previewUrl"
                        class="tumult-composer-attachment-thumb"
                        :src="item.previewUrl"
                        :alt="item.altText || item.file.name"
                        @error="dropPreview(item.id)"
                    />
                    <video
                        v-else-if="previewKind(item.file) === 'video' && item.previewUrl"
                        class="tumult-composer-attachment-thumb"
                        :src="item.previewUrl"
                        muted
                        preload="metadata"
                        @loadedmetadata="onVideoMetadata(item.id, $event)"
                        @error="dropPreview(item.id)"
                    ></video>
                    <Icon v-else :name="fileIcon(item.file)" />
                    <button
                        type="button"
                        class="tumult-composer-attachment-remove"
                        :aria-label="`Remove ${item.file.name}`"
                        :title="`Remove ${item.file.name}`"
                        :disabled="item.status === 'sending'"
                        @click="removeStaged(item.id)"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <span class="tumult-composer-attachment-name" :title="item.file.name">{{ item.file.name }}</span>
                <span class="tumult-composer-attachment-meta">
                    <template v-if="item.status === 'converting'">Converting to JPEG…</template>
                    <template v-else-if="item.status === 'sending'">Uploading…</template>
                    <template v-else-if="item.status === 'too-large' && uploadLimit !== null">
                        Too large — this server accepts up to {{ formatBytes(uploadLimit) }}
                    </template>
                    <template v-else-if="item.status === 'failed'">{{ item.failure ?? "Didn't send." }} Send to retry.</template>
                    <template v-else>{{ formatBytes(item.file.size) }}</template>
                </span>
                <input
                    v-if="previewKind(item.file) === 'image'"
                    class="tumult-composer-attachment-alt"
                    type="text"
                    placeholder="Alt text"
                    :aria-label="`Alt text for ${item.file.name}`"
                    :value="item.altText"
                    :disabled="item.status === 'sending'"
                    @input="setAltText(item.id, ($event.target as HTMLInputElement).value)"
                    @keydown.enter.prevent="submit"
                />
            </li>
        </ul>
        <form class="tumult-composer-row" @submit.prevent="submit">
            <label class="tumult-composer-label" for="tumult-composer-input">Message</label>
            <template v-if="sendAttachments">
                <button
                    class="tumult-composer-attach"
                    type="button"
                    title="Attach files"
                    aria-label="Attach files"
                    :disabled="disabled"
                    @click="openFilePicker"
                >
                    <Icon name="paperclip" />
                </button>
                <input
                    ref="fileInput"
                    class="tumult-composer-file"
                    type="file"
                    multiple
                    tabindex="-1"
                    aria-hidden="true"
                    @change="onFileSelected"
                />
            </template>
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
                <Icon v-if="action.icon" :name="action.icon" :fallback="action.label" />
                <template v-else>{{ action.label }}</template>
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
                @paste="onPaste"
            />
            <button
                class="tumult-composer-send"
                type="submit"
                :disabled="disabled || converting || (draft.trim().length === 0 && pending.length === 0)"
            >
                Send
            </button>
        </form>
    </div>
</template>

<style scoped>
.tumult-composer {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
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
    transition: color var(--motion-fast) var(--motion-ease);
}
.tumult-composer-reply-cancel:hover {
    color: var(--text-primary);
}
.tumult-composer-reply-cancel:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    border-radius: var(--radius-sm);
}
.tumult-composer-tray {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-3) 0;
    padding: 0;
    list-style: none;
}
.tumult-composer-attachment {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: var(--composer-attachment-width);
    padding: var(--space-1-5);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
}
.tumult-composer-attachment[data-status="failed"],
.tumult-composer-attachment[data-status="too-large"] {
    border-color: var(--danger);
}
.tumult-composer-attachment[data-status="sending"] {
    opacity: var(--state-disabled-opacity);
}
.tumult-composer-attachment-preview {
    position: relative;
    display: grid;
    place-items: center;
    height: var(--composer-attachment-thumb-height);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-muted);
    overflow: hidden;
}
.tumult-composer-attachment-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.tumult-composer-attachment-remove {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    display: grid;
    place-items: center;
    padding: var(--space-0-5);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--surface-pane);
    color: var(--text-secondary);
    cursor: pointer;
}
.tumult-composer-attachment-remove:hover:not(:disabled) {
    color: var(--text-primary);
}
.tumult-composer-attachment-remove:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
.tumult-composer-attachment-remove:disabled {
    cursor: not-allowed;
}
.tumult-composer-attachment-name {
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-composer-attachment-meta {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-composer-attachment[data-status="failed"] .tumult-composer-attachment-meta,
.tumult-composer-attachment[data-status="too-large"] .tumult-composer-attachment-meta {
    color: var(--danger);
}
.tumult-composer-attachment-alt {
    min-width: 0;
    padding: var(--space-0-5) var(--space-1-5);
    border: var(--border-width) solid var(--composer-input-border);
    border-radius: var(--radius-sm);
    background: var(--composer-input-bg);
    color: var(--input-text);
    font: inherit;
    font-size: var(--text-xs);
}
.tumult-composer-attachment-alt:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
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
    transition: background-color var(--motion-fast) var(--motion-ease);
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
    transition: background-color var(--motion-fast) var(--motion-ease);
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
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-composer-send:hover:not(:disabled) {
    background: var(--button-primary-bg-hover);
}
.tumult-composer-send:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: not-allowed;
}
</style>
