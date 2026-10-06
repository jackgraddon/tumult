<script setup lang="ts">
import { computed, ref } from "vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import type { MessageView } from "@tumult/core";

import { useTimelineRegistry } from "./registry.ts";
import Avatar from "../primitives/Avatar.vue";
import DecryptionPlaceholder from "./renderers/DecryptionPlaceholder.vue";
import UnknownEvent from "./renderers/UnknownEvent.vue";

const props = defineProps<{
    message: MessageView;
    /** True when the previous row shares sender+day: compact continuation. */
    grouped: boolean;
    /** Toggle our reaction; absent while the client can't react (fake-safe). */
    onToggleReaction?: ((targetEventId: string, emoji: string) => void) | undefined;
    /** Our user id; the edit affordance shows only on our sent messages. */
    ownUserId?: (string | null) | undefined;
    /** Save an edit; absent while the client can't edit. */
    onEditMessage?: ((targetEventId: string, newBody: string) => void) | undefined;
    /** Redact (delete) this message; absent while the client can't redact. */
    onRedactMessage?: ((targetEventId: string) => void) | undefined;
    /** Retry a failed send; absent while the client can't retry. */
    onRetrySend?: ((eventId: string) => void) | undefined;
    /** Open a thread on this message. */
    onOpenThread?: ((rootEventId: string) => void) | undefined;
    /** Start an inline reply to this message. */
    onReply?: ((message: MessageView) => void) | undefined;
    /** Replies in the thread rooted at this message; 0 when it isn't a root. */
    threadReplyCount?: number;
    /** userId -> profile, from senders in view; readers who haven't spoken show initials. */
    profiles?: ReadonlyMap<string, { name: string; avatarUrl: string | null }> | undefined;
}>();

/** Fixed palette; the OS picker covers the long tail. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👀", "🚀"];

const registry = useTimelineRegistry();
const renderer = computed(() => registry.resolve(props.message, UnknownEvent));
const time = computed(() =>
    new Date(props.message.timestamp).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }),
);
// No target info at all (unloaded history, client without fallback): still
// show the block so the row reads as a reply, just without the quote.
const quoteSender = computed(
    () => props.message.reply?.senderName || props.message.reply?.senderId || "Original message",
);

/** Reply only to messages with a real server id — echoes don't resolve. */
const replyable = computed(
    () =>
        props.onReply !== undefined &&
        props.message.decryption === "ok" &&
        props.message.status === "sent",
);

function toggle(emoji: string): void {
    props.onToggleReaction?.(props.message.id, emoji);
}

const editable = computed(
    () =>
        props.onEditMessage !== undefined &&
        props.ownUserId !== undefined &&
        props.ownUserId !== null &&
        props.message.senderId === props.ownUserId &&
        props.message.decryption === "ok" &&
        props.message.status === "sent" &&
        !props.message.redacted,
);

/** Same gate as editing: our own live messages only — tombstones can't re-die. */
const redactable = computed(
    () =>
        props.onRedactMessage !== undefined &&
        props.ownUserId !== undefined &&
        props.ownUserId !== null &&
        props.message.senderId === props.ownUserId &&
        props.message.decryption === "ok" &&
        props.message.status === "sent" &&
        !props.message.redacted,
);

const editing = ref(false);
const draft = ref("");

function startEdit(): void {
    draft.value = props.message.body;
    editing.value = true;
}

function saveEdit(): void {
    const body = draft.value.trim();
    editing.value = false;
    if (body.length > 0 && body !== props.message.body) {
        props.onEditMessage?.(props.message.id, body);
    }
}

function cancelEdit(): void {
    editing.value = false;
}
</script>

