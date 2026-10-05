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
import AccountTile from "./AccountTile.vue";

defineProps<{
    tree: SpaceTree;
    session: SessionView | null;
    client: ChatClient;
}>();

const emit = defineEmits<{
    signOut: [];
    security: [];
    verify: [];
    profile: [];
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
    gap: 2px;
    margin: 0;
    padding: 0 var(--space-2);
    list-style: none;
}
.tumult-rail-sep {
    height: 1px;
    margin: var(--space-2) var(--space-3);
    background: var(--border-default);
}
.tumult-rail-add {
    display: flex;
    justify-content: center;
    padding: 4px 0;
}
.tumult-rail-add-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border: 1px solid var(--border-default);
    border-radius: 50%;
    background: var(--surface-base);
    color: var(--text-secondary);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
}
.tumult-rail-add-button:hover {
    border-color: transparent;
    background: var(--accent);
    color: var(--button-primary-text);
}
.tumult-rail-add-button:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 2px;
}
.tumult-scrollbar {
    width: 6px;
    background: transparent;
}
.tumult-scrollthumb {
    border-radius: var(--radius-full);
    background: var(--border-default);
}
</style>
