<script setup lang="ts">
/** The pane's bottom bar — the slot a player would live in. */
</script>

<template>
    <footer class="tumult-showcase-footer">
        <span class="tumult-showcase-footer-label">Pane footer</span>
        <span class="tumult-showcase-footer-hint">the shell pins it to the bottom of the workspace</span>
    </footer>
</template>

<style scoped>
.tumult-showcase-footer {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
}
.tumult-showcase-footer-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
}
.tumult-showcase-footer-hint {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
</style>
