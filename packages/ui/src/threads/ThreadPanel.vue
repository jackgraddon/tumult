<script setup lang="ts">
import { computed } from "vue";
import type { ChatClient, MessageView, ThreadSummary } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import TimelineViewport from "../timeline/TimelineViewport.vue";
import MessageComposer from "../timeline/MessageComposer.vue";

const props = defineProps<{
    client: ChatClient;
    thread: ThreadSummary;
    rootMessage: MessageView | undefined;
}>();

const emit = defineEmits<{
    close: [];
}>();

const timeline = useSubscribable(props.client.threadTimeline(props.thread.rootEventId));

async function loadMore(): Promise<boolean> {
    // Thread timelines are short; no pagination for now.
    return false;
}

async function onSend(body: string): Promise<void> {
    try {
        await props.client.sendReply(props.thread.rootEventId, body);
    } catch (error) {
        console.error("[tumult] thread reply failed", error);
    }
}

const replyCount = computed(() => timeline.value.length);
</script>

<template>
    <aside class="tumult-thread-panel" aria-label="Thread">
        <header class="tumult-thread-header">
            <div class="tumult-thread-header-text">
                <h2>Thread</h2>
                <p v-if="rootMessage" class="tumult-thread-root">{{ rootMessage.body }}</p>
            </div>
            <button type="button" class="tumult-thread-close" aria-label="Close thread" @click="emit('close')">
                ✕
            </button>
        </header>
        <div class="tumult-thread-meta">{{ replyCount }} {{ replyCount === 1 ? "reply" : "replies" }}</div>
        <TimelineViewport :messages="timeline" :load-more="loadMore" />
        <MessageComposer @send="onSend" />
    </aside>
</template>

<style scoped>
.tumult-thread-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    width: 320px;
    border-left: 1px solid var(--border-default);
    background: var(--surface-pane);
}
.tumult-thread-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-default);
}
.tumult-thread-header-text {
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
.tumult-thread-close {
    padding: 2px var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
}
.tumult-thread-close:hover {
    background: var(--roomlist-item-bg-hover);
    color: var(--text-primary);
}
.tumult-thread-meta {
    padding: var(--space-1) var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
    border-bottom: 1px solid var(--border-default);
}
</style>
