<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import Icon from "../icons/Icon.vue";
import { computed, ref } from "vue";
import {
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuPortal,
    ContextMenuRoot,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
    PopoverContent,
    PopoverPortal,
    PopoverRoot,
    PopoverTrigger,
} from "reka-ui";
import type { MessageView, RoomPowerLevelsView } from "@tumult/core";

import { copyOrLog } from "../clipboard.ts";
import { buildMessageMenu, QUICK_REACTIONS } from "./messageMenu.ts";
import type { MessageMenuAction } from "./messageMenu.ts";
import { useTimelineRegistry } from "./registry.ts";
import Avatar from "../primitives/Avatar.vue";
// A dialog FRAME despite the name: the same shared shell the member dialogs
// compose (`members/ModerationConfirmDialog.vue`).
import RoomDialog from "../rooms/RoomDialog.vue";
import DecryptionPlaceholder from "./renderers/DecryptionPlaceholder.vue";
import UnknownEvent from "./renderers/UnknownEvent.vue";

const props = defineProps<{
    message: MessageView;
    /** True when the previous row shares sender+day: compact continuation. */
    grouped: boolean;
    /** The room the row belongs to: the room half of the message link. */
    roomId: string;
    /** Power levels for the room, or null while unknown (then no moderation). */
    power: RoomPowerLevelsView | null;
    /** Toggle our reaction; absent while the client can't react (fake-safe). */
    onToggleReaction?: ((targetEventId: string, emoji: string) => void) | undefined;
    /** Our user id; the edit affordance shows only on our sent messages. */
    ownUserId?: (string | null) | undefined;
    /** Save an edit; absent while the client can't edit. */
    onEditMessage?: ((targetEventId: string, newBody: string) => void) | undefined;
    /** Redact (delete) this message; absent while the client can't redact. */
    onRedactMessage?: ((targetEventId: string) => Promise<void>) | undefined;
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

/**
 * Panel renders only when an affordance will actually show inside it: an empty
 * bordered chip parked at the row's top-right on hover would be visual noise,
 * and pending/failed rows render none of the gated children.
 */
const hasActions = computed(
    () =>
        !editing.value &&
        (editable.value ||
            redactable.value ||
            replyable.value ||
            (props.onOpenThread !== undefined && props.message.decryption === "ok") ||
            (props.onToggleReaction !== undefined && props.message.decryption === "ok")),
);

/**
 * The context menu, as data: "who may do what" lives in `messageMenu.ts`, so
 * this row only maps an item's id back to the handler it was given.
 */
const menu = computed(() =>
    buildMessageMenu(props.message, {
        roomId: props.roomId,
        selfId: props.ownUserId ?? null,
        power: props.power,
        threadReplyCount: props.threadReplyCount ?? 0,
        canReact: props.onToggleReaction !== undefined && props.message.decryption === "ok",
        canReply: replyable.value,
        canEdit: editable.value,
        canDeleteOwn: redactable.value,
        canDelete: props.onRedactMessage !== undefined,
        canOpenThread: props.onOpenThread !== undefined && props.message.decryption === "ok",
    }),
);

/**
 * With nothing to offer the trigger stays disabled, which makes Reka skip its
 * `preventDefault` — so the native menu opens instead of an empty popup.
 */
const hasMenu = computed(
    () => menu.value.entries.length > 0 || menu.value.quickReactions.length > 0,
);

const sourceOpen = ref(false);
const deleteOpen = ref(false);
const deleting = ref(false);
const deleteError = ref("");

/**
 * Redaction is permanent and hits every client, so it goes through a confirm —
 * unlike edit, whose result is another message. The wording names whose message
 * it is, because a moderator sees this on someone else's row.
 */
const deleteDescription = computed(() =>
    props.message.senderId === props.ownUserId
        ? "Delete this message for everyone? This cannot be undone."
        : `Delete ${props.message.senderName}'s message for everyone? This cannot be undone.`,
);

async function confirmDelete(): Promise<void> {
    if (deleting.value) return;
    deleting.value = true;
    deleteError.value = "";
    try {
        await props.onRedactMessage?.(props.message.id);
        deleteOpen.value = false;
    } catch (cause: unknown) {
        // The dialog stays open holding the reason: a delete that did not
        // happen must not look like one that did.
        deleteError.value = reportError(cause, "Couldn't delete the message");
    } finally {
        deleting.value = false;
    }
}

function run(action: MessageMenuAction): void {
    switch (action) {
        case "reply":
            props.onReply?.(props.message);
            break;
        case "edit":
            startEdit();
            break;
        case "thread":
            props.onOpenThread?.(props.message.id);
            break;
        case "copy-text":
            copyOrLog(props.message.body, "message text");
            break;
        case "copy-link":
            if (menu.value.matrixLink) copyOrLog(menu.value.matrixLink, "message link");
            break;
        case "copy-id":
            copyOrLog(props.message.id, "message id");
            break;
        case "view-source":
            sourceOpen.value = true;
            break;
        case "delete":
            deleteOpen.value = true;
            break;
    }
}

/** What this client received, verbatim — the honest answer to "View source". */
const source = computed(() =>
    JSON.stringify({ type: props.message.type, content: props.message.content }, null, 2),
);

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
    <ContextMenuRoot>
        <ContextMenuTrigger as-child :disabled="!hasMenu">
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
                        v-if="onOpenThread && (threadReplyCount ?? 0) > 0"
                        type="button"
                        class="tumult-row-replies"
                        @click="onOpenThread?.(message.id)"
                    >
                        {{ threadReplyCount }} {{ threadReplyCount === 1 ? "reply" : "replies" }} <Icon name="chevron-right" />
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
                        v-if="message.decryption === 'ok' && message.reactions.length > 0"
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
                <!--
                    Hover affordances live OUT of the flow: they are shown by
                    `.tumult-row:hover`, and an in-flow row that grows on hover shifts
                    every message below it — which, in a virtualized timeline, moves the
                    very thing the pointer was aiming at. Absolutely positioned at the
                    row's top-right, so revealing them costs no layout.
                -->
                <div v-if="hasActions" class="tumult-row-actions">
                    <button
                        v-if="editable && !editing"
                        type="button"
                        class="tumult-row-edit"
                        aria-label="Edit message"
                        @click="startEdit"
                    >
                        <Icon name="pencil" /> edit
                    </button>
                    <button
                        v-if="redactable && !editing"
                        type="button"
                        class="tumult-row-delete"
                        aria-label="Delete message"
                        @click="onRedactMessage?.(message.id)"
                    >
                        <Icon name="delete" /> delete
                    </button>
                    <button
                        v-if="replyable && !editing"
                        type="button"
                        class="tumult-row-reply"
                        aria-label="Reply to message"
                        @click="onReply?.(message)"
                    >
                        <Icon name="reply" /> reply
                    </button>
                    <button
                        v-if="onOpenThread && message.decryption === 'ok'"
                        type="button"
                        class="tumult-row-thread"
                        aria-label="Reply in thread"
                        @click="onOpenThread?.(message.id)"
                    >
                        <Icon name="message-text" /> thread
                    </button>
                    <PopoverRoot v-if="onToggleReaction && message.decryption === 'ok'">
                        <PopoverTrigger as-child>
                            <button type="button" class="tumult-reaction-add" aria-label="Add reaction"><Icon name="emoticon-plus-outline" /></button>
                        </PopoverTrigger>
                        <PopoverPortal>
                            <PopoverContent class="tumult-reaction-popover" side="bottom" align="end">
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
            </div>
        </ContextMenuTrigger>
        <!--
            Portal content, so it is `body`-level: inside the row it would be
            clipped by the scroller and measured as part of a virtual item.
        -->
        <ContextMenuPortal v-if="hasMenu">
            <ContextMenuContent class="tumult-menu tumult-message-menu">
                <ContextMenuGroup
                    v-if="menu.quickReactions.length > 0"
                    class="tumult-quick-reactions"
                    aria-label="Quick reactions"
                >
                    <ContextMenuItem
                        v-for="emoji in menu.quickReactions"
                        :key="emoji"
                        class="tumult-reaction-pick"
                        :text-value="`react ${emoji}`"
                        @select="toggle(emoji)"
                    >
                        {{ emoji }}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <!-- One flat list: separators and the submenu are just entries. -->
                <template v-for="entry in menu.entries" :key="entry.id">
                    <ContextMenuSeparator
                        v-if="entry.kind === 'separator'"
                        class="tumult-menu-separator"
                    />
                    <ContextMenuSub v-else-if="entry.kind === 'submenu'">
                        <ContextMenuSubTrigger class="tumult-menu-item tumult-menu-sub-trigger">
                            {{ entry.label }}
                            <Icon class="tumult-menu-chevron" name="chevron-right" />
                        </ContextMenuSubTrigger>
                        <ContextMenuPortal>
                            <ContextMenuSubContent class="tumult-menu">
                                <ContextMenuGroup class="tumult-reaction-grid">
                                    <ContextMenuItem
                                        v-for="emoji in entry.emojis"
                                        :key="emoji"
                                        class="tumult-reaction-pick"
                                        :text-value="`react ${emoji}`"
                                        @select="toggle(emoji)"
                                    >
                                        {{ emoji }}
                                    </ContextMenuItem>
                                </ContextMenuGroup>
                            </ContextMenuSubContent>
                        </ContextMenuPortal>
                    </ContextMenuSub>
                    <ContextMenuItem
                        v-else
                        class="tumult-menu-item"
                        :class="{ 'tumult-menu-item-danger': entry.danger }"
                        :text-value="entry.label"
                        @select="run(entry.id)"
                    >
                        {{ entry.label }}
                    </ContextMenuItem>
                </template>
            </ContextMenuContent>
        </ContextMenuPortal>
        <!--
            The delete confirm composes the shared dialog FRAME; the source
            dialog is informational, so it keeps its own single-button markup.
        -->
        <RoomDialog
            :open="deleteOpen"
            title="Delete message?"
            :description="deleteDescription"
            submit-label="Delete"
            danger
            :busy="deleting"
            :error="deleteError"
            @close="deleteOpen = false"
            @submit="confirmDelete"
        />
        <DialogRoot :open="sourceOpen" @update:open="(value) => (sourceOpen = value)">
            <DialogPortal>
                <DialogOverlay class="tumult-dialog-overlay" />
                <DialogContent class="tumult-dialog">
                    <DialogTitle class="tumult-dialog-title">Message source</DialogTitle>
                    <DialogDescription class="tumult-dialog-desc">
                        What this client received for {{ message.id }}.
                    </DialogDescription>
                    <pre class="tumult-source-json">{{ source }}</pre>
                    <div class="tumult-dialog-actions">
                        <button
                            type="button"
                            class="tumult-dialog-button"
                            @click="sourceOpen = false"
                        >
                            Close
                        </button>
                    </div>
                </DialogContent>
            </DialogPortal>
        </DialogRoot>
    </ContextMenuRoot>
</template>

<style scoped>
.tumult-row {
    position: relative;
    display: flex;
    gap: var(--timeline-row-gap);
    padding: var(--timeline-row-padding-y) var(--timeline-row-padding-x);
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-row[data-grouped="true"] {
    padding-top: 0;
    padding-bottom: 0;
}
.tumult-row:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-row-avatar {
    margin-top: var(--space-0-5);
}
.tumult-row-gutter {
    flex-shrink: 0;
    width: var(--timeline-gutter-width);
    margin-top: var(--space-0-5);
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
    font-weight: var(--weight-semibold);
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
    outline: var(--focus-ring-outline) solid var(--accent);
    outline-offset: var(--focus-ring-offset);
    border-radius: var(--radius-sm);
}
/* Absolutely positioned, so hovering never re-flows the row. */
.tumult-row-actions {
    position: absolute;
    top: var(--space-0-5);
    right: var(--space-3);
    display: none;
    align-items: center;
    padding: var(--space-px);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    box-shadow: var(--shadow-sm);
}
.tumult-row:hover .tumult-row-actions {
    display: flex;
}
.tumult-row-edit,
.tumult-row-delete,
.tumult-row-reply,
.tumult-row-thread {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    padding: 0 var(--space-0-5);
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: color var(--motion-fast) var(--motion-ease);
}
.tumult-row-edit:hover,
.tumult-row-delete:hover,
.tumult-row-reply:hover,
.tumult-row-thread:hover {
    color: var(--text-primary);
}
.tumult-row-edit:focus-visible,
.tumult-row-delete:focus-visible,
.tumult-row-reply:focus-visible,
.tumult-row-thread:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    border-radius: var(--radius-sm);
}
.tumult-row-replies {
    display: block;
    margin-top: var(--space-0-5);
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    cursor: pointer;
}
.tumult-row-replies:hover {
    text-decoration: underline;
}
.tumult-row-replies:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.tumult-row-quote {
    margin: 0 0 var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-left: var(--timeline-quote-bar-width) solid var(--border-default);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    min-width: 0;
}
.tumult-row-quote-sender {
    display: block;
    font-weight: var(--weight-semibold);
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
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-edit-input:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: calc(var(--hairline) * -1);
}
.tumult-edit-save,
.tumult-edit-cancel {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    font-size: var(--text-xs);
    cursor: pointer;
}
.tumult-edit-save {
    border: none;
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: var(--weight-semibold);
}
.tumult-edit-save:disabled {
    opacity: var(--state-disabled-opacity);
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
    gap: var(--space-1);
    padding: var(--space-px) var(--space-1-5);
    border: var(--border-width) solid var(--border-default);
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
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
.tumult-reaction-count {
    font-weight: var(--weight-semibold);
}
.tumult-reaction-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border: var(--border-width) dashed var(--border-default);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-none);
    cursor: pointer;
}
.tumult-reaction-add:hover {
    color: var(--text-primary);
    border-color: var(--accent);
}
.tumult-reaction-pick {
    padding: var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    font-size: var(--icon-md);
    cursor: pointer;
}
.tumult-reaction-pick:hover,
.tumult-reaction-pick[data-highlighted] {
    background: var(--roomlist-item-bg-hover);
}
.tumult-readers {
    display: flex;
    align-items: center;
    margin-top: var(--space-1);
}
.tumult-reader-avatar {
    border: var(--border-width-strong) solid var(--timeline-bg);
    margin-left: var(--avatar-stack-overlap);
}
.tumult-reader-avatar:first-child {
    margin-left: 0;
}
.tumult-reader-more {
    margin-left: var(--space-0-5);
    color: var(--text-muted);
    font-size: var(--text-xs);
}
/*
    Message menu. The items themselves reuse `.tumult-reaction-pick` (the same
    emoji affordance as the hover popover), so only the containers are new.
*/
.tumult-quick-reactions {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-1) var(--space-1);
}
.tumult-reaction-grid {
    display: grid;
    grid-template-columns: repeat(4, auto);
    gap: var(--space-1);
}
/* View source: viewport-relative cap, like the settings dialog's own. */
.tumult-source-json {
    max-height: 50vh;
    margin: 0 0 var(--space-3);
    padding: var(--space-2);
    overflow: auto;
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-inset);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>

<style>
.tumult-reaction-popover {
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-1-5);
    border: var(--border-width) solid var(--popover-border);
    border-radius: var(--control-radius);
    background: var(--popover-bg);
    box-shadow: var(--popover-shadow);
}
</style>
