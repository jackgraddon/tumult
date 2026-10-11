<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
import { ConfigProvider } from "reka-ui";
import { selectSpaceTree } from "@tumult/core/selectors";
import type { ChatClient, SpaceTree } from "@tumult/core";

import { SelectionKey, type RoomSelection } from "../selection.ts";
import { ActionsKey, type LeaveTarget, type MemberModeration } from "../actions.ts";
import { MediaKey, EncryptedMediaKey, MediaDownloadKey } from "../media.ts";
import { RegistryKey, TimelineRegistry } from "../timeline/registry.ts";
import { useSubscribable } from "../subscribable.ts";
import TextMessage from "../timeline/renderers/TextMessage.vue";
import MediaMessage from "../timeline/renderers/MediaMessage.vue";
import ConnectionBanner from "./ConnectionBanner.vue";
import GuildRail from "../rail/GuildRail.vue";
import RoomListPane from "../roomlist/RoomListPane.vue";
import DmList from "../roomlist/DmList.vue";
import TimelinePane from "../timeline/TimelinePane.vue";
import MembersPane from "../members/MembersPane.vue";
import IconButton from "../primitives/IconButton.vue";
import SecurityBanner from "../security/SecurityBanner.vue";
import RecoverySetupModal from "../security/RecoverySetupModal.vue";
import RecoveryRestoreModal from "../security/RecoveryRestoreModal.vue";
import VerificationModal from "../security/VerificationModal.vue";
import ThreadPanel from "../threads/ThreadPanel.vue";
import ThreadList from "../threads/ThreadList.vue";
import CreateSpaceDialog from "../rooms/CreateSpaceDialog.vue";
import CreateChannelDialog from "../rooms/CreateChannelDialog.vue";
import JoinRoomDialog from "../rooms/JoinRoomDialog.vue";
import CreateDmDialog from "../rooms/CreateDmDialog.vue";
import InviteDialog from "../rooms/InviteDialog.vue";
import LeaveConfirmDialog from "../rooms/LeaveConfirmDialog.vue";
import ProfileDialog from "../rooms/ProfileDialog.vue";
import RoomSettingsDialog from "../rooms/RoomSettingsDialog.vue";
import ModerationConfirmDialog from "../members/ModerationConfirmDialog.vue";
import PowerLevelDialog from "../members/PowerLevelDialog.vue";
import { useRoomPower } from "../members/power.ts";

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
const mediaTypes = new Set(["m.image", "m.video", "m.audio", "m.file"]);
registry.register("m.room.message", {
    component: MediaMessage,
    priority: 10,
    match: (m) => typeof m.content["msgtype"] === "string" && mediaTypes.has(m.content["msgtype"]),
});
registry.register("m.room.message", { component: TextMessage, priority: 0 });
provide(RegistryKey, registry);
provide(MediaKey, (uri: string, size: number) => props.client.resolveMedia(uri, size));
provide(EncryptedMediaKey, (file) => props.client.resolveEncryptedMedia(file));
provide(MediaDownloadKey, (uri: string) => props.client.resolveMediaDownload(uri));

defineExpose({ registry, hrefFor });

const rooms = useSubscribable(props.client.rooms);
const connection = useSubscribable(props.client.connection);
const session = useSubscribable(props.client.session);
const security = useSubscribable(props.client.security);
const verification = useSubscribable(props.client.verification);
const typing = useSubscribable(props.client.typing);

// Recovery modal routing: banner buttons pick directly; the account menu
// picks whichever flow the current status calls for.
const securityModal = ref<"setup" | "restore" | null>(null);

function openSecurityModal(): void {
    securityModal.value = !security.value.backupEnabled ? "setup" : "restore";
}

// Verification modal state
const verificationModal = ref(false);

function openVerificationModal(): void {
    verificationModal.value = true;
}

// Profile edit dialog: the account menu's "Edit profile…" entry opens it.
const profileModal = ref(false);

// Room settings dialog: the timeline header's gear opens it, scoped to the
// room being viewed. Room switch closes it (the room prop must not change
// under a seeded form).
const settingsOpen = ref(false);

// Thread slide-over: the room's thread list, or one open thread.
type ThreadView = { mode: "list" } | { mode: "thread"; threadId: string } | null;
const threadView = ref<ThreadView>(null);

function openThread(rootEventId: string): void {
    threadView.value = { mode: "thread", threadId: rootEventId };
}

function toggleThreadList(): void {
    threadView.value = threadView.value ? null : { mode: "list" };
}

function closeThread(): void {
    threadView.value = null;
}

