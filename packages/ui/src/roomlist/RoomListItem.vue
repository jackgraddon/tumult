<script setup lang="ts">
import type { RoomSummary } from "@tumult/core";
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuPortal,
    ContextMenuRoot,
    ContextMenuTrigger,
} from "reka-ui";

import { useSelection, type RoomSelection } from "../selection.ts";
import { useActions } from "../actions.ts";
import UnreadBadge from "../primitives/UnreadBadge.vue";
import Avatar from "../primitives/Avatar.vue";

const props = defineProps<{
    room: RoomSummary;
    selection: RoomSelection;
}>();

const sel = useSelection();
const actions = useActions();

function href(): string {
    if (props.selection.view === "dms") return sel.hrefFor({ view: "dms", roomId: props.room.id });
    return sel.hrefFor({ view: "guild", guildId: props.selection.guildId, roomId: props.room.id });
}

function pick(): void {
    if (props.selection.view === "dms") sel.select({ view: "dms", roomId: props.room.id });
    else sel.select({ view: "guild", guildId: props.selection.guildId, roomId: props.room.id });
}

function isActive(): boolean {
    return sel.current.roomId === props.room.id;
}

function requestLeave(): void {
    actions.requestLeave({ id: props.room.id, name: props.room.name, isSpace: false });
}
</script>

<template>
    <li>
        <ContextMenuRoot>
            <ContextMenuTrigger as-child>
                <a
                    class="tumult-room-item"
                    :href="href()"
                    :aria-current="isActive() ? 'page' : undefined"
                    @click.prevent="pick()"
                >
                    <!-- DMs are people, not channels: show their face, not a hash. -->
                    <Avatar v-if="selection.view === 'dms'" :label="room.name" :src="room.avatarUrl" size="sm" />
                    <span v-else class="tumult-room-hash" aria-hidden="true">#</span>
                    <span class="tumult-room-name">{{ room.name }}</span>
                    <UnreadBadge :count="room.unreadCount" :highlight="room.highlightCount > 0" />
                </a>
            </ContextMenuTrigger>
            <ContextMenuPortal>
                <ContextMenuContent class="tumult-menu">
                    <ContextMenuItem class="tumult-menu-item" text-value="leave" @select="requestLeave">
                        Leave
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenuPortal>
        </ContextMenuRoot>
    </li>
</template>

<style scoped>
.tumult-room-item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 4px var(--space-2);
    border-radius: var(--control-radius);
    color: var(--roomlist-item-text);
    font-size: var(--text-sm);
    text-decoration: none;
    min-width: 0;
}
.tumult-room-item:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-room-item[aria-current="page"] {
    background: var(--roomlist-item-bg-active);
    color: var(--roomlist-item-text-active);
}
.tumult-room-hash {
    color: var(--text-muted);
    flex-shrink: 0;
}
.tumult-room-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
