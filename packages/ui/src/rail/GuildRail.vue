<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "../icons/Icon.vue";
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuTrigger,
    ScrollAreaRoot,
    ScrollAreaScrollbar,
    ScrollAreaThumb,
    ScrollAreaViewport,
} from "reka-ui";
import type { SpaceTree } from "@tumult/core";

import GuildRailItem from "./GuildRailItem.vue";
import DmsRailItem from "./DmsRailItem.vue";
import PaneRailItem from "./PaneRailItem.vue";
import type { WorkspacePane } from "../panes/registry.ts";

const props = defineProps<{
    tree: SpaceTree;
    /** Workspace panes, in rail order (the shell owns the registry). */
    panes?: readonly WorkspacePane[];
}>();

const emit = defineEmits<{
    createSpace: [];
    join: [];
}>();

// The pinned band folds away; the choice is a per-viewer convenience, so
// storage failing (private window, blocked data) just means it starts open.
const COLLAPSE_KEY = "tumult.rail.pinnedCollapsed";
function readCollapsed(): boolean {
    try {
        return globalThis.localStorage?.getItem(COLLAPSE_KEY) === "1";
    } catch {
        return false;
    }
}
const pinnedCollapsed = ref(readCollapsed());
function togglePinned(): void {
    pinnedCollapsed.value = !pinnedCollapsed.value;
    try {
        globalThis.localStorage?.setItem(COLLAPSE_KEY, pinnedCollapsed.value ? "1" : "0");
    } catch {
        // Not persisted; the in-memory state still works.
    }
}
// A folded band must not hide that something pinned needs attention.
const pinnedUnread = computed(() => props.tree.favourites.reduce((n, r) => n + r.unreadCount, 0));
</script>

<template>
    <nav class="tumult-rail" aria-label="Guilds">
        <ScrollAreaRoot class="tumult-rail-scroll">
            <ScrollAreaViewport class="tumult-rail-viewport">
                <ul class="tumult-rail-list">
                    <DmsRailItem :unread="tree.orphans.reduce((n, r) => n + r.unreadCount, 0)" />
                    <!-- Workspace panes sit directly under the DMs button: a pane is
                         the other kind of thing the rail opens. -->
                    <PaneRailItem v-for="pane in panes ?? []" :key="pane.id" :pane="pane" />
                    <!-- Pinned rooms (m.favourite tags, in tag order) pulled out of
                         their guild and held at the top, under DMs and panes.
                         Absent entirely when nothing is pinned. -->
                    <template v-if="tree.favourites.length">
                        <li class="tumult-rail-sep" aria-hidden="true" />
                        <li class="tumult-rail-heading">
                            <button
                                type="button"
                                class="tumult-rail-heading-button"
                                :aria-expanded="!pinnedCollapsed"
                                @click="togglePinned"
                            >
                                <Icon :name="pinnedCollapsed ? 'chevron-right' : 'chevron-down'" />
                                <span class="tumult-rail-heading-label">Pinned</span>
                                <span v-if="pinnedCollapsed && pinnedUnread > 0" class="tumult-rail-heading-count">
                                    {{ pinnedUnread }}
                                </span>
                            </button>
                        </li>
                        <template v-if="!pinnedCollapsed">
                            <li
                                v-for="fave in tree.favourites"
                                :key="fave.id"
                                class="tumult-rail-fav-item"
                                :aria-hidden="fave.unreadCount > 0 ? undefined : 'true'"
                            >
                                <GuildRailItem
                                    :favourite="fave.id"
                                    :room="fave"
                                    :name="fave.name"
                                    :avatar-url="fave.avatarUrl"
                                    :unread="fave.unreadCount"
                                    :highlight="fave.highlightCount"
                                />
                            </li>
                        </template>
                    </template>
                    <li class="tumult-rail-sep" aria-hidden="true" />
                    <li class="tumult-rail-add">
                        <DropdownMenuRoot>
                            <DropdownMenuTrigger as-child>
                                <button type="button" class="tumult-rail-add-button" aria-label="Add a server">
                                    <Icon name="plus" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuPortal>
                                <DropdownMenuContent class="tumult-menu" side="right" align="start">
                                    <DropdownMenuItem class="tumult-menu-item" text-value="create space" @select="emit('createSpace')">
                                        Create a space
                                    </DropdownMenuItem>
                                    <DropdownMenuItem class="tumult-menu-item" text-value="join room" @select="emit('join')">
                                        Join a room
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenuPortal>
                        </DropdownMenuRoot>
                    </li>
                    <GuildRailItem
                        v-for="guild in tree.guilds"
                        :key="guild.room.id"
                        :guild-id="guild.room.id"
                        :name="guild.room.name"
                        :avatar-url="guild.room.avatarUrl"
                        :unread="guild.aggregateUnread"
                        :highlight="guild.aggregateHighlight"
                    />
                </ul>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical" class="tumult-scrollbar">
                <ScrollAreaThumb class="tumult-scrollthumb" />
            </ScrollAreaScrollbar>
        </ScrollAreaRoot>
    </nav>
</template>

<style scoped>
.tumult-rail {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--surface-rail);
    padding: var(--space-2) 0;
}
.tumult-rail-scroll {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    /* A flex column so the viewport below can fill it. A block child with
       `height: 100%` of a flex-stretched parent resolves to content height,
       so the scroll container grew with the list and never overflowed. */
    display: flex;
    flex-direction: column;
}
.tumult-rail-viewport {
    width: 100%;
    flex: 1;
    min-height: 0;
}
.tumult-rail-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin: 0;
    padding: 0 var(--space-2);
    list-style: none;
}
.tumult-rail-sep {
    height: var(--hairline);
    margin: var(--space-2) var(--space-3);
    background: var(--border-default);
}
.tumult-rail-heading {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-none);
    margin: var(--space-3) 0 var(--space-1);
    padding: 0;
    text-align: left;
    color: var(--text-muted);
    unicode-bias: auto;
    /* The rail is a fixed, narrow chrome track, so the band label either fits
       inside it or degrades to an ellipsis — it must never clip mid-glyph the
       way a tracked-out uppercase run did. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.tumult-rail-heading-button {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
}
.tumult-rail-heading-button:hover {
    color: var(--text-primary);
}
.tumult-rail-heading-button:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.tumult-rail-heading-label {
    overflow: hidden;
    text-overflow: ellipsis;
}
.tumult-rail-heading-count {
    margin-left: auto;
    color: var(--text-primary);
}
.tumult-rail-fav-item {
    display: inline-flex;
    padding-top: var(--space-0-5);
    align-items: center;
    justify-content: center;
    min-width: var(--rail-favourite-min-width);
    margin: var(--space-0-5) 0;
}
.tumult-rail-fav-item:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.tumult-rail-add {
    display: flex;
    justify-content: center;
    padding: var(--space-1) 0;
}
.tumult-rail-add-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--control-lg);
    height: var(--control-lg);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-full);
    background: var(--surface-base);
    color: var(--text-secondary);
    font-size: var(--icon-lg);
    line-height: var(--leading-none);
    cursor: pointer;
}
.tumult-rail-add-button:hover {
    border-color: transparent;
    background: var(--accent);
    color: var(--button-primary-text);
}
.tumult-rail-add-button:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.tumult-scrollbar {
    width: var(--scrollbar-width);
    background: transparent;
}
.tumult-scrollthumb {
    border-radius: var(--radius-full);
    background: var(--border-default);
}
</style>
