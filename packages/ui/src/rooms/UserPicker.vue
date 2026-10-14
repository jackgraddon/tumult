<script setup lang="ts">
import { ref } from "vue";
import type { ChatClient, UserSearchResult } from "@tumult/core";

import Avatar from "../primitives/Avatar.vue";

const props = defineProps<{
    client: ChatClient;
    label: string;
    modelValue: string | null;
}>();

const emit = defineEmits<{
    "update:modelValue": [value: string | null];
}>();

const MXID = /^@[^:\s]+:\S+$/;
const DEBOUNCE_MS = 250;
const LIMIT = 8;

const query = ref("");
const results = ref<UserSearchResult[]>([]);
const status = ref<"idle" | "searching" | "done" | "error">("idle");

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

function onInput(): void {
    const term = query.value.trim();
    if (timer !== undefined) clearTimeout(timer);
    seq += 1;

    if (MXID.test(term)) {
        emit("update:modelValue", term);
        results.value = [];
        status.value = "idle";
        return;
    }
    emit("update:modelValue", null);

    if (term.length < 1) {
        results.value = [];
        status.value = "idle";
        return;
    }
    status.value = "searching";
    timer = setTimeout(() => void search(term, seq), DEBOUNCE_MS);
}

async function search(term: string, at: number): Promise<void> {
    try {
        const hits = await props.client.searchUsers(term, { limit: LIMIT });
        if (at !== seq) return;
        results.value = hits;
        status.value = "done";
    } catch {
        if (at !== seq) return;
        results.value = [];
        status.value = "error";
    }
}

function pick(result: UserSearchResult): void {
    if (timer !== undefined) clearTimeout(timer);
    seq += 1;
    query.value = result.userId;
    results.value = [];
    status.value = "idle";
    emit("update:modelValue", result.userId);
}

function clear(): void {
    if (timer !== undefined) clearTimeout(timer);
    seq += 1;
    query.value = "";
    results.value = [];
    status.value = "idle";
    emit("update:modelValue", null);
}
</script>

<template>
    <div class="tumult-picker">
        <div class="tumult-picker-row">
            <input
                v-model="query"
                class="tumult-dialog-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                :aria-label="props.label"
                :placeholder="props.label"
                @input="onInput"
            />
            <button
                v-if="props.modelValue"
                type="button"
                class="tumult-picker-clear"
                aria-label="Clear selection"
                @click="clear"
            >
                ✕
            </button>
        </div>
        <p v-if="status === 'searching'" class="tumult-dialog-hint" role="status">Searching…</p>
        <p v-else-if="status === 'error'" class="tumult-dialog-hint" role="status">
            Search failed — you can still type a full @user:server address.
        </p>
        <p v-else-if="status === 'done' && results.length === 0" class="tumult-dialog-hint" role="status">
            No users found. You can still type a full @user:server address.
        </p>
        <ul v-if="results.length > 0" class="tumult-picker-results">
            <li v-for="r in results" :key="r.userId">
                <button type="button" class="tumult-picker-result" @click="pick(r)">
                    <Avatar :label="r.displayName || r.userId" :src="r.avatarUrl ?? undefined" size="sm" />
                    <span class="tumult-picker-text">
                        <span class="tumult-picker-name">{{ r.displayName || r.userId }}</span>
                        <span class="tumult-picker-id">{{ r.userId }}</span>
                    </span>
                </button>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.tumult-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.tumult-picker-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.tumult-picker-clear {
    flex-shrink: 0;
    width: var(--control-md);
    height: var(--control-md);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-secondary);
    cursor: pointer;
}
.tumult-picker-results {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    max-height: var(--picker-results-max-height);
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
}
.tumult-picker-result {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.tumult-picker-result:hover,
.tumult-picker-result:focus-visible {
    background: var(--roomlist-item-bg-hover);
    outline: none;
}
.tumult-picker-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.tumult-picker-name {
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-picker-id {
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
