<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "reka-ui";
import type { SpaceNode } from "@tumult/core";

import type { RoomSelection } from "../selection.ts";
import SpaceCategory from "./SpaceCategory.vue";
import RoomListItem from "./RoomListItem.vue";
import LoadMoreRooms from "./LoadMoreRooms.vue";
import IconButton from "../primitives/IconButton.vue";

defineProps<{
    guild: SpaceNode | undefined;
    selection: RoomSelection;
    /** Sliding-sync window still has rooms behind it. */
    hasMore: boolean;
    /** Brief minimum skeleton while a rail click's route settles. */
    loading?: boolean | undefined;
}>();

const emit = defineEmits<{
    createChannel: [];
    loadMore: [];
}>();
</script>

<template>
    <div class="tumult-roomlist-pane">
        <header class="tumult-roomlist-header">
            <h2>{{ guild?.room.name ?? "Messages" }}</h2>
            <IconButton v-if="guild" label="Create a channel" @click="emit('createChannel')">
                <Icon name="plus" />
            </IconButton>
        </header>
        <ScrollAreaRoot class="tumult-roomlist-scroll">
            <ScrollAreaViewport class="tumult-roomlist-viewport">
                <p v-if="!guild" class="tumult-roomlist-empty">No guild selected.</p>
                <template v-else>
                    <ul v-if="loading" class="tumult-roomlist-skeleton" role="status" aria-label="Loading channels">
                        <li v-for="row in 7" :key="row" class="tumult-roomlist-skeleton-row" aria-hidden="true">
                            <span class="tumult-roomlist-skeleton-hash"></span>
                            <span class="tumult-roomlist-skeleton-line" :data-width="row % 3 === 0 ? 'short' : 'long'"></span>
                        </li>
                    </ul>
                    <ul v-else class="tumult-roomlist-tree">
                        <RoomListItem
                            v-for="room in guild.rooms"
                            :key="room.id"
                            :room="room"
                            :selection="selection"
                        />
                        <SpaceCategory
                            v-for="child in guild.spaces"
                            :key="child.path.join('/')"
                            :node="child"
                            :selection="selection"
                        />
                    </ul>
                </template>
                <LoadMoreRooms v-if="guild" :has-more="hasMore" @load-more="emit('loadMore')" />
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical" class="tumult-scrollbar">
                <ScrollAreaThumb class="tumult-scrollthumb" />
            </ScrollAreaScrollbar>
        </ScrollAreaRoot>
    </div>
</template>

<style scoped>
.tumult-roomlist-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--roomlist-bg);
    color: var(--roomlist-item-text);
}
.tumult-roomlist-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--border-default);
}
.tumult-roomlist-header h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-roomlist-scroll {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}
.tumult-roomlist-viewport {
    width: 100%;
    flex: 1;
    min-height: 0;
}
.tumult-roomlist-tree {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
}
.tumult-roomlist-empty {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-roomlist-skeleton {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
    animation: tumult-roomlist-skeleton-in var(--navigation-skeleton-duration) var(--skeleton-shimmer-ease) both;
}
.tumult-roomlist-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--roomlist-item-padding-y) var(--space-2);
}
.tumult-roomlist-skeleton-hash {
    flex-shrink: 0;
    width: var(--icon-sm);
    height: var(--icon-sm);
    border-radius: var(--control-radius);
}
.tumult-roomlist-skeleton-line {
    height: var(--space-2);
    border-radius: var(--control-radius);
}
.tumult-roomlist-skeleton-line[data-width="long"] {
    width: 70%;
}
.tumult-roomlist-skeleton-line[data-width="short"] {
    width: 45%;
}
.tumult-roomlist-skeleton-hash,
.tumult-roomlist-skeleton-line {
    background: linear-gradient(
        100deg,
        var(--skeleton-surface) 20%,
        var(--skeleton-shimmer-surface) 50%,
        var(--skeleton-surface) 80%
    );
    background-size: 200% 100%;
    animation: tumult-skeleton-shimmer var(--skeleton-shimmer-duration) var(--skeleton-shimmer-ease) infinite;
}
@keyframes tumult-skeleton-shimmer {
    to {
        background-position: -200% 0;
    }
}
@keyframes tumult-roomlist-skeleton-in {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}
@media (prefers-reduced-motion: reduce) {
    .tumult-roomlist-skeleton-hash,
    .tumult-roomlist-skeleton-line {
        animation: none;
    }
    .tumult-roomlist-skeleton {
        animation: none;
    }
}
.tumult-scrollbar {
    width: var(--scrollbar-width);
}
.tumult-scrollthumb {
    border-radius: var(--radius-full);
    background: var(--border-default);
}
</style>
