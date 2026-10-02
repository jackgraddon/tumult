<script setup lang="ts">
import { computed } from "vue";
import type { ChatClient } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";

// Mounted only after start() and keyed by roomId by the shell.
const props = defineProps<{
    client: ChatClient;
    roomId: string;
}>();

const emit = defineEmits<{
    open: [rootEventId: string];
    close: [];
}>();

const threads = useSubscribable(props.client.threads(props.roomId));
// Root previews come from the room timeline the shell already keeps warm;
// a root outside the loaded window falls back to a generic label.
const messages = useSubscribable(props.client.timeline(props.roomId));
const bodies = computed(() => new Map(messages.value.map((m) => [m.id, m.body])));

function when(ts: number): string {
    return ts ? new Date(ts).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}
</script>

<template>
    <aside class="tumult-thread-list" aria-label="Threads">
        <header class="tumult-thread-list-header">
            <h2>Threads</h2>
            <button type="button" class="tumult-thread-list-close" aria-label="Close threads" @click="emit('close')">✕</button>
        </header>
        <p v-if="threads.length === 0" class="tumult-thread-list-empty">No threads in this room yet.</p>
        <ul v-else>
            <li v-for="t in threads" :key="t.rootEventId">
                <button type="button" class="tumult-thread-item" @click="emit('open', t.rootEventId)">
                    <span class="tumult-thread-item-root">{{ bodies.get(t.rootEventId) ?? "Thread" }}</span>
                    <span class="tumult-thread-item-meta">
                        {{ t.replyCount }} {{ t.replyCount === 1 ? "reply" : "replies" }} · {{ when(t.lastReplyTs) }}
                    </span>
                    <span
                        v-if="t.unreadCount > 0"
                        class="tumult-thread-item-unread"
                        :aria-label="`${t.unreadCount} unread`"
                    />
                </button>
            </li>
        </ul>
    </aside>
</template>

<style scoped>
.tumult-thread-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--surface-pane);
}
.tumult-thread-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-default);
}
.tumult-thread-list-header h2 {
    margin: 0;
    font-size: var(--text-md);
}
.tumult-thread-list-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
}
.tumult-thread-list-empty {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
ul {
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    overflow-y: auto;
}
.tumult-thread-item {
    position: relative;
    display: grid;
    gap: 2px;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
}
.tumult-thread-item:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-thread-item-root {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
}
.tumult-thread-item-meta {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-thread-item-unread {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
}
</style>
