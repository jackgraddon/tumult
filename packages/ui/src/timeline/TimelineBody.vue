<script setup lang="ts">
import type { ChatClient, MessageView, Subscribable } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import TimelineViewport from "./TimelineViewport.vue";
import MessageComposer from "./MessageComposer.vue";

const props = defineProps<{
    client: ChatClient;
    roomId: string;
    /** Hide the thread affordance when the server has no thread support. */
    threadsEnabled?: boolean;
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

function openThread(rootEventId: string): void {
    // Bubbles to the shell via TimelinePane.
    emit("open-thread", rootEventId);
}

async function onSend(body: string): Promise<void> {
    // Failure is already visible in-timeline via the `failed` flag; log
    // instead of leaving an unhandled rejection.
    try {
        await props.client.send(props.roomId, body);
    } catch (error) {
        console.error("[tumult] send failed", error);
    }
}
</script>

<template>
    <div v-if="!messages" class="tumult-timeline-todo" role="status">
        <p>Timeline read lands in slice 4 — this room is selected, nothing is faked.</p>
    </div>
    <template v-else>
        <TimelineViewport :messages="messages" :load-more="loadMore" :on-toggle-reaction="toggleReaction" :on-read-latest="readLatest" :own-user-id="session?.userId" :on-edit-message="editMessage" :on-open-thread="threadsEnabled ? openThread : undefined" />
        <MessageComposer :room-id="props.roomId" :client="props.client" @send="onSend" />
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
