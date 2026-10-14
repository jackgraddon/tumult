<script setup lang="ts">
defineProps<{
    count: number;
    highlight?: boolean;
}>();

function display(count: number): string {
    return count > 99 ? "99+" : String(count);
}
</script>

<template>
    <span
        v-if="count > 0"
        class="tumult-badge"
        :data-highlight="highlight ? 'true' : 'false'"
        :aria-label="highlight ? `${display(count)} mentions` : `${display(count)} unread`"
    >
        {{ display(count) }}
    </span>
</template>

<style scoped>
.tumult-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--badge-min-size);
    height: var(--badge-min-size);
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background: var(--badge-bg);
    color: var(--badge-text);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    line-height: var(--leading-none);
}
.tumult-badge[data-highlight="true"] {
    background: var(--badge-highlight-bg);
}
</style>
