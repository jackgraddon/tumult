<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogPortal,
    DialogRoot,
    DialogTitle,
    TabsContent,
    TabsList,
    TabsRoot,
    TabsTrigger,
} from "reka-ui";
import type { ChatClient } from "@tumult/core";

import Icon from "../icons/Icon.vue";
import { useSettingsTabs } from "./tabs.ts";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
    /** The page to open on; unknown or absent opens the first one. */
    initialTab?: string | null;
}>();

const emit = defineEmits<{
    close: [];
    signOut: [];
}>();

// The sidebar is the per-shell registry: the shell's own tabs are registered
// first, plugins add theirs (and may add them after first paint — `grouped()`
// reads through the registry's version counter, so the nav repaints).
const registry = useSettingsTabs();
const groups = computed(() => registry.grouped());
const tabs = computed(() => groups.value.flatMap((group) => group.tabs));

const active = ref("");

function firstTab(): string {
    return tabs.value[0]?.id ?? "";
}

// Every open lands on the page the caller asked for (a deep link from the
// account menu), else the first page.
watch(
    () => props.open,
    (open) => {
        if (!open) return;
        const wanted = props.initialTab;
        active.value = wanted && registry.get(wanted) ? wanted : firstTab();
    },
    { immediate: true },
);

// Keep the selection valid as tabs come and go — a plugin uninstalled while the
// dialog is open, or an install landing later, must not leave a dead page.
watch(
    tabs,
    (list) => {
        if (!list.some((tab) => tab.id === active.value)) active.value = firstTab();
    },
    { immediate: true },
);

const activeTitle = computed(() => tabs.value.find((tab) => tab.id === active.value)?.title ?? "");

function close(): void {
    emit("close");
}

function onOpenChange(next: boolean): void {
    if (!next) close();
}

function signOut(): void {
    close();
    emit("signOut");
}
</script>

<template>
    <DialogRoot :open="props.open" @update:open="onOpenChange">
        <DialogPortal>
            <!-- Full-screen: the page IS the surface, so there is no backdrop. -->
            <DialogContent class="tumult-settings">
                <DialogTitle class="tumult-settings-sr">Settings</DialogTitle>
                <DialogDescription class="tumult-settings-sr">
                    Account, app and plugin settings. Press Escape to close.
                </DialogDescription>
                <TabsRoot v-model="active" orientation="vertical" class="tumult-settings-body">
                    <nav class="tumult-settings-nav" aria-label="Settings">
                        <TabsList class="tumult-settings-tabs" aria-label="Settings pages">
                            <template v-for="group in groups" :key="group.section">
                                <!-- A heading inside the tablist would break its
                                     ARIA structure; it is presentation, and each
                                     tab is still named by its own label. -->
                                <div role="presentation" class="tumult-settings-group">{{ group.title }}</div>
                                <TabsTrigger
                                    v-for="tab in group.tabs"
                                    :key="tab.id"
                                    :value="tab.id"
                                    class="tumult-settings-tab"
                                >
                                    {{ tab.title }}
                                </TabsTrigger>
                            </template>
                        </TabsList>
                        <div class="tumult-settings-nav-footer">
                            <button type="button" class="tumult-settings-signout" @click="signOut">
                                Sign out
                            </button>
                        </div>
                    </nav>
                    <main class="tumult-settings-main">
                        <div class="tumult-settings-column">
                            <header class="tumult-settings-header">
                                <h2 class="tumult-settings-title">{{ activeTitle }}</h2>
                                <DialogClose class="tumult-settings-close" aria-label="Close settings">
                                    <Icon name="close" />
                                    <span class="tumult-settings-close-hint" aria-hidden="true">Esc</span>
                                </DialogClose>
                            </header>
                            <TabsContent
                                v-for="tab in tabs"
                                :key="tab.id"
                                :value="tab.id"
                                class="tumult-settings-panel"
                            >
                                <component :is="tab.component" :client="client" :close="close" />
                            </TabsContent>
                            <p v-if="tabs.length === 0" class="tumult-settings-empty" role="status">
                                No settings sections are available.
                            </p>
                        </div>
                    </main>
                </TabsRoot>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
.tumult-settings {
    position: fixed;
    inset: 0;
    display: flex;
    background: var(--settings-bg);
    color: var(--text-primary);
}
.tumult-settings:focus-visible {
    outline: none;
}
.tumult-settings-sr {
    position: absolute;
    width: var(--hairline);
    height: var(--hairline);
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
/* Two flex children that wrap: side by side when the viewport has room for
   the nav AND a page, stacked (nav on top) when it does not. No media query,
   so the breakpoint follows the theme's own widths. */
.tumult-settings-body {
    display: flex;
    flex-wrap: wrap;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}
.tumult-settings-nav {
    display: flex;
    flex-direction: column;
    flex: 1 0 var(--settings-nav-width);
    gap: var(--space-3);
    padding: var(--space-6) var(--space-3) var(--space-4);
    background: var(--settings-nav-bg);
}
.tumult-settings-tabs {
    display: flex;
    flex-direction: column;
    gap: var(--hairline);
    margin-left: auto;
    width: min(100%, var(--settings-nav-width));
}
.tumult-settings-group {
    padding: var(--space-3) var(--space-2) var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
}
.tumult-settings-group:first-child {
    padding-top: 0;
}
.tumult-settings-tab,
.tumult-settings-signout {
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition:
        background-color var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease);
}
.tumult-settings-tab:hover,
.tumult-settings-signout:hover {
    background: var(--settings-nav-item-bg-hover);
    color: var(--text-primary);
}
.tumult-settings-tab[data-state="active"] {
    background: var(--settings-nav-item-bg-active);
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
}
.tumult-settings-tab:focus-visible,
.tumult-settings-signout:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
.tumult-settings-nav-footer {
    display: flex;
    flex-direction: column;
    margin-left: auto;
    width: min(100%, var(--settings-nav-width));
    padding-top: var(--space-2);
    border-top: var(--border-width) solid var(--border-default);
}
.tumult-settings-signout {
    color: var(--settings-nav-item-danger);
}
.tumult-settings-signout:hover {
    color: var(--settings-nav-item-danger);
}
/* Both sides share the slack equally, so on a wide screen the nav (right-
   aligned in its half) and the page (left-aligned in its half) meet near the
   centre instead of hugging the left edge. */
.tumult-settings-main {
    flex: 1 1 var(--settings-content-width);
    min-width: 0;
    padding: var(--space-6) var(--space-4);
}
.tumult-settings-column {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: var(--settings-content-width);
}
.tumult-settings-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
}
.tumult-settings-title {
    margin: 0;
    font-size: var(--text-lg);
}
/* Discord's close affordance: a ringed X with its key underneath. */
.tumult-settings-close {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--icon-md);
    cursor: pointer;
}
.tumult-settings-close:hover {
    color: var(--text-primary);
}
.tumult-settings-close:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
.tumult-settings-close-hint {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
}
.tumult-settings-panel:focus-visible {
    outline: none;
}
.tumult-settings-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>

<!-- Page vocabulary every settings page shares (plugin pages included), so it is
     global like the dialog frame's classes: a section is one titled block, and
     consecutive sections are divided by a rule. -->
<style>
.tumult-settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.tumult-settings-section + .tumult-settings-section {
    padding-top: var(--space-4);
    border-top: var(--border-width) solid var(--border-default);
}
.tumult-settings-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    color: var(--text-primary);
    font-size: var(--text-sm);
}
.tumult-settings-heading {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
}
.tumult-settings-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
</style>
