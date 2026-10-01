<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "reka-ui";
import type { SessionView, SpaceTree } from "@tumult/core";

import GuildRailItem from "./GuildRailItem.vue";
import DmsRailItem from "./DmsRailItem.vue";
import AccountTile from "./AccountTile.vue";

defineProps<{
    tree: SpaceTree;
    session: SessionView | null;
}>();

const emit = defineEmits<{
    signOut: [];
}>();
</script>

<template>
    <nav class="tumult-rail" aria-label="Guilds">
        <ScrollAreaRoot class="tumult-rail-scroll">
            <ScrollAreaViewport class="tumult-rail-viewport">
                <ul class="tumult-rail-list">
                    <DmsRailItem :unread="tree.orphans.reduce((n, r) => n + r.unreadCount, 0)" />
                    <li class="tumult-rail-sep" aria-hidden="true" />
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
        <AccountTile :session="session" @sign-out="emit('signOut')" />
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
.tumult-scrollbar {
    width: 6px;
    background: transparent;
}
.tumult-scrollthumb {
    border-radius: var(--radius-full);
    background: var(--border-default);
}
</style>
