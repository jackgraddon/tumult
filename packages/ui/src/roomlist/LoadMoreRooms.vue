<script setup lang="ts">
defineProps<{
    /** Show the affordance only when the room window has more behind it. */
    hasMore: boolean;
}>();

const emit = defineEmits<{
    loadMore: [];
}>();
</script>

<template>
    <button v-if="hasMore" type="button" class="tumult-load-more" @click="emit('loadMore')">
        Load more rooms
    </button>
</template>

<style scoped>
.tumult-load-more {
    display: block;
    width: calc(100% - 2 * var(--space-2));
    margin: var(--space-1) var(--space-2) var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
}
.tumult-load-more:hover {
    background: var(--roomlist-item-bg-hover);
    color: var(--text-primary);
}
.tumult-load-more:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
</style>
