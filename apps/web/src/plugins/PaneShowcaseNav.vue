<script setup lang="ts">
/** The pane's left nav — the slot the channel list normally occupies. */
</script>

<template>
    <nav class="tumult-showcase-nav" aria-label="Plugin pane">
        <p class="tumult-showcase-nav-title">Plugin pane</p>
        <ul class="tumult-showcase-nav-list">
            <li class="tumult-showcase-nav-item">Overview</li>
            <li class="tumult-showcase-nav-item">Library</li>
            <li class="tumult-showcase-nav-item">Settings</li>
        </ul>
    </nav>
</template>

<style scoped>
.tumult-showcase-nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-2);
    background: var(--roomlist-bg);
    height: 100%;
}
.tumult-showcase-nav-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
}
.tumult-showcase-nav-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-showcase-nav-item {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--control-radius);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
</style>