// Auto-open for incoming requests: the other side already initiated, so the
// user must see the accept/decline prompt without hunting for it.
watch(
    () => verification.value.requests,
    (requests) => {
        if (!verificationModal.value && requests.some((r) => !r.initiatedByMe && r.phase !== "done" && r.phase !== "cancelled")) {
            verificationModal.value = true;
        }
    },
    { deep: true },
);

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

// The gear opens room settings; while power levels are unknown we leave it
// visible and let the server reject (the slice-23 rule). Once known, only
// members who clear the room's `state_default` see it.
const activePower = useRoomPower(props.client, () => activeRoomId.value);
const settingsAllowed = computed(() => activePower.value === null || activePower.value.canEditSettings);

type RoomAction =
    | { kind: "create-space" }
    | { kind: "create-channel"; spaceId: string; spaceName: string }
    | { kind: "join" }
    | { kind: "create-dm" }
    | { kind: "invite" }
    | { kind: "leave"; target: LeaveTarget }
    | { kind: "moderate"; moderation: MemberModeration }
    | null;

const roomAction = ref<RoomAction>(null);

provide(ActionsKey, {
    requestLeave(target) {
        roomAction.value = { kind: "leave", target };
    },
    requestModeration(moderation) {
        roomAction.value = { kind: "moderate", moderation };
    },
});

// Split the moderation payload by dialog: kick/ban/unban confirm, set-power
// edits a number. Both derive from the same `roomAction` slot.
const moderation = computed<MemberModeration | null>(() =>
    roomAction.value?.kind === "moderate" ? roomAction.value.moderation : null,
);
const confirmModeration = computed<MemberModeration | null>(() =>
    moderation.value && moderation.value.kind !== "set-power" ? moderation.value : null,
);
const powerModeration = computed<MemberModeration | null>(() =>
    moderation.value && moderation.value.kind === "set-power" ? moderation.value : null,
);

const channelSpaceId = computed(() =>
    roomAction.value?.kind === "create-channel" ? roomAction.value.spaceId : "",
);
const channelSpaceName = computed(() =>
    roomAction.value?.kind === "create-channel" ? roomAction.value.spaceName : "",
);
const leaveTarget = computed<LeaveTarget | null>(() =>
    roomAction.value?.kind === "leave" ? roomAction.value.target : null,
);
const inviteRoomId = computed(() => activeRoomId.value ?? "");

function openCreateChannel(): void {
    // The header shows exactly `activeGuild` (with its own fallback), so
    // create targets what the user is looking at, not the raw guildId.
    const guild = activeGuild.value;
    if (!guild) return;
    roomAction.value = { kind: "create-channel", spaceId: guild.room.id, spaceName: guild.room.name };
}

// Creators resolve the roomId BEFORE the room lands in `rooms`, so selecting
// it immediately would land on a stale pane. Wait for presence, then navigate.
function waitForRoom(roomId: string, timeoutMs = 5000): Promise<boolean> {
    if (roomsById.value.has(roomId)) return Promise.resolve(true);
    return new Promise((resolve) => {
        let settled = false;
        let stop: (() => void) | undefined;
        const timer = setTimeout(() => settle(false), timeoutMs);
        function settle(value: boolean): void {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            stop?.();
            resolve(value);
        }
        stop = watch(roomsById, (map) => {
            if (map.has(roomId)) settle(true);
        });
    });
}

function onSpaceCreated(roomId: string): void {
    roomAction.value = null;
    void waitForRoom(roomId).then(() => emit("select", { view: "guild", guildId: roomId }));
}

function onChannelCreated(roomId: string): void {
    const spaceId = channelSpaceId.value;
    roomAction.value = null;
    void waitForRoom(roomId).then(() => emit("select", { view: "guild", guildId: spaceId, roomId }));
}

function onDmCreated(roomId: string): void {
    roomAction.value = null;
    void waitForRoom(roomId).then(() => emit("select", { view: "dms", roomId }));
}

/** Walk parent spaces to the rail-level guild a room hangs under. */
function topSpaceId(roomId: string): string | undefined {
    const seen = new Set<string>([roomId]);
    let current = roomsById.value.get(roomId);
    if (!current) return undefined;
    let top = current.isSpace ? current.id : undefined;
    while (current) {
        const parent = current.parentSpaceIds.find(
            (id) => !seen.has(id) && roomsById.value.get(id)?.isSpace === true,
        );
        if (parent === undefined) break;
        seen.add(parent);
        top = parent;
        current = roomsById.value.get(parent);
    }
    return top;
}

