<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import type { MessageView } from "@tumult/core";

import TimelineList from "./TimelineList.vue";

const props = defineProps<{ messages: readonly MessageView[] }>();

const scroller = ref<HTMLElement | null>(null);

/**
 * Plain overflow-y scroller — NOT Reka ScrollArea. The timeline needs precise
 * scrollTop, overflow-anchor and (slice 4) a virtualizer on the real scroll
 * container, all of which a wrapped viewport would hide.
 */
function stickToBottom(): void {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => stickToBottom());

// Keep the view pinned while new messages arrive at the bottom; never yank the
// user out of history they scrolled up to read.
watch(
    () => (props.messages as readonly MessageView[]).length,
    () => {
        const el = scroller.value;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (nearBottom) void nextTick(() => stickToBottom());
    },
);
</script>

<template>
    <div ref="scroller" class="tumult-viewport" tabindex="0" aria-label="Message history">
        <TimelineList :messages="messages" />
    </div>
</template>

<style scoped>
.tumult-viewport {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-anchor: auto;
    background: var(--timeline-bg);
}
</style>
