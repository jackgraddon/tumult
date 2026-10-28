<script setup lang="ts">
import { computed } from "vue";
import type { RoomSummary } from "@tumult/core";
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuPortal,
    ContextMenuRoot,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "reka-ui";

import { useSelection, type RoomSelection } from "../selection.ts";
import { useActions } from "../actions.ts";
import { copyOrLog } from "../clipboard.ts";
import { buildRoomMenu, type RoomMenuAction } from "./roomMenu.ts";
import UnreadBadge from "../primitives/UnreadBadge.vue";
import Avatar from "../primitives/Avatar.vue";
import Icon from "../icons/Icon.vue";
import { useVoiceRooms } from "../calls/voiceRooms.ts";

const props = defineProps<{
    room: RoomSummary;
    selection: RoomSelection;
}>();

const sel = useSelection();
const voiceRooms = useVoiceRooms();
const inVoice = computed(() => voiceRooms.value[props.room.id] ?? []);
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

const menu = computed(() => buildRoomMenu(props.room));

function run(action: RoomMenuAction): void {
    switch (action) {
        case "mark-read":
            // The client owns read state and this pane has no client, so the
            // request goes through the shell — the same channel leave uses.
            actions.requestMarkRead(props.room.id);
            break;
        case "pin":
        case "unpin":
            actions.requestPinRoom(props.room.id, action === "pin");
            break;
        case "mute":
        case "unmute":
            actions.requestMuteRoom(props.room.id, action === "mute");
            break;
        case "copy-link":
            copyOrLog(menu.value.roomLink, "room link");
            break;
        case "copy-id":
            copyOrLog(props.room.id, "room id");
            break;
        case "leave":
            requestLeave();
            break;
    }
}
</script>

<template>
    <li>
        <ContextMenuRoot>
            <ContextMenuTrigger as-child>
                <a
                    class="tumult-room-item"
                    :data-muted="room.muted || undefined"
                    :href="href()"
                    :aria-current="isActive() ? 'page' : undefined"
                    @click.prevent="pick()"
                >
                    <!-- DMs are people, not channels: show their face, not a hash. -->
                    <Avatar v-if="selection.view === 'dms'" :label="room.name" :src="room.avatarUrl" size="sm" />
                    <span v-else class="tumult-room-hash" aria-hidden="true">#</span>
                    <span class="tumult-room-name">{{ room.name }}</span>
                    <span
                        v-if="inVoice.length > 0"
                        class="tumult-room-voice"
                        :title="`In voice: ${inVoice.join(', ')}`"
                        :aria-label="`${inVoice.length} in voice`"
                    >
                        <Icon name="headphones" />{{ inVoice.length }}
                    </span>
                    <UnreadBadge :count="room.unreadCount" :highlight="room.highlightCount > 0" />
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
</template>

<style scoped>
.tumult-room-item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--roomlist-item-padding-y) var(--space-2);
    border-radius: var(--roomlist-item-radius);
    color: var(--roomlist-item-text);
    font-size: var(--text-sm);
    text-decoration: none;
    min-width: 0;
    transition:
        background-color var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease);
}
.tumult-room-item:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-room-item[aria-current="page"] {
    background: var(--roomlist-item-bg-active);
    color: var(--roomlist-item-text-active);
}
.tumult-room-voice {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    color: var(--success);
    font-size: var(--text-xs);
}
.tumult-room-hash {
    color: var(--text-muted);
    flex-shrink: 0;
}
.tumult-room-item[data-muted] .tumult-room-name {
    color: var(--text-muted);
}
.tumult-room-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
