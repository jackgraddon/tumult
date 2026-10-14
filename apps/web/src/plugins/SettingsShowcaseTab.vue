<script setup lang="ts">
import type { SettingsTabProps } from "@tumult/ui";

/**
 * Reference settings tab. The note below is deliberately NOT styled here: its
 * box comes from the plugin's injected stylesheet, so the tab proves both
 * `settings-tabs` and `styles` in one place.
 */
defineProps<SettingsTabProps>();
</script>

<template>
    <section class="tumult-showcase-tab">
        <h3 class="tumult-showcase-heading">Plugin-provided settings</h3>
        <p class="tumult-showcase-note" data-showcase="note">
            This tab was added by a plugin the app installed: the tab itself through the
            <code>settings-tabs</code> permission, and this box through an injected stylesheet
            (the <code>styles</code> permission).
        </p>
        <p class="tumult-showcase-text">
            Nothing here was downloaded or evaluated — the tab is a Vue component from the app
            bundle, and the stylesheet is a string the plugin handed to the shell.
        </p>
    </section>
</template>

<style scoped>
.tumult-showcase-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
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
