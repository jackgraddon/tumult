<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
    TabsContent,
    TabsList,
    TabsRoot,
    TabsTrigger,
} from "reka-ui";
import type { ChatClient } from "@tumult/core";

import { useSettingsTabs } from "./tabs.ts";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
}>();

// The tab strip is the per-shell registry: the shell's own tabs are registered
// first, plugins add theirs (and may add them after first paint — `all()` reads
// through the registry's version counter, so the strip repaints).
const registry = useSettingsTabs();
const tabs = computed(() => registry.all());

const active = ref("");
// Keep the selection valid as tabs come and go — a plugin uninstalled while the
// dialog is open, or an install landing later, must not leave a dead tab.
watch(
    tabs,
    (list) => {
        if (!list.some((tab) => tab.id === active.value)) {
            active.value = list[0]?.id ?? "";
        }
    },
    { immediate: true },
);

function close(): void {
    emit("close");
}

function onOpenChange(next: boolean): void {
    if (!next) close();
}
</script>

<template>
    <DialogRoot :open="props.open" @update:open="onOpenChange">
        <DialogPortal>
            <DialogOverlay class="tumult-dialog-overlay" />
            <DialogContent class="tumult-dialog tumult-settings">
                <DialogTitle class="tumult-dialog-title">Settings</DialogTitle>
                <DialogDescription class="tumult-dialog-desc">
                    App settings, plus a tab for every installed plugin that provides one.
                </DialogDescription>
                <TabsRoot v-model="active" class="tumult-settings-body">
                    <TabsList class="tumult-settings-tabs" aria-label="Settings sections">
                        <TabsTrigger
                            v-for="tab in tabs"
                            :key="tab.id"
                            :value="tab.id"
                            class="tumult-settings-tab"
                        >
                            {{ tab.title }}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent
                        v-for="tab in tabs"
                        :key="tab.id"
                        :value="tab.id"
                        class="tumult-settings-panel"
                    >
                        <component :is="tab.component" :client="client" :close="close" />
                    </TabsContent>
                </TabsRoot>
                <p v-if="tabs.length === 0" class="tumult-settings-empty" role="status">
                    No settings sections are available.
                </p>
                <div class="tumult-dialog-actions">
                    <button type="button" class="tumult-dialog-button" @click="close">Close</button>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
.tumult-settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    /* A settings dialog can outgrow the viewport; the panel scrolls, the frame
       does not. */
    max-height: calc(100vh - var(--dialog-gutter));
}
.tumult-settings-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
}
.tumult-settings-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding-bottom: var(--space-1);
    border-bottom: var(--border-width) solid var(--border-default);
}
.tumult-settings-tab {
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
}
.tumult-settings-tab:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-settings-tab[data-state="active"] {
    background: var(--surface-pane);
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
}
.tumult-settings-tab:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
.tumult-settings-panel {
    min-height: 0;
    overflow-y: auto;
    color: var(--text-primary);
    font-size: var(--text-sm);
}
.tumult-settings-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
