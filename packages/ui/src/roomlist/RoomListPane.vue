<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "reka-ui";
import type { SpaceNode } from "@tumult/core";

import type { RoomSelection } from "../selection.ts";
import SpaceCategory from "./SpaceCategory.vue";
import RoomListItem from "./RoomListItem.vue";
import IconButton from "../primitives/IconButton.vue";

defineProps<{
    guild: SpaceNode | undefined;
    selection: RoomSelection;
}>();

const emit = defineEmits<{
    createChannel: [];
}>();
</script>

<template>
    <div class="tumult-roomlist-pane">
        <header class="tumult-roomlist-header">
            <h2>{{ guild?.room.name ?? "Messages" }}</h2>
            <IconButton v-if="guild" label="Create a channel" @click="emit('createChannel')">
                <span aria-hidden="true">＋</span>
            </IconButton>
        </header>
        <ScrollAreaRoot class="tumult-roomlist-scroll">
            <ScrollAreaViewport class="tumult-roomlist-viewport">
                <p v-if="!guild" class="tumult-roomlist-empty">No guild selected.</p>
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
    border-bottom: 1px solid var(--border-default);
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
}
.tumult-roomlist-viewport {
    width: 100%;
    height: 100%;
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
.tumult-scrollbar {
    width: 6px;
}
.tumult-scrollthumb {
    border-radius: var(--radius-full);
    background: var(--border-default);
}
</style>
