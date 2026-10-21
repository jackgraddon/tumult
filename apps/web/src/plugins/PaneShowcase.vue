<script setup lang="ts">
/**
 * Reference workspace pane — the three slots the shell hands a pane:
 * a left nav, a content area and a bottom bar.
 *
 * The note's box comes from the plugin's injected stylesheet (the `styles`
 * permission), so this pane proves two permissions in one place.
 */
</script>

<template>
    <section class="tumult-showcase-pane">
        <h3 class="tumult-showcase-heading">A pane from a plugin</h3>
        <p class="tumult-showcase-note" data-showcase="pane-note">
            This whole screen was added by a plugin: the rail tile through the
            <code>workspace-panes</code> permission, and this box through an injected stylesheet
            (the <code>styles</code> permission).
        </p>
        <p class="tumult-showcase-text">
            The shell kept its own layout — the tile sits under the DMs button, the nav is where the
            channel list normally lives, and the bar below is the pane's footer.
        </p>
    </section>
</template>

<style scoped>
.tumult-showcase-pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
}
.tumult-showcase-heading {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
}
.tumult-showcase-text {
    margin: 0;
    color: var(--text-secondary);
}
</style>
