<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { computed, onMounted, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import TimelineViewport from "../timeline/TimelineViewport.vue";
import MessageComposer from "../timeline/MessageComposer.vue";

// Mounted only after start() and keyed by threadId by the shell, so these
// subscriptions are taken once per thread and torn down on switch.
const props = defineProps<{
    client: ChatClient;
    roomId: string;
    threadId: string;
}>();

const emit = defineEmits<{
    close: [];
    back: [];
}>();

const timeline = useSubscribable(props.client.threadTimeline(props.threadId));
const session = useSubscribable(props.client.session);

// The tracker puts the root first; everything after it is a reply.
const root = computed(() => timeline.value.find((m) => m.id === props.threadId));
const replyCount = computed(() => timeline.value.filter((m) => m.id !== props.threadId).length);

async function loadMore(): Promise<boolean> {
    // Live timeline only for now; long threads need getThreadTimeline paging.
    return false;
}

function markRead(): void {
    props.client.markThreadRead(props.threadId).catch((error: unknown) => {
        console.error("[tumult] thread read receipt failed", error);
    });
}

// Viewing the thread is reading it: on open, and whenever replies arrive.
onMounted(markRead);
watch(() => timeline.value.length, markRead);

async function onSend(body: string): Promise<void> {
    try {
        await props.client.sendReply(props.roomId, props.threadId, body);
    } catch (error) {
        console.error("[tumult] thread reply failed", error);
    }
}
</script>

<template>
    <aside class="tumult-thread-panel" aria-label="Thread">
        <header class="tumult-thread-header">
            <button type="button" class="tumult-thread-btn" aria-label="All threads" @click="emit('back')"><Icon name="chevron-left" /></button>
            <div class="tumult-thread-header-text">
                <h2>Thread</h2>
                <p v-if="root" class="tumult-thread-root">{{ root.body }}</p>
            </div>
            <button type="button" class="tumult-thread-btn" aria-label="Close thread" @click="emit('close')"><Icon name="close" /></button>
        </header>
        <div class="tumult-thread-meta">{{ replyCount }} {{ replyCount === 1 ? "reply" : "replies" }}</div>
        <!--
            No moderation handlers are wired in a thread panel, so power would
            gate nothing — null keeps the menu to copy/inspect items (the room
            id still builds real links).
        -->
        <TimelineViewport
            :messages="timeline"
            :room-id="roomId"
            :power="null"
            :load-more="loadMore"
            :own-user-id="session?.userId"
        />
        <MessageComposer @send="onSend" />
    </aside>
</template>

<style scoped>
.tumult-thread-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: var(--surface-pane);
}
.tumult-thread-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--border-default);
}
.tumult-thread-header-text {
    flex: 1;
    min-width: 0;
}
.tumult-thread-header h2 {
    margin: 0;
    font-size: var(--text-md);
}
.tumult-thread-root {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-thread-btn {
    padding: var(--space-0-5) var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
}
.tumult-thread-btn:hover {
    background: var(--roomlist-item-bg-hover);
    color: var(--text-primary);
}
.tumult-thread-meta {
    padding: var(--space-1) var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
    border-bottom: var(--border-width) solid var(--border-default);
}
</style>
