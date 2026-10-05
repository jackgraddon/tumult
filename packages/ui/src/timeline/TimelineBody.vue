<script setup lang="ts">
import { onScopeDispose, shallowRef, watch } from "vue";
import type { ChatClient, MessageView, Subscribable, Subscription, ThreadSummary } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import TimelineViewport from "./TimelineViewport.vue";
import MessageComposer from "./MessageComposer.vue";

const props = defineProps<{
    client: ChatClient;
    roomId: string;
    /** Hide the thread affordance when the server has no thread support. */
    threadsEnabled?: boolean;
    /** The room's `m.fully_read` marker; drives the "New messages" divider. */
    fullyReadEventId?: string | null | undefined;
    /** Search result jump: scroll the viewport to this id (nonce = repeat-safe). */
    focusRequest?: { id: string; nonce: number } | null | undefined;
}>();

const emit = defineEmits<{
    "open-thread": [rootEventId: string];
}>();

/**
 * `timeline()` still throws until slice 4. Catch it here and render an
 * explicit placeholder instead of letting the setup throw leave a zombie
 * vnode that crashes every later patch (`emitsOptions` of null).
 */
let source: Subscribable<MessageView[]> | null = null;
try {
    source = props.client.timeline(props.roomId);
} catch {
    source = null;
}

const messages = source ? useSubscribable(source) : null;
const session = useSubscribable(props.client.session);
const typing = useSubscribable(props.client.typing);

// rootEventId -> reply count, for the "N replies" link on root rows. Thread
// replies live in their thread, not this timeline, so without this a root
// row gives no hint a conversation hangs off it. Subscribed lazily: capability
// is only known once syncing, and threads() throws before start().
const threadReplies = shallowRef<ReadonlyMap<string, number>>(new Map());
let threadSub: Subscription | null = null;
watch(
    () => props.threadsEnabled,
    (enabled) => {
        if (!enabled || threadSub) return;
        try {
            const list = props.client.threads(props.roomId);
            const publish = (threads: readonly ThreadSummary[]): void => {
                threadReplies.value = new Map(threads.map((t) => [t.rootEventId, t.replyCount]));
            };
            publish(list.get());
            threadSub = list.subscribe(publish);
        } catch {
            threadSub = null;
        }
    },
    { immediate: true },
);
onScopeDispose(() => threadSub?.unsubscribe());

async function loadMore(): Promise<boolean> {
    return props.client.loadMore(props.roomId);
}

async function toggleReaction(targetEventId: string, emoji: string): Promise<void> {
    // Failure surfaces on the next rebuild (or not at all for a no-op);
    // log instead of leaving an unhandled rejection.
    try {
        await props.client.toggleReaction(props.roomId, targetEventId, emoji);
    } catch (error) {
        console.error("[tumult] reaction failed", error);
    }
}

async function readLatest(): Promise<void> {
    try {
        await props.client.markRead(props.roomId);
    } catch (error) {
        console.error("[tumult] mark read failed", error);
    }
}

async function editMessage(targetEventId: string, newBody: string): Promise<void> {
    try {
        await props.client.edit(props.roomId, targetEventId, newBody);
    } catch (error) {
        console.error("[tumult] edit failed", error);
    }
}

async function redactMessage(targetEventId: string): Promise<void> {
    // No confirm dialog (matches edit's immediacy): the request is one
    // redaction, the tombstone lands on the next sync. Failure logs — the
    // message stays intact, which is its own honest feedback.
    try {
        await props.client.redact(props.roomId, targetEventId);
    } catch (error) {
        console.error("[tumult] redact failed", error);
    }
}

function openThread(rootEventId: string): void {
    // Bubbles to the shell via TimelinePane.
    emit("open-thread", rootEventId);
}

// Inline reply target. Owned here (not the composer): the row sets it, the
// send clears it. TimelineBody is keyed per room by TimelinePane, so a room
// switch can never carry a target across.
const replyTo = shallowRef<MessageView | null>(null);

function startReply(message: MessageView): void {
    replyTo.value = message;
}

function cancelReply(): void {
    replyTo.value = null;
}

async function onSend(body: string): Promise<void> {
    // Clear the context with the send attempt: the composer moves on, and a
    // failure still surfaces in-timeline via the `failed` flag.
    const target = replyTo.value;
    replyTo.value = null;
    // Failure is already visible in-timeline via the `failed` flag; log
    // instead of leaving an unhandled rejection.
    try {
        await props.client.send(props.roomId, body, target?.id);
    } catch (error) {
        console.error("[tumult] send failed", error);
    }
}

async function onSendFile(file: File): Promise<void> {
    try {
        await props.client.sendMediaMessage(props.roomId, file);
    } catch (error) {
        console.error("[tumult] media send failed", error);
    }
}
</script>

<template>
    <div v-if="!messages" class="tumult-timeline-todo" role="status">
        <p>Timeline read lands in slice 4 — this room is selected, nothing is faked.</p>
    </div>
    <template v-else>
        <TimelineViewport :messages="messages" :load-more="loadMore" :on-toggle-reaction="toggleReaction" :on-read-latest="readLatest" :own-user-id="session?.userId" :on-edit-message="editMessage" :on-redact-message="redactMessage" :fully-read-event-id="fullyReadEventId" :focus-request="focusRequest" :on-open-thread="threadsEnabled ? openThread : undefined" :on-reply="startReply" :thread-replies="threadReplies" />
        <MessageComposer
            :room-id="props.roomId"
            :client="props.client"
            :reply-to="replyTo"
            @send="onSend"
            @send-file="onSendFile"
            @cancel-reply="cancelReply"
        />
    </template>
</template>

<style scoped>
.tumult-timeline-todo {
    flex: 1;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
