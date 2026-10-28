<script setup lang="ts">
import { computed } from "vue";
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuPortal,
    ContextMenuRoot,
    ContextMenuSeparator,
    ContextMenuTrigger,
    TooltipContent,
    TooltipPortal,
    TooltipProvider,
    TooltipRoot,
    TooltipTrigger,
} from "reka-ui";

import { useSelection, type RoomSelection } from "../selection.ts";
import { useActions } from "../actions.ts";
import { copyOrLog } from "../clipboard.ts";
import type { RoomSummary } from "@tumult/core";
import { runSpaceAction } from "./spaceActions.ts";
import { buildSpaceMenu, type SpaceMenuAction } from "./spaceMenu.ts";
import { buildRoomMenu, type RoomMenuAction } from "../roomlist/roomMenu.ts";
import Avatar from "../primitives/Avatar.vue";
import UnreadBadge from "../primitives/UnreadBadge.vue";

const props = defineProps<{
    /** Omitted when this tile is a favourite room (opens the room). Present for a
     * guild tile. */
    guildId?: string;
    name: string;
    avatarUrl?: string | null;
    unread: number;
    highlight: number;
    /** Room id when this tile opens a room (the favourites band) instead of a
     * guild; a guild tile when absent. */
    favourite?: string | undefined;
    /** The pinned room itself, so its tile can offer the room menu (unpin, mute). */
    room?: RoomSummary;
}>();

const selection = useSelection();
const actions = useActions();

/** The room selected when this tile opens a room (favourite band), otherwise
 * the guild — used to build the href + click payload. */
function selectTarget(): RoomSelection {
    return props.favourite ? { view: "dms", roomId: props.favourite } : { view: "guild", guildId: props.guildId };
}

/** `aria-current` + active pill: honoured for whichever mode this tile is. */
function currentFlag(): "page" | undefined {
    const cur = selection.current;
    if (props.favourite) {
        return cur.view === "dms" && cur.roomId === props.favourite ? "page" : undefined;
    }
    return cur.view === "guild" && cur.guildId === props.guildId ? "page" : undefined;
}

// A space's canonical alias is not on the rail tile (the tile only carries what
// it renders), so the link falls back to the space's room id — which always
// resolves.
const menu = computed(() =>
    props.room
        ? buildRoomMenu(props.room)
        : buildSpaceMenu(props.guildId ?? "", null, props.unread > 0 || props.highlight > 0),
);

/** A pinned tile is a room: it gets the room menu, not the space one. */
function runRoom(action: RoomMenuAction, room: RoomSummary): void {
    switch (action) {
        case "mark-read":
            actions.requestMarkRead(room.id);
            break;
        case "pin":
        case "unpin":
            actions.requestPinRoom(room.id, action === "pin");
            break;
        case "mute":
        case "unmute":
            actions.requestMuteRoom(room.id, action === "mute");
            break;
        case "copy-link":
            copyOrLog((menu.value as ReturnType<typeof buildRoomMenu>).roomLink, "room link");
            break;
        case "copy-id":
            copyOrLog(room.id, "room id");
            break;
        case "leave":
            actions.requestLeave({ id: room.id, name: room.name, isSpace: false });
            break;
    }
}

function run(action: SpaceMenuAction | RoomMenuAction): void {
    if (props.room) return runRoom(action as RoomMenuAction, props.room);
    const id = props.guildId ?? "";
    runSpaceAction(
        action as SpaceMenuAction,
        { id, name: props.name, link: (menu.value as ReturnType<typeof buildSpaceMenu>).spaceLink },
        actions,
    );
}
</script>

<template>
    <!-- At 72px the tooltip IS the accessible name. -->
    <TooltipProvider :delay-duration="200">
        <TooltipRoot>
            <TooltipTrigger as-child>
                <li>
                    <!-- A pinned tile gets the room menu, a guild tile the space one. -->
                    <ContextMenuRoot>
                        <ContextMenuTrigger as-child>
                            <a
                                class="tumult-guild-item"
                                :data-pinned="favourite ? 'true' : undefined"
                                :href="selection.hrefFor(selectTarget())"
                                :aria-current="currentFlag()"
                                :aria-label="`${name}${unread > 0 ? `, ${unread} unread` : ''}`"
                                @click.prevent="selection.select(selectTarget())"
                            >
                                <span
                                    class="tumult-guild-pill"
                                    :data-active="currentFlag() === 'page'"
                                />
                                <Avatar :label="name" :src="avatarUrl ?? undefined" size="lg" />
                                <UnreadBadge class="tumult-guild-badge" :count="unread" :highlight="highlight > 0" />
                            </a>
                        </ContextMenuTrigger>
                        <ContextMenuPortal>
                            <ContextMenuContent class="tumult-menu">
                                <template v-for="entry in menu.entries" :key="entry.id">
                                    <ContextMenuSeparator
                                        v-if="entry.kind === 'separator'"
                                        class="tumult-menu-separator"
                                    />
                                    <ContextMenuItem
                                        v-else
                                        class="tumult-menu-item"
                                        :class="{ 'tumult-menu-item-danger': entry.danger }"
                                        :text-value="entry.label"
                                        @select="run(entry.id)"
                                    >
                                        {{ entry.label }}
                                    </ContextMenuItem>
                                </template>
                            </ContextMenuContent>
                        </ContextMenuPortal>
                    </ContextMenuRoot>
                </li>
            </TooltipTrigger>
            <TooltipPortal>
                <TooltipContent class="tumult-tooltip" side="right">{{ name }}</TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>

<style scoped>
.tumult-guild-item {
    position: relative;
    display: flex;
    justify-content: center;
    padding: var(--space-1) 0;
    border-radius: var(--control-radius);
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-guild-item:hover {
    background: var(--rail-item-bg-hover);
}
.tumult-guild-pill {
    position: absolute;
    left: 0;
    top: var(--space-2);
    bottom: var(--space-2);
    width: var(--rail-pill-width);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: transparent;
}
.tumult-guild-pill[data-active="true"] {
    background: var(--rail-indicator);
}
.tumult-guild-badge {
    position: absolute;
    right: var(--space-1-5);
    bottom: var(--space-0-5);
}
</style>

<style>
.tumult-tooltip {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--control-radius);
    background: var(--surface-active);
    color: var(--text-primary);
    font-size: var(--text-sm);
}
</style>
