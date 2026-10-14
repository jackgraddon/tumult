<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import type { ChatClient, SearchPage } from "@tumult/core";

import IconButton from "../primitives/IconButton.vue";

const props = defineProps<{
    client: ChatClient;
    roomId: string;
}>();

const emit = defineEmits<{
    /** The hit is in the loaded window (jumpTo succeeded): scroll to it. */
    jumped: [eventId: string];
    close: [];
}>();

const query = ref("");
/** Term the current `page` belongs to — a changed term resets on next submit. */
const searched = ref("");
const page = shallowRef<SearchPage | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const jumpError = ref<string | null>(null);
const jumping = ref<string | null>(null);
const input = ref<HTMLInputElement | null>(null);

onMounted(() => input.value?.focus());

async function run(reset: boolean): Promise<void> {
    const term = query.value.trim();
    if (term.length === 0) return;
    if (term !== searched.value) reset = true;
    loading.value = true;
    error.value = null;
    try {
        const opts =
            !reset && page.value?.nextBatch ? { nextBatch: page.value.nextBatch } : undefined;
        const next = await props.client.search(props.roomId, term, opts);
        page.value =
            reset || !page.value
                ? next
                : {
                      hits: [...page.value.hits, ...next.hits],
                      nextBatch: next.nextBatch,
                      total: next.total,
                  };
        searched.value = term;
    } catch (cause) {
        // The SDK's rejection strings are raw HTTP; say what the user can do.
        console.error("[tumult] search failed", cause);
        error.value = "Search failed — this homeserver may not support history search.";
        page.value = null;
    } finally {
        loading.value = false;
    }
}

function submit(): void {
    void run(true);
}

function loadMore(): void {
    void run(false);
}

async function jump(hitId: string): Promise<void> {
    jumpError.value = null;
    jumping.value = hitId;
    try {
        const ok = await props.client.jumpTo(props.roomId, hitId);
        if (!ok) {
            // Honest bound: the timeline window is capped, older hits can't load.
            jumpError.value = "That message is further back than this room keeps loaded.";
            return;
        }
        emit("jumped", hitId);
        emit("close");
    } catch (cause) {
        console.error("[tumult] jump failed", cause);
        jumpError.value = "Couldn't load that message.";
    } finally {
        jumping.value = null;
    }
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") emit("close");
}

function hitLabel(hit: SearchPage["hits"][number]): string {
    return hit.decryption === "ok" ? hit.body : "Encrypted message";
}

function hitTime(ts: number): string {
    return new Date(ts).toLocaleString("en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
</script>

<template>
    <aside class="tumult-search-panel" aria-label="Search this room" @keydown="onKeydown">
        <header class="tumult-search-header">
            <h2>Search</h2>
            <IconButton label="Close search" @click="emit('close')">✕</IconButton>
        </header>
        <form class="tumult-search-form" role="search" @submit.prevent="submit">
            <input
                ref="input"
                v-model="query"
                class="tumult-search-input"
                type="search"
                placeholder="Search this room…"
                aria-label="Search this room"
                :disabled="loading"
            />
        </form>
        <p v-if="error" class="tumult-search-error" role="alert">{{ error }}</p>
        <p v-else-if="loading" class="tumult-search-status" role="status">Searching…</p>
        <p v-else-if="jumpError" class="tumult-search-error" role="alert">{{ jumpError }}</p>

        <div v-if="page && !loading && page.hits.length === 0 && !error" class="tumult-search-status">
            No messages match “{{ searched }}”.
        </div>

        <ul v-if="page && page.hits.length > 0" class="tumult-search-results">
            <li v-for="hit in page.hits" :key="hit.id">
                <button
                    type="button"
                    class="tumult-search-hit"
                    :disabled="jumping === hit.id"
                    @click="jump(hit.id)"
                >
                    <span class="tumult-search-hit-meta">
                        <span class="tumult-search-hit-sender">{{ hit.senderName }}</span>
                        <time :dateTime="new Date(hit.timestamp).toISOString()">{{
                            hitTime(hit.timestamp)
                        }}</time>
                    </span>
                    <span class="tumult-search-hit-body">{{ hitLabel(hit) }}</span>
                </button>
            </li>
        </ul>

        <button
            v-if="page?.nextBatch && !loading"
            type="button"
            class="tumult-search-more"
            @click="loadMore"
        >
            Load more ({{ page.total - page.hits.length }} remaining)
        </button>
    </aside>
</template>

<style scoped>
.tumult-search-panel {
    position: absolute;
    inset: 0 0 0 auto;
    z-index: var(--panel-z);
    display: flex;
    flex-direction: column;
    min-width: 0;
    width: min(var(--panel-width), 100%);
    background: var(--panel-bg);
    border-left: var(--border-width) solid var(--panel-border);
    box-shadow: var(--panel-shadow);
}
.tumult-search-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--border-default);
}
.tumult-search-header h2 {
    margin: 0;
    font-size: var(--text-md);
}
.tumult-search-form {
    padding: var(--space-2) var(--space-3);
}
.tumult-search-input {
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-search-input:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
.tumult-search-error {
    margin: 0;
    padding: 0 var(--space-3) var(--space-2);
    color: var(--danger);
    font-size: var(--text-sm);
}
.tumult-search-status {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-search-results {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
}
.tumult-search-hit {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.tumult-search-hit:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-search-hit:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: calc(var(--focus-ring-offset) * -1);
}
.tumult-search-hit:disabled {
    cursor: wait;
    opacity: var(--state-muted-opacity);
}
.tumult-search-hit-meta {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-search-hit-sender {
    color: var(--text-secondary);
    font-weight: var(--weight-semibold);
}
.tumult-search-hit-body {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-search-more {
    margin: var(--space-2) var(--space-3);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
}
.tumult-search-more:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-search-more:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
</style>
