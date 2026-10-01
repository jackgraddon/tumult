<script setup lang="ts">
import { computed, provide } from "vue";
import { ConfigProvider } from "reka-ui";
import { selectSpaceTree } from "@tumult/core/selectors";
import type { ChatClient, SpaceTree } from "@tumult/core";

import { SelectionKey, type RoomSelection } from "../selection.ts";
import { RegistryKey, TimelineRegistry } from "../timeline/registry.ts";
import { useSubscribable } from "../subscribable.ts";
import TextMessage from "../timeline/renderers/TextMessage.vue";
import ConnectionBanner from "./ConnectionBanner.vue";
import GuildRail from "../rail/GuildRail.vue";
import RoomListPane from "../roomlist/RoomListPane.vue";
import DmList from "../roomlist/DmList.vue";
import TimelinePane from "../timeline/TimelinePane.vue";
import MembersPane from "../members/MembersPane.vue";
import IconButton from "../primitives/IconButton.vue";

const props = defineProps<{
    client: ChatClient;
    selection: RoomSelection;
    showMembers: boolean;
    showRoomList: boolean;
}>();

const emit = defineEmits<{
    select: [next: RoomSelection];
    toggleMembers: [];
    toggleRoomList: [];
    signOut: [];
}>();

function hrefFor(next: RoomSelection): string {
    if (next.view === "dms") return next.roomId ? `/dms/${encodeURIComponent(next.roomId)}` : "/dms";
    const guild = next.guildId ? `/g/${encodeURIComponent(next.guildId)}` : "/g";
    return next.roomId ? `${guild}/${encodeURIComponent(next.roomId)}` : guild;
}

provide(SelectionKey, {
    get current() {
        return props.selection;
    },
    select: (next: RoomSelection) => emit("select", next),
    hrefFor,
});

// One registry per shell. Default text renderer; apps register their own
// (e.g. the demo poll) on top via the exposed instance.
const registry = new TimelineRegistry();
registry.register("m.room.message", { component: TextMessage, priority: 0 });
provide(RegistryKey, registry);

defineExpose({ registry, hrefFor });

const rooms = useSubscribable(props.client.rooms);
const connection = useSubscribable(props.client.connection);
const session = useSubscribable(props.client.session);

const tree = computed<SpaceTree>(() => selectSpaceTree(rooms.value));
const guildsById = computed(() => new Map(tree.value.guilds.map((g) => [g.room.id, g])));
const roomsById = computed(() => new Map(rooms.value.map((r) => [r.id, r])));

const activeGuild = computed(() =>
    props.selection.view === "guild" && props.selection.guildId
        ? (guildsById.value.get(props.selection.guildId) ?? tree.value.guilds[0])
        : undefined,
);

const activeRoom = computed(() => {
    if (props.selection.roomId) return roomsById.value.get(props.selection.roomId);
    if (props.selection.view === "dms") return tree.value.orphans[0];
    const guild = activeGuild.value;
    return guild?.rooms[0] ?? guild?.spaces[0]?.rooms[0];
});

const activeRoomId = computed(() => activeRoom.value?.id);
</script>

<template>
    <ConfigProvider>
        <div class="tumult-shell">
            <ConnectionBanner :connection="connection" />
            <div
                class="tumult-shell-grid"
                :data-roomlist="showRoomList ? 'open' : 'closed'"
                :data-members="showMembers ? 'open' : 'closed'"
            >
                <GuildRail :tree="tree" :session="session" @sign-out="emit('signOut')" />
                <div class="tumult-pane tumult-pane-roomlist" :inert="!showRoomList ? true : undefined">
                    <RoomListPane
                        v-if="selection.view === 'guild'"
                        :guild="activeGuild"
                        :selection="selection"
                    />
                    <div v-else class="tumult-roomlist-pane">
                        <header class="tumult-roomlist-header"><h2>Direct Messages</h2></header>
                        <DmList :rooms="tree.orphans" />
                    </div>
                </div>
                <div class="tumult-pane tumult-pane-timeline">
                    <div class="tumult-pane-toolbar">
                        <IconButton label="Toggle room list" @click="emit('toggleRoomList')">☰</IconButton>
                        <IconButton label="Toggle members" @click="emit('toggleMembers')">👥</IconButton>
                    </div>
                    <TimelinePane :client="client" :room="activeRoom" />
                </div>
                <div class="tumult-pane tumult-pane-members" :inert="!showMembers ? true : undefined">
                    <!-- Keyed: one room's subscription tears down before the next mounts. -->
                    <MembersPane :key="activeRoomId ?? 'none'" :client="client" :room-id="activeRoomId" />
                </div>
            </div>
        </div>
    </ConfigProvider>
</template>

<style scoped>
.tumult-shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--surface-base);
    color: var(--text-primary);
    font-family: var(--font-sans);
}
.tumult-shell-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns:
        var(--layout-guild-rail-width)
        var(--layout-roomlist-width)
        minmax(0, 1fr)
        var(--layout-members-width);
}
.tumult-shell-grid[data-roomlist="closed"] {
    grid-template-columns:
        var(--layout-guild-rail-width)
        0
        minmax(0, 1fr)
        var(--layout-members-width);
}
.tumult-shell-grid[data-members="closed"] {
    grid-template-columns:
        var(--layout-guild-rail-width)
        var(--layout-roomlist-width)
        minmax(0, 1fr)
        0;
}
.tumult-shell-grid[data-roomlist="closed"][data-members="closed"] {
    grid-template-columns:
        var(--layout-guild-rail-width)
        0
        minmax(0, 1fr)
        0;
}
.tumult-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.tumult-pane-roomlist[inert],
.tumult-pane-members[inert] {
    width: 0;
    visibility: hidden;
}
.tumult-pane-timeline {
    background: var(--timeline-bg);
}
.tumult-pane-toolbar {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border-default);
}
.tumult-roomlist-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    background: var(--roomlist-bg);
}
.tumult-roomlist-header {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-default);
}
.tumult-roomlist-header h2 {
    margin: 0;
    font-size: var(--text-sm);
}
</style>
