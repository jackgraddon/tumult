<script setup lang="ts">
import { computed } from "vue";
import type { MessageView } from "@tumult/core";

import TimelineRow from "./TimelineRow.vue";

const props = defineProps<{ messages: readonly MessageView[] }>();

interface Row {
    message: MessageView;
    grouped: boolean;
    dayLabel: string | null;
}

function dayLabel(ts: number): string {
    return new Date(ts).toLocaleDateString("en", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

const rows = computed<Row[]>(() => {
    const out: Row[] = [];
    let prevDayKey = "";
    let prevSender = "";
    for (const m of props.messages) {
        const dayKey = new Date(m.timestamp).toDateString();
        const newDay = dayKey !== prevDayKey;
        out.push({
            message: m,
            grouped: !newDay && m.senderId === prevSender && m.decryption === "ok",
            dayLabel: newDay ? dayLabel(m.timestamp) : null,
        });
        prevDayKey = dayKey;
        prevSender = m.senderId;
    }
    return out;
});
</script>

<template>
    <div class="tumult-list" role="log" aria-label="Messages" aria-live="off">
        <template v-for="row in rows" :key="row.message.id">
            <div v-if="row.dayLabel" class="tumult-day" role="separator">
                <span>{{ row.dayLabel }}</span>
            </div>
            <TimelineRow :message="row.message" :grouped="row.grouped" />
        </template>
        <p v-if="rows.length === 0" class="tumult-empty">No messages yet.</p>
    </div>
</template>

<style scoped>
.tumult-list {
    display: flex;
    flex-direction: column;
    gap: var(--timeline-row-gap);
    padding-bottom: var(--space-4);
}
.tumult-day {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    color: var(--timeline-day-divider);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.tumult-day::before,
.tumult-day::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--border-default);
}
.tumult-empty {
    padding: var(--space-4);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
