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
    width: var(--control-md);
    height: var(--control-md);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
        background-color var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease);
}
.tumult-icon-button:hover {
    background: var(--roomlist-item-bg-hover);
    color: var(--text-primary);
}
.tumult-icon-button:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
</style>