function onRoomJoined(roomId: string): void {
    roomAction.value = null;
    void waitForRoom(roomId).then(() => {
        const room = roomsById.value.get(roomId);
        if (!room) {
            // Timed out: pick the least wrong target and let the cleanup
            // watcher revert it if the room never shows up.
            emit("select", { view: "dms", roomId });
            return;
        }
        const guild = topSpaceId(roomId);
        if (room.isSpace) emit("select", { view: "guild", guildId: guild ?? roomId });
        else if (guild !== undefined) emit("select", { view: "guild", guildId: guild, roomId });
        else emit("select", { view: "dms", roomId });
    });
}

function onRoomLeft(leftId: string): void {
    roomAction.value = null;
    const sel = props.selection;
    if (sel.view === "guild" && sel.guildId === leftId) {
        emit("select", { view: "dms" });
        return;
    }
    if (sel.roomId === leftId) {
        emit("select", sel.guildId !== undefined ? { view: "guild", guildId: sel.guildId } : { view: "dms" });
    }
}

// A selection must never point at a room we no longer see. Fires only while
// synced: mid-reconnect `rooms` is incomplete and would wipe deep links.
watch([rooms, connection], () => {
    if (connection.value !== "syncing") return;
    const sel = props.selection;
    if (sel.view === "guild" && sel.guildId !== undefined && !roomsById.value.has(sel.guildId)) {
        emit("select", { view: "dms" });
        return;
    }
    if (sel.roomId !== undefined && !roomsById.value.has(sel.roomId)) {
        emit(
            "select",
            sel.view === "guild" && sel.guildId !== undefined
                ? { view: "guild", guildId: sel.guildId }
                : { view: "dms" },
        );
    }
});

// Tell the client which room is on screen: under sliding sync this keeps it
// subscribed with a richer timeline window and prioritizes its members for
// presence. A thread belongs to one room, so switching rooms also closes it.
watch(
    activeRoomId,
    (id) => {
        props.client.setRoomSelection(id ?? null);
        threadView.value = null;
        settingsOpen.value = false;
    },
    { immediate: true },
);

onBeforeUnmount(() => props.client.setRoomSelection(null));

// Sliding sync pages the room window rather than returning every room at once.
// Show "load more" while the server reports rooms behind the current window;
// classic /sync and the fake always report `false`.
const moreRooms = ref(false);
function refreshMoreRooms(): void {
    moreRooms.value = props.client.hasMoreRooms();
}
async function loadMoreRooms(): Promise<void> {
    await props.client.loadMoreRooms();
    refreshMoreRooms();
}
watch([rooms, connection], refreshMoreRooms, { immediate: true });

// Capability is only known once sync is up (it's probed in startClient), and
// supportsThreads() isn't reactive — reading `connection` makes this recompute
// as the client comes up. Thread subscriptions are taken by the slide-over
// components, which only mount after this is true, i.e. after start().
const threadsEnabled = computed(() => connection.value === "syncing" && props.client.supportsThreads());
</script>

