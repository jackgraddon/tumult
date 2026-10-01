<script setup lang="ts">
defineProps<{
    id: string;
    displayName: string;
    presence?: "online" | "offline";
}>();
</script>

<template>
    <li class="tumult-member">
        <span
            class="tumult-member-dot"
            :data-online="presence === 'online' ? 'true' : 'false'"
            aria-hidden="true"
        />
        <span class="tumult-member-name">{{ displayName }}</span>
    </li>
</template>

<style scoped>
.tumult-member {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 4px var(--space-2);
    border-radius: var(--control-radius);
    font-size: var(--text-sm);
    color: var(--text-secondary);
}
.tumult-member:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-member-dot {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    background: var(--text-muted);
}
.tumult-member-dot[data-online="true"] {
    background: var(--success);
}
.tumult-member-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