<template>
    <!--
        Cross-cutting state is gated HERE, before renderer resolution.
        The registered renderer never sees pending/failed payloads, so no
        future game renderer can get the E2EE placeholder states wrong.
    -->
    <div
        class="tumult-row"
        :data-grouped="grouped ? 'true' : 'false'"
        :data-status="message.status"
        :data-decryption="message.decryption"
    >
        <Avatar
            v-if="!grouped"
            :label="message.senderName"
            :src="message.senderAvatarUrl"
            size="sm"
            class="tumult-row-avatar"
        />
        <!-- Gutter keeps grouped bodies aligned under the text above without a second avatar. -->
        <span v-else class="tumult-row-gutter" aria-hidden="true" />
        <div class="tumult-row-body">
            <div v-if="!grouped" class="tumult-row-header">
                <span class="tumult-row-sender" :title="message.senderId">{{ message.senderName }}</span>
                <time class="tumult-row-time" :dateTime="new Date(message.timestamp).toISOString()">
                    {{ time }}
                </time>
                <span v-if="message.status === 'sending'" class="tumult-row-flag">sending…</span>
                <span v-else-if="message.status === 'failed'" class="tumult-row-flag tumult-row-flag-failed">
                    not sent
                </span>
                <button
                    v-if="message.status === 'failed' && onRetrySend"
                    type="button"
                    class="tumult-row-flag tumult-row-flag-retry"
                    aria-label="Try sending again"
                    @click="onRetrySend(message.id)"
                >
                    try again
                </button>
                <span v-if="message.edited" class="tumult-row-flag" title="Edited">(edited)</span>
            </div>
            <!-- Quote sits above the body; gated to decrypted rows like the renderer. -->
            <blockquote
                v-if="message.reply && message.decryption === 'ok'"
                class="tumult-row-quote"
                :title="message.reply.eventId"
            >
                <span class="tumult-row-quote-sender">{{ quoteSender }}</span>
                <span v-if="message.reply.body" class="tumult-row-quote-body">{{ message.reply.body }}</span>
            </blockquote>
            <DecryptionPlaceholder
                v-if="message.decryption === 'pending' || message.decryption === 'failed'"
                :message="message"
            />
            <component :is="renderer" v-else-if="!editing" :message="message" />
                <button
                    v-if="editable && !editing"
                    type="button"
                    class="tumult-row-edit"
                    aria-label="Edit message"
                    @click="startEdit"
                >
                    ✎ edit
                </button>
                <button
                    v-if="redactable && !editing"
                    type="button"
                    class="tumult-row-delete"
                    aria-label="Delete message"
                    @click="onRedactMessage?.(message.id)"
                >
                    🗑 delete
                </button>
                <button
                    v-if="replyable && !editing"
                    type="button"
                    class="tumult-row-reply"
                    aria-label="Reply to message"
                    @click="onReply?.(message)"
                >
                    ↩ reply
                </button>
                <button
                    v-if="onOpenThread && message.decryption === 'ok'"
                    type="button"
                    class="tumult-row-thread"
                    aria-label="Reply in thread"
                    @click="onOpenThread?.(message.id)"
                >
                    💬 thread
                </button>
            <button
                v-if="onOpenThread && (threadReplyCount ?? 0) > 0"
                type="button"
                class="tumult-row-replies"
                @click="onOpenThread?.(message.id)"
            >
                {{ threadReplyCount }} {{ threadReplyCount === 1 ? "reply" : "replies" }} ›
            </button>
            <form v-if="editing" class="tumult-edit-form" @submit.prevent="saveEdit">
                <input
                    v-model="draft"
                    class="tumult-edit-input"
                    type="text"
                    aria-label="Edit message"
                    @keydown.escape="cancelEdit"
                />
                <button type="submit" class="tumult-edit-save" :disabled="draft.trim().length === 0">
                    Save
                </button>
                <button type="button" class="tumult-edit-cancel" @click="cancelEdit">Cancel</button>
            </form>
            <div
                v-if="message.decryption === 'ok' && (message.reactions.length > 0 || onToggleReaction)"
                class="tumult-reactions"
            >
                <button
                    v-for="reaction in message.reactions"
                    :key="reaction.emoji"
                    type="button"
                    class="tumult-reaction-chip"
                    :data-own="reaction.ownReacted ? 'true' : 'false'"
                    :aria-label="`${reaction.emoji}: ${reaction.count}, ${reaction.ownReacted ? 'including you. Activate to remove.' : 'activate to add yours.'}`"
                    :disabled="!onToggleReaction"
                    @click="toggle(reaction.emoji)"
                >
                    <span aria-hidden="true">{{ reaction.emoji }}</span>
                    <span class="tumult-reaction-count">{{ reaction.count }}</span>
                </button>
                <PopoverRoot v-if="onToggleReaction">
                    <PopoverTrigger as-child>
                        <button type="button" class="tumult-reaction-add" aria-label="Add reaction">+</button>
                    </PopoverTrigger>
                    <PopoverPortal>
                        <PopoverContent class="tumult-reaction-popover" side="top" align="start">
                            <button
                                v-for="emoji in QUICK_REACTIONS"
                                :key="emoji"
                                type="button"
                                class="tumult-reaction-pick"
                                :aria-label="`React with ${emoji}`"
                                @click="toggle(emoji)"
                            >
                                {{ emoji }}
                            </button>
                        </PopoverContent>
                    </PopoverPortal>
                </PopoverRoot>
            </div>
            <div
                v-if="message.decryption === 'ok' && message.readBy.length > 0"
                class="tumult-readers"
                :title="`Read by ${message.readBy.map((u) => profiles?.get(u)?.name ?? u).join(', ')}`"
            >
                <Avatar
                    v-for="userId in message.readBy.slice(0, 4)"
                    :key="userId"
                    :label="profiles?.get(userId)?.name ?? userId"
                    :src="profiles?.get(userId)?.avatarUrl"
                    size="sm"
                    class="tumult-reader-avatar"
                />
                <span v-if="message.readBy.length > 4" class="tumult-reader-more">
                    +{{ message.readBy.length - 4 }}
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.tumult-row {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
}
.tumult-row[data-grouped="true"] {
    padding-top: 0;
    padding-bottom: 0;
}
.tumult-row:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-row-avatar {
    margin-top: 2px;
}
.tumult-row-gutter {
    flex-shrink: 0;
    width: 24px;
    margin-top: 2px;
}
.tumult-row-body {
    min-width: 0;
    flex: 1;
}
.tumult-row-header {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
}
.tumult-row-sender {
    font-weight: 600;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
}
.tumult-row-time {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-row-flag {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-style: italic;
}
.tumult-row-flag-failed {
    color: var(--danger);
}
.tumult-row-flag-retry {
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
}
.tumult-row-flag-retry:hover {
    color: var(--danger);
}
.tumult-row-flag-retry:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm, 3px);
}
.tumult-row-edit,
.tumult-row-delete {
    display: none;
    align-items: center;
    padding: 0 2px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
}
.tumult-row:hover .tumult-row-edit,
.tumult-row:hover .tumult-row-delete,
.tumult-row-edit:focus-visible,
.tumult-row-delete:focus-visible {
    display: inline-flex;
}
.tumult-row-edit:focus-visible,
.tumult-row-delete:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    border-radius: var(--radius-sm);
}
.tumult-row-replies {
    display: block;
    margin-top: 2px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
}
.tumult-row-replies:hover {
    text-decoration: underline;
}
.tumult-row-replies:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 2px;
}
.tumult-row-thread {
    display: none;
    align-items: center;
    padding: 0 2px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
}
.tumult-row:hover .tumult-row-thread,
.tumult-row-thread:focus-visible {
    display: inline-flex;
}
.tumult-row-thread:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    border-radius: var(--radius-sm);
}
.tumult-row-reply {
    display: none;
    align-items: center;
    padding: 0 2px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
}
.tumult-row:hover .tumult-row-reply,
.tumult-row-reply:focus-visible {
    display: inline-flex;
}
.tumult-row-reply:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    border-radius: var(--radius-sm);
}
.tumult-row-quote {
    margin: 0 0 var(--space-1);
    padding: 2px var(--space-2);
    border-left: 3px solid var(--border-default);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    min-width: 0;
}
.tumult-row-quote-sender {
    display: block;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-row-quote-body {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-word;
}
.tumult-edit-form {
    display: flex;
    gap: var(--space-1);
    margin-top: var(--space-1);
}
.tumult-edit-input {
    flex: 1;
    min-width: 0;
    padding: 4px var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-edit-input:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: -1px;
}
.tumult-edit-save,
.tumult-edit-cancel {
    padding: 4px var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font-size: var(--text-xs);
    cursor: pointer;
}
.tumult-edit-save {
    border: none;
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: 600;
}
.tumult-edit-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.tumult-reactions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
}
.tumult-reaction-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    background: var(--surface-pane);
    color: var(--text-primary);
    font-size: var(--text-xs);
    cursor: pointer;
}
.tumult-reaction-chip[data-own="true"] {
    border-color: var(--accent);
    background: var(--surface-active);
}
.tumult-reaction-chip:disabled {
    cursor: default;
}
.tumult-reaction-chip:focus-visible,
.tumult-reaction-add:focus-visible,
.tumult-reaction-pick:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 1px;
}
.tumult-reaction-count {
    font-weight: 600;
}
.tumult-reaction-add {
    display: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px dashed var(--border-default);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1;
    cursor: pointer;
}
.tumult-row:hover .tumult-reaction-add,
.tumult-reaction-add:focus-visible {
    display: inline-flex;
}
.tumult-reaction-pick {
    padding: 4px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    font-size: 20px;
    cursor: pointer;
}
.tumult-reaction-pick:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-readers {
    display: flex;
    align-items: center;
    margin-top: var(--space-1);
}
.tumult-reader-avatar {
    border: 2px solid var(--timeline-bg);
    margin-left: -8px;
}
.tumult-reader-avatar:first-child {
    margin-left: 0;
}
.tumult-reader-more {
    margin-left: 2px;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
</style>

<style>
.tumult-reaction-popover {
    display: flex;
    gap: 2px;
    padding: 6px;
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
</style>