<template>
    <ConfigProvider>
        <div class="tumult-shell">
            <ConnectionBanner :connection="connection" />
            <SecurityBanner
                :status="security"
                @setup="securityModal = 'setup'"
                @restore="securityModal = 'restore'"
            />
            <div
                class="tumult-shell-grid"
                :data-roomlist="showRoomList ? 'open' : 'closed'"
                :data-members="showMembers ? 'open' : 'closed'"
            >
                <GuildRail
                    :tree="tree"
                    :session="session"
                    :client="client"
                    @sign-out="emit('signOut')"
                    @security="openSecurityModal()"
                    @verify="openVerificationModal()"
                    @profile="profileModal = true"
                    @create-space="roomAction = { kind: 'create-space' }"
                    @join="roomAction = { kind: 'join' }"
                />
                <div class="tumult-pane tumult-pane-roomlist" :inert="!showRoomList ? true : undefined">
                    <RoomListPane
                        v-if="selection.view === 'guild'"
                        :guild="activeGuild"
                        :selection="selection"
                        :has-more="moreRooms"
                        @create-channel="openCreateChannel()"
                        @load-more="loadMoreRooms"
                    />
                    <div v-else class="tumult-roomlist-pane">
                        <header class="tumult-roomlist-header tumult-roomlist-header-row">
                            <h2>Direct Messages</h2>
                            <IconButton label="New message" @click="roomAction = { kind: 'create-dm' }">
                                <span aria-hidden="true">＋</span>
                            </IconButton>
                        </header>
                        <DmList :rooms="tree.orphans" :has-more="moreRooms" @load-more="loadMoreRooms" />
                    </div>
                </div>
                <div class="tumult-pane tumult-pane-timeline">
                    <div class="tumult-pane-toolbar">
                        <IconButton label="Toggle room list" @click="emit('toggleRoomList')">☰</IconButton>
                        <IconButton label="Toggle members" @click="emit('toggleMembers')">👥</IconButton>
                        <IconButton
                            v-if="threadsEnabled && activeRoomId"
                            label="Threads"
                            :aria-pressed="threadView !== null"
                            @click="toggleThreadList"
                            >🧵</IconButton
                        >
                    </div>
                    <TimelinePane
                        :client="client"
                        :room="activeRoom"
                        :threads-enabled="threadsEnabled"
                        :settings-allowed="settingsAllowed"
                        @open-thread="openThread"
                        @settings="settingsOpen = true"
                    />
                    <!-- Overlay, not a fourth grid track: no layout changes for the other panes. -->
                    <div v-if="threadView && threadsEnabled && activeRoomId" class="tumult-thread-overlay">
                        <ThreadList
                            v-if="threadView.mode === 'list'"
                            :key="activeRoomId"
                            :client="client"
                            :room-id="activeRoomId"
                            @open="openThread"
                            @close="closeThread"
                        />
                        <ThreadPanel
                            v-else
                            :key="threadView.threadId"
                            :client="client"
                            :room-id="activeRoomId"
                            :thread-id="threadView.threadId"
                            @back="threadView = { mode: 'list' }"
                            @close="closeThread"
                        />
                    </div>
                </div>
                <div class="tumult-pane tumult-pane-members" :inert="!showMembers ? true : undefined">
                    <!-- Keyed: one room's subscription tears down before the next mounts. -->
                    <MembersPane
                        :key="activeRoomId ?? 'none'"
                        :client="client"
                        :room-id="activeRoomId"
                        @invite="roomAction = { kind: 'invite' }"
                    />
                </div>
            </div>
<RecoverySetupModal
            :client="client"
            :open="securityModal === 'setup'"
            @close="securityModal = null"
        />
        <RecoveryRestoreModal
            :client="client"
            :open="securityModal === 'restore'"
            @close="securityModal = null"
        />
        <VerificationModal
            :client="client"
            :open="verificationModal"
            @close="verificationModal = false"
        />
        <ProfileDialog
            :client="client"
            :open="profileModal"
            @close="profileModal = false"
        />
        <RoomSettingsDialog
            :client="client"
            :open="settingsOpen && activeRoom !== undefined"
            :room="activeRoom"
            @close="settingsOpen = false"
        />
        <CreateSpaceDialog
            :client="client"
            :open="roomAction?.kind === 'create-space'"
            @close="roomAction = null"
            @created="onSpaceCreated"
        />
        <CreateChannelDialog
            :client="client"
            :open="roomAction?.kind === 'create-channel'"
            :space-id="channelSpaceId"
            :space-name="channelSpaceName"
            @close="roomAction = null"
            @created="onChannelCreated"
        />
        <JoinRoomDialog
            :client="client"
            :open="roomAction?.kind === 'join'"
            @close="roomAction = null"
            @created="onRoomJoined"
        />
        <CreateDmDialog
            :client="client"
            :open="roomAction?.kind === 'create-dm'"
            @close="roomAction = null"
            @created="onDmCreated"
        />
        <InviteDialog
            :client="client"
            :open="roomAction?.kind === 'invite'"
            :room-id="inviteRoomId"
            @close="roomAction = null"
        />
        <LeaveConfirmDialog
            :client="client"
            :open="roomAction?.kind === 'leave'"
            :target="leaveTarget"
            @close="roomAction = null"
            @left="onRoomLeft"
        />
        <ModerationConfirmDialog
            :client="client"
            :open="confirmModeration !== null"
            :action="confirmModeration"
            @close="roomAction = null"
        />
        <PowerLevelDialog
            :client="client"
            :open="powerModeration !== null"
            :action="powerModeration"
            @close="roomAction = null"
        />
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
    position: relative;
    background: var(--timeline-bg);
}
.tumult-thread-overlay {
    position: absolute;
    inset: 0 0 0 auto;
    z-index: 5;
    width: min(360px, 100%);
    border-left: 1px solid var(--border-default);
    box-shadow: -8px 0 24px rgb(0 0 0 / 0.25);
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
.tumult-roomlist-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.tumult-roomlist-header h2 {
    margin: 0;
    font-size: var(--text-sm);
}
</style>
