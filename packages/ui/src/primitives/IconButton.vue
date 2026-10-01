<script setup lang="ts">
defineProps<{
    label: string;
}>();
</script>

<template>
    <button type="button" class="tumult-icon-button" :aria-label="label" :title="label">
        <slot />
    </button>
</template>

<style scoped>
.tumult-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
}
.tumult-icon-button:hover {
    background: var(--roomlist-item-bg-hover);
    color: var(--text-primary);
}
.tumult-icon-button:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 1px;
}
</style>
