<script setup lang="ts">
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuPortal,
    ContextMenuRoot,
    ContextMenuTrigger,
    TooltipContent,
    TooltipPortal,
    TooltipProvider,
    TooltipRoot,
    TooltipTrigger,
} from "reka-ui";

import { useSelection, type RoomSelection } from "../selection.ts";
import { useActions } from "../actions.ts";
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

function requestLeave(): void {
    if (!props.guildId) return;
    actions.requestLeave({ id: props.guildId, name: props.name, isSpace: true });
}
</script>

<template>
    <!-- At 72px the tooltip IS the accessible name. -->
    <TooltipProvider :delay-duration="200">
        <TooltipRoot>
            <TooltipTrigger as-child>
                <li>
                    <!-- The favourites band opens rooms; no guild to act on, so no
                         right-click context menu there. -->
                    <ContextMenuRoot v-if="!favourite">
                        <ContextMenuTrigger as-child>
                            <a
                                class="tumult-guild-item"
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
                                <ContextMenuItem class="tumult-menu-item" text-value="leave" @select="requestLeave">
                                    Leave
                                </ContextMenuItem>
                            </ContextMenuContent>
                        </ContextMenuPortal>
                    </ContextMenuRoot>
                    <a v-else class="tumult-guild-item" :href="selection.hrefFor(selectTarget())" :aria-current="currentFlag()" :aria-label="name" @click.prevent="selection.select(selectTarget())">
                        <span class="tumult-guild-pill" :data-active="currentFlag() === 'page'" />
                        <Avatar :label="name" :src="avatarUrl ?? undefined" size="lg" />
                        <UnreadBadge class="tumult-guild-badge" :count="unread" :highlight="highlight > 0" />
                    </a>
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
