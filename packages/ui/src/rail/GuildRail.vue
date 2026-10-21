<script setup lang="ts">
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
import type { ChatClient, SessionView, SpaceTree } from "@tumult/core";

import GuildRailItem from "./GuildRailItem.vue";
import DmsRailItem from "./DmsRailItem.vue";
import PaneRailItem from "./PaneRailItem.vue";
import AccountTile from "./AccountTile.vue";
import type { WorkspacePane } from "../panes/registry.ts";

defineProps<{
    tree: SpaceTree;
    session: SessionView | null;
    client: ChatClient;
    /** Workspace panes, in rail order (the shell owns the registry). */
    panes?: readonly WorkspacePane[];
}>();

const emit = defineEmits<{
    signOut: [];
    security: [];
    verify: [];
    profile: [];
    settings: [];
    createSpace: [];
    join: [];
}>();
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
                    <li class="tumult-rail-sep" aria-hidden="true" />
                    <li class="tumult-rail-add">
                        <DropdownMenuRoot>
                            <DropdownMenuTrigger as-child>
                                <button type="button" class="tumult-rail-add-button" aria-label="Add a server">
                                    <span aria-hidden="true">+</span>
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
                    <!-- Global favourites: rooms pulled from their guild, sorted by
                         m.favourite tag order. A separator + heading open the band;
                         everything is hidden when the user has no favourites. -->
                    <li v-if="tree.favourites.length" class="tumult-rail-sep" aria-hidden="true" />
                    <li v-if="tree.favourites.length" class="tumult-rail-heading">Favourites</li>
                    <li
                        v-for="fave in tree.favourites"
                        :key="fave.id"
                        class="tumult-rail-fav-item"
                        :aria-hidden="fave.unreadCount > 0 ? undefined : 'true'"
                    >
                        <GuildRailItem
                            :favourite="fave.id"
                            :name="fave.name"
                            :avatar-url="fave.avatarUrl"
                            :unread="fave.unreadCount"
                            :highlight="fave.highlightCount"
                        />
                    </li>
                </ul>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical" class="tumult-scrollbar">
                <ScrollAreaThumb class="tumult-scrollthumb" />
            </ScrollAreaScrollbar>
        </ScrollAreaRoot>
        <AccountTile
            :session="session"
            :client="client"
            @sign-out="emit('signOut')"
            @security="emit('security')"
            @verify="emit('verify')"
            @profile="emit('profile')"
            @settings="emit('settings')"
        />
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
}
.tumult-rail-viewport {
    width: 100%;
    height: 100%;
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
