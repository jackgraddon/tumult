<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "reka-ui";
import type { RoomSummary } from "@tumult/core";

import RoomListItem from "./RoomListItem.vue";
import LoadMoreRooms from "./LoadMoreRooms.vue";

defineProps<{
    rooms: readonly RoomSummary[];
    /** Sliding-sync window still has rooms behind it. */
    hasMore: boolean;
}>();

const emit = defineEmits<{
    loadMore: [];
}>();

const DMS_SELECTION = { view: "dms" as const };
</script>

<template>
    <ScrollAreaRoot class="tumult-dmlist-scroll">
        <ScrollAreaViewport class="tumult-dmlist-viewport">
            <ul class="tumult-dmlist">
                <RoomListItem v-for="room in rooms" :key="room.id" :room="room" :selection="DMS_SELECTION" />
            </ul>
            <LoadMoreRooms :has-more="hasMore" @load-more="emit('loadMore')" />
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical" class="tumult-scrollbar">
            <ScrollAreaThumb class="tumult-scrollthumb" />
        </ScrollAreaScrollbar>
    </ScrollAreaRoot>
</template>

<style scoped>
.tumult-dmlist-scroll {
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.tumult-dmlist-viewport {
    width: 100%;
    height: 100%;
}
.tumult-dmlist {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
}
.tumult-scrollbar {
    width: var(--scrollbar-width);
}
.tumult-scrollthumb {
    border-radius: var(--radius-full);
    background: var(--border-default);
}
</style>
