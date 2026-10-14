<script setup lang="ts">
import { computed } from "vue";

import { usePluginRegistry } from "../plugins/registry.ts";
import type { PluginManifest } from "../plugins/types.ts";
import type { SettingsTabProps } from "./tabs.ts";

// Declared so Vue does not fall the tab props through onto the DOM; this tab
// reads the shell's registry instead.
defineProps<SettingsTabProps>();

const plugins = usePluginRegistry();

// A plugin may be installed after this tab first paints (the app installs its
// plugins once the shell is up), so read through the registry's version.
const manifests = computed<PluginManifest[]>(() => {
    void plugins.version.value;
    return plugins.list();
});
</script>

<template>
    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Installed plugins</h3>
        <p v-if="manifests.length === 0" class="tumult-settings-note">
            No plugins are installed.
        </p>
        <ul v-else class="tumult-plugin-list">
            <li v-for="manifest in manifests" :key="manifest.id" class="tumult-plugin">
                <p class="tumult-plugin-title">
                    <span class="tumult-plugin-name">{{ manifest.name }}</span>
                    <span class="tumult-plugin-version">{{ manifest.version }}</span>
                </p>
                <code class="tumult-plugin-id">{{ manifest.id }}</code>
                <p v-if="manifest.description" class="tumult-plugin-desc">
                    {{ manifest.description }}
                </p>
                <p class="tumult-plugin-perms">
                    Permissions: {{ manifest.permissions.join(", ") || "none" }}
                </p>
            </li>
        </ul>
        <p class="tumult-settings-note">
            Plugins are TypeScript modules registered by the app at runtime — nothing is
            downloaded or evaluated, so a plugin is exactly as trusted as the app build
            that installs it.
        </p>
    </section>
</template>

<style scoped>
.tumult-settings-heading {
    margin: 0 0 var(--space-2);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
}
.tumult-settings-note {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-plugin-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-plugin {
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
}
.tumult-plugin-title {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
}
.tumult-plugin-name {
    font-weight: var(--weight-semibold);
}
.tumult-plugin-version {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-plugin-id {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}
.tumult-plugin-desc {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
}
.tumult-plugin-perms {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
</style>
