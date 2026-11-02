<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { ConfigProvider } from "reka-ui";
import { selectSpaceTree } from "@tumult/core/selectors";
import type { ChatClient, EncryptedAttachment, SpaceTree } from "@tumult/core";

import { SelectionKey, type RoomSelection, type SelectionContext } from "../selection.ts";
import { ActionsKey, type ActionsContext, type LeaveTarget, type MemberModeration } from "../actions.ts";
import { MediaKey, EncryptedMediaKey, MediaDownloadKey } from "../media.ts";
import { RegistryKey, TimelineRegistry } from "../timeline/registry.ts";
import { ComposerActionsKey, ComposerActionsRegistry } from "../timeline/composer-actions.ts";
import { CommandsKey, CommandsRegistry } from "../timeline/commands.ts";
import { DraftsKey, createDraftStore } from "../timeline/drafts.ts";
import { MemberDecorationsKey, MemberDecorationsRegistry } from "../members/decorations.ts";
import { ActivityRenderersKey, ActivityRenderersRegistry } from "../members/activity.ts";
import { PluginsKey, PluginRegistry } from "../plugins/registry.ts";
import { createNativeActivityFeed, type NativeActivityFeedController } from "../plugins/native-activity.ts";
import { injectStylesheet } from "../plugins/styles.ts";
import { installVueBridge } from "../plugins/vueBridge.ts";
import { SettingsTabsKey, SettingsTabsRegistry } from "../settings/tabs.ts";
import { IconsKey } from "../icons/registry.ts";
import { createIconRegistry } from "../icons/index.ts";
import { WorkspacePanesKey, WorkspacePanesRegistry } from "../panes/registry.ts";
import { useSubscribable } from "../subscribable.ts";
import TextMessage from "../timeline/renderers/TextMessage.vue";
import MediaMessage from "../timeline/renderers/MediaMessage.vue";
import ConnectionBanner from "./ConnectionBanner.vue";
import GuildRail from "../rail/GuildRail.vue";
import UserBar from "../rail/UserBar.vue";
import StatusDialog from "../rail/StatusDialog.vue";
import RoomListPane from "../roomlist/RoomListPane.vue";
import DmList from "../roomlist/DmList.vue";
import TimelinePane from "../timeline/TimelinePane.vue";
import MembersPane from "../members/MembersPane.vue";
import IconButton from "../primitives/IconButton.vue";
import SecurityBanner from "../security/SecurityBanner.vue";
import SecurityModal from "../security/SecurityModal.vue";
import ThreadPanel from "../threads/ThreadPanel.vue";
import CallMenu from "../calls/CallMenu.vue";
import CallPanel from "../calls/CallPanel.vue";
import VoiceBar from "../calls/VoiceBar.vue";
import VoiceStage from "../calls/VoiceStage.vue";
import RoomCallStrip from "../calls/RoomCallStrip.vue";
import { useFeedsReady } from "../feedsReady.ts";
import { VoiceRoomsKey } from "../calls/voiceRooms.ts";
import ThreadList from "../threads/ThreadList.vue";
import CreateSpaceDialog from "../rooms/CreateSpaceDialog.vue";
import CreateChannelDialog from "../rooms/CreateChannelDialog.vue";
import JoinRoomDialog from "../rooms/JoinRoomDialog.vue";
import CreateDmDialog from "../rooms/CreateDmDialog.vue";
import InviteDialog from "../rooms/InviteDialog.vue";
import LeaveConfirmDialog from "../rooms/LeaveConfirmDialog.vue";
import RoomSettingsDialog from "../rooms/RoomSettingsDialog.vue";
import ModerationConfirmDialog from "../members/ModerationConfirmDialog.vue";
import PowerLevelDialog from "../members/PowerLevelDialog.vue";
import SettingsDialog from "../settings/SettingsDialog.vue";
import PluginsTab from "../settings/PluginsTab.vue";
import AppearanceTab from "../settings/AppearanceTab.vue";
import VoiceTab from "../settings/VoiceTab.vue";
import ThemesTab from "../settings/ThemesTab.vue";
import AccountPage from "../settings/AccountPage.vue";
import SecurityPage from "../settings/SecurityPage.vue";
import { tryUseTheme } from "../theme/controls.ts";
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
    if (next.view === "pane") return `/p/${encodeURIComponent(next.paneId ?? "")}`;
    const guild = next.guildId ? `/g/${encodeURIComponent(next.guildId)}` : "/g";
    return next.roomId ? `${guild}/${encodeURIComponent(next.roomId)}` : guild;
}

const selectionContext: SelectionContext = {
    get current() {
        return props.selection;
    },
    select: (next: RoomSelection) => {
        // A pick that lands on something to read opens it on a phone — even a
        // re-tap of the room already selected, which changes no selection.
        if (opensScreen(next)) phoneScreen.value = "room";
        emit("select", next);
    },
    hrefFor,
};
provide(SelectionKey, selectionContext);

// --- Phone layout ------------------------------------------------------------
// Side by side needs the rail, the room list AND a usable timeline. Below that
// the shell shows one screen at a time — rail + room list, the timeline, or the
// members — and the toolbar navigates between them instead of collapsing
// tracks. The threshold is the theme's own widths, measured off a hidden probe:
// a media query cannot read a custom property, and the token gate forbids a
// literal length in the stylesheet (the settings overlay does the same).
const shellEl = ref<HTMLElement | null>(null);
const probe = ref<HTMLElement | null>(null);
const phone = ref(false);
/** Phone only: which screen shows. A deep link to a room opens on the room. */
const phoneScreen = ref<"nav" | "room" | "members">(opensScreen(props.selection) ? "room" : "nav");

/** A selection with something to read. Truthy, not `!== undefined`: the app's
 *  router hands over `roomId: ""` for a bare `/dms`, as `activeRoom` knows. */
function opensScreen(sel: RoomSelection): boolean {
    return Boolean(sel.roomId) || sel.view === "pane";
}

function measureLayout(): void {
    if (!shellEl.value || !probe.value) return;
    phone.value = shellEl.value.clientWidth < probe.value.offsetWidth;
}

let layoutObserver: ResizeObserver | null = null;
onMounted(() => {
    if (!shellEl.value) return;
    layoutObserver = new ResizeObserver(measureLayout);
    layoutObserver.observe(shellEl.value);
    measureLayout();
});

// Navigation that bypasses the selection context (a creator, a join, a leave)
// still lands on the room it picked.
watch(
    () => [props.selection.view, props.selection.roomId, props.selection.paneId] as const,
    (next, prev) => {
        // The getter builds a fresh tuple every run: compare the parts, or a
        // recompute with nothing new would yank the user off the room list.
        if (next.every((part, i) => part === prev[i])) return;
        if (opensScreen(props.selection)) phoneScreen.value = "room";
    },
);

const roomListHidden = computed(() => (phone.value ? phoneScreen.value !== "nav" : !props.showRoomList));
const membersHidden = computed(() => (phone.value ? phoneScreen.value !== "members" : !props.showMembers));
// Wide, the timeline and the chrome never collapse; a phone hands the whole
// width to one screen, so the others go to 0-width + inert like any pane.
const timelineHidden = computed(() => phone.value && phoneScreen.value !== "room");
const chromeHidden = computed(() => phone.value && phoneScreen.value !== "nav");

// A leave/moderation request starts in a list row (which can't reach the
// shell's dialogs) and lands in `roomAction` here. Declared above the plugin
// registry because the plugin context exposes the actions channel.
type RoomAction =
    | { kind: "create-space" }
    | { kind: "create-channel"; spaceId: string; spaceName: string }
    | { kind: "join" }
    | { kind: "create-dm" }
    | { kind: "invite"; roomId?: string }
    | { kind: "leave"; target: LeaveTarget }
    | { kind: "moderate"; moderation: MemberModeration }
    | null;

const roomAction = ref<RoomAction>(null);

const actionsCtx: ActionsContext = {
    requestLeave(target) {
        roomAction.value = { kind: "leave", target };
    },
    requestModeration(moderation) {
        roomAction.value = { kind: "moderate", moderation };
    },
    requestMarkRead(roomId) {
        // No dialog, no state: the room list asks, the client does it, sync
        // republishes the badge. Failure logs — the badge simply stays.
        void props.client.markRead(roomId).catch((error: unknown) => {
            console.error("[tumult] mark read failed", error);
        });
    },
    requestPinRoom(roomId, pinned) {
        void props.client.setRoomPinned(roomId, pinned).catch((error: unknown) => {
            console.error("[tumult] pin failed", error);
        });
    },
    requestMuteRoom(roomId, muted) {
        void props.client.setRoomMuted(roomId, muted).catch((error: unknown) => {
            console.error("[tumult] mute failed", error);
        });
    },
    requestMarkSpaceRead(spaceId) {
        // Every unread channel in the space's subtree. Each markRead is its own
        // call, so one failure must not stop the rest.
        for (const id of spaceDescendantChannels(spaceId)) {
            const room = roomsById.value.get(id);
            if (!room || (room.unreadCount === 0 && room.highlightCount === 0)) continue;
            void props.client.markRead(id).catch((error: unknown) => {
                console.error("[tumult] mark space read failed", id, error);
            });
        }
    },
    requestSpaceSettings(spaceId) {
        settingsRoomId.value = spaceId;
        settingsOpen.value = true;
    },
    requestSpaceInvite(spaceId) {
        roomAction.value = { kind: "invite", roomId: spaceId };
    },
    requestSpaceCreateChannel(spaceId) {
        const space = roomsById.value.get(spaceId);
        if (!space) return;
        roomAction.value = { kind: "create-channel", spaceId, spaceName: space.name };
    },
};
provide(ActionsKey, actionsCtx);

// One timeline registry, one contribution registry per extension point, and
// one plugin host per shell. The built-in renderers register through the host
// (unpermissioned — this call IS the shell); apps install plugins on top via
// the exposed `plugins` handle, e.g. the demo poll.
const registry = new TimelineRegistry();
const composerActions = new ComposerActionsRegistry();
const commands = new CommandsRegistry();
// One draft store per shell, shared by every composer in the tree. Kept in
// memory for instant re-select; its localStorage mirror lands on a trailing
// debounce and a final `flush()` on unmount (below).
const drafts = createDraftStore();
const memberDecorations = new MemberDecorationsRegistry();
const activityRenderers = new ActivityRenderersRegistry(props.client);
const settingsTabs = new SettingsTabsRegistry();
const panes = new WorkspacePanesRegistry();
const media = {
    resolve: (uri: string, size: number) => props.client.resolveMedia(uri, size),
    resolveDownload: (uri: string) => props.client.resolveMediaDownload(uri),
    resolveEncrypted: (file: EncryptedAttachment) => props.client.resolveEncryptedMedia(file),
};
// The native activity feed. On desktop the preload exposes `window.tumultNative`
// (the one declared bridge) and the feed is live; on the web it is undefined,
// so the feed is empty and a native-presence plugin degrades to the status line.
const nativeFeed: NativeActivityFeedController = createNativeActivityFeed(window.tumultNative);
const plugins = new PluginRegistry({
    client: props.client,
    timeline: registry,
    composerActions,
    commands,
    memberDecorations,
    activityRenderers,
    settingsTabs,
    panes,
    selection: selectionContext,
    actions: actionsCtx,
    media,
    nativeActivity: nativeFeed.feed,
    injectStylesheet,
});
provide(RegistryKey, registry);
provide(PluginsKey, plugins);
provide(ComposerActionsKey, composerActions);
provide(CommandsKey, commands);
provide(DraftsKey, drafts);
provide(MemberDecorationsKey, memberDecorations);
provide(ActivityRenderersKey, activityRenderers);
provide(SettingsTabsKey, settingsTabs);
provide(WorkspacePanesKey, panes);
provide(IconsKey, createIconRegistry());

// A third-party plugin's bundle shares THIS Vue instance (a second copy would
// break provide/inject and its own lifecycle hooks), and it reaches it through
// the bridge the template's build shim forwards to.
installVueBridge();

const mediaTypes = new Set(["m.image", "m.video", "m.audio", "m.file"]);
plugins.addRenderer("m.room.message", {
    component: MediaMessage,
    priority: 10,
    match: (m) => typeof m.content["msgtype"] === "string" && mediaTypes.has(m.content["msgtype"]),
});
plugins.addRenderer("m.room.message", { component: TextMessage, priority: 0 });

// The shell's own settings pages, alongside whatever plugins contribute. Pages
// render inside this shell's tree, so they can inject anything provided here.
// The account menu deep-links to these ids (`openAppSettings`).
const SETTINGS_ACCOUNT = "cc.jackg.tumult.account";
const SETTINGS_SECURITY = "cc.jackg.tumult.security";
plugins.addSettingsTab({
    id: SETTINGS_ACCOUNT,
    title: "My Account",
    component: AccountPage,
    section: "account",
    priority: 10,
});
plugins.addSettingsTab({
    id: SETTINGS_SECURITY,
    title: "Security",
    component: SecurityPage,
    section: "account",
});
// Sorts ahead of every plugin's own page in the same section.
plugins.addSettingsTab({
    id: "cc.jackg.tumult.plugins",
    title: "Installed",
    component: PluginsTab,
    section: "plugins",
    priority: 100,
});

// Appearance is the shell's theming surface, but storage and the DOM belong to
// the app — it provides a `ThemeControls` implementation above the shell.
// Without one there is nothing to manage, so the pages are simply absent (a
// bare UI host gets no half-wired theme editor).
if (tryUseTheme()) {
    plugins.addSettingsTab({
        id: "cc.jackg.tumult.appearance",
        title: "Appearance",
        component: AppearanceTab,
        section: "app",
        priority: 10,
    });
    plugins.addSettingsTab({
        id: "cc.jackg.tumult.themes",
        title: "Themes",
        component: ThemesTab,
        section: "app",
    });
}

// Microphone processing only means something where native voice is on.
if (props.client.supportsVoice()) {
    plugins.addSettingsTab({
        id: "cc.jackg.tumult.voice",
        title: "Voice",
        component: VoiceTab,
        section: "app",
        priority: 5,
    });
}

provide(MediaKey, media.resolve);
provide(EncryptedMediaKey, media.resolveEncrypted);
provide(MediaDownloadKey, media.resolveDownload);

defineExpose({ registry, plugins, hrefFor });

const rooms = useSubscribable(props.client.rooms);
const connection = useSubscribable(props.client.connection);
const session = useSubscribable(props.client.session);
const security = useSubscribable(props.client.security);
const verification = useSubscribable(props.client.verification);

// The "enter backup" path (create a key on a fresh account, otherwise enter one)
// lives inside the chooser, so banner triggers and the menu all converge on the
// same modal. "Verify this device…" and an incoming request instead skip the
// chooser and open the SAS flow directly.
const securityStep = ref<"landing" | "sas">("landing");
const securityModalOpen = ref(false);

function openSecurityChooser(): void {
    securityStep.value = "landing";
    securityModalOpen.value = true;
}

function openVerifyFlow(): void {
    securityStep.value = "sas";
    securityModalOpen.value = true;
}

// Status dialog (presence + status message): the user bar's status line and
// the account menu's "Set status…" both open it.
const statusModal = ref(false);

// Room settings dialog: the timeline header's gear opens it, scoped to the
// room being viewed. Room switch closes it (the room prop must not change
// under a seeded form).
const settingsOpen = ref(false);
// A space's settings open from its rail tile while another room is on screen,
// so the dialog's target is its own slot; null means "the room being viewed".
const settingsRoomId = ref<string | null>(null);

// App settings overlay (account menu → Settings…): the shell's own pages plus
// every plugin-contributed one. Distinct from `settingsOpen`, which is the
// per-room settings dialog. The page to open on rides along, so a menu entry
// can deep-link; the overlay itself owns the selection once it is open.
const appSettingsOpen = ref(false);
const appSettingsTab = ref<string | null>(null);

function openAppSettings(tab: string | null = null): void {
    appSettingsTab.value = tab;
    appSettingsOpen.value = true;
}

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
// user must see the accept/decline prompt without hunting for it. It opens the
// unified modal on the SAS flow, skipping the chooser.
watch(
    () => verification.value.requests,
    (requests) => {
        if (!securityModalOpen.value && requests.some((r) => !r.initiatedByMe && r.phase !== "done" && r.phase !== "cancelled")) {
            openVerifyFlow();
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

// Calls are a capability of the client + the deployment (a call app to embed),
// not of the shell: no call app configured means no affordance at all.
const callsEnabled = props.client.supportsCalls();
const call = useSubscribable(props.client.call);

// Native audio voice is a separate capability from the embedded call app: it
// needs the host to supply an E2EE worker, so it can be on while calls are off.
const voiceEnabled = props.client.supportsVoice();
// Room feeds throw before start(); panes keyed on this resubscribe once they exist.
const feedsReady = useFeedsReady(props.client);
const voice = useSubscribable(props.client.voice);
provide(VoiceRoomsKey, useSubscribable(props.client.voiceRooms));

// One entry point for "start a call here": native when the host has it, the
// embedded app only as the fallback. The user picks voice or video, not a protocol.
function joinCall(roomId: string, video: boolean): void {
    const action = voiceEnabled ? props.client.joinVoice(roomId, { video }) : props.client.joinCall(roomId, { video });
    void action.catch((error: unknown) => console.error("[tumult] could not start the call", error));
}

function leaveCall(roomId: string): void {
    if (voice.value?.roomId !== roomId) return;
    void props.client.leaveVoice().catch((error: unknown) => console.error("[tumult] could not leave voice", error));
}

// The workspace pane the selection points at, if any. Reading the registry
// inside a computed registers the dependency, so a pane a plugin registers
// after the first paint still opens.
const activePane = computed(() => {
    const paneId = props.selection.view === "pane" ? props.selection.paneId : undefined;
    return paneId === undefined ? undefined : panes.get(paneId);
});

// The gear opens room settings; while power levels are unknown we leave it
// visible and let the server reject (the slice-23 rule). Once known, only
// members who clear the room's `state_default` see it.
const activePower = useRoomPower(props.client, () => activeRoomId.value);
const settingsAllowed = computed(() => activePower.value === null || activePower.value.canEditSettings);

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
const inviteRoomId = computed(() => {
    const action = roomAction.value;
    return (action?.kind === "invite" ? action.roomId : undefined) ?? activeRoomId.value ?? "";
});
const settingsRoom = computed(() =>
    settingsRoomId.value ? roomsById.value.get(settingsRoomId.value) : activeRoom.value,
);

/** Every non-space room beneath a space, through nested spaces (cycle-safe). */
function spaceDescendantChannels(spaceId: string): string[] {
    const spaces = new Set<string>([spaceId]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const room of rooms.value) {
            if (room.isSpace && !spaces.has(room.id) && room.parentSpaceIds.some((p) => spaces.has(p))) {
                spaces.add(room.id);
                grew = true;
            }
        }
    }
    return rooms.value
        .filter((r) => !r.isSpace && r.parentSpaceIds.some((p) => spaces.has(p)))
        .map((r) => r.id);
}

function closeSettings(): void {
    settingsOpen.value = false;
    settingsRoomId.value = null;
}

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
        settingsRoomId.value = null;
    },
    { immediate: true },
);

onBeforeUnmount(() => {
    // Plugins are per-shell: unmount takes every installed one down with it
    // (renderers unregistered, teardowns run) so a re-mount starts clean.
    plugins.uninstallAll();
    // Tear the native feed's bridge subscription down too: the preload's bridge
    // outlives this shell, so a re-mount (logout → login) must not stack feeds
    // onto the same bridge.
    nativeFeed.dispose();
    // Persist any half-typed draft still pending its debounce so a room switch or
    // logout doesn't lose it, and clear the timer so nothing writes past teardown.
    drafts.flush();
    props.client.setRoomSelection(null);
    layoutObserver?.disconnect();
});

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
        <div ref="shellEl" class="tumult-shell">
            <div ref="probe" class="tumult-shell-probe" aria-hidden="true" />
            <ConnectionBanner :connection="connection" />
            <SecurityBanner
                :status="security"
                @setup="openSecurityChooser()"
                @restore="openSecurityChooser()"
            />
            <div
                class="tumult-shell-grid"
                :data-roomlist="showRoomList ? 'open' : 'closed'"
                :data-members="showMembers ? 'open' : 'closed'"
                :data-view="activePane ? 'pane' : 'room'"
                :data-layout="phone ? 'phone' : 'wide'"
                :data-screen="phone ? phoneScreen : undefined"
            >
                <GuildRail
                    :inert="chromeHidden ? true : undefined"
                    :tree="tree"
                    :panes="panes.all()"
                    @create-space="roomAction = { kind: 'create-space' }"
                    @join="roomAction = { kind: 'join' }"
                />
                <div class="tumult-pane tumult-pane-roomlist" :inert="roomListHidden ? true : undefined">
                    <!-- A workspace pane owns the left track: its own nav, not the room list. -->
                    <component :is="activePane.sidebar" v-if="activePane?.sidebar" class="tumult-pane-sidebar" />
                    <RoomListPane
                        v-else-if="selection.view === 'guild'"
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
                                <Icon name="plus" />
                            </IconButton>
                        </header>
                        <DmList :rooms="tree.orphans" :has-more="moreRooms" @load-more="loadMoreRooms" />
                    </div>
                    <VoiceBar v-if="voiceEnabled" :client="client" />
                </div>
                <div class="tumult-pane tumult-pane-timeline" :inert="timelineHidden ? true : undefined">
                    <div class="tumult-pane-toolbar">
                        <IconButton v-if="phone" label="Back to rooms" @click="phoneScreen = 'nav'"><Icon name="chevron-left" /></IconButton>
                        <IconButton v-else label="Toggle room list" @click="emit('toggleRoomList')"><Icon name="menu" /></IconButton>
                        <CallMenu
                            v-if="!activePane && activeRoomId"
                            :voice="voiceEnabled"
                            :calls="callsEnabled && call?.roomId !== activeRoomId"
                            :active="voice?.roomId === activeRoomId"
                            @join="(video) => activeRoomId && joinCall(activeRoomId, video)"
                            @leave="activeRoomId && leaveCall(activeRoomId)"
                        />
                        <IconButton v-if="!activePane && phone" label="Show members" @click="phoneScreen = 'members'"><Icon name="account-group" /></IconButton>
                        <IconButton v-else-if="!activePane" label="Toggle members" @click="emit('toggleMembers')"><Icon name="account-group" /></IconButton>
                        <IconButton
                            v-if="!activePane && threadsEnabled && activeRoomId"
                            label="Threads"
                            :aria-pressed="threadView !== null"
                            @click="toggleThreadList"
                            ><Icon name="forum" /></IconButton
                        >
                    </div>
                    <RoomCallStrip
                        v-if="!activePane && voiceEnabled && activeRoomId"
                        :key="`${activeRoomId}:${feedsReady}`"
                        :client="client"
                        :room-id="activeRoomId"
                    />
                    <VoiceStage v-if="!activePane && voiceEnabled && activeRoomId" :client="client" :room-id="activeRoomId" />
                    <component :is="activePane.content" v-if="activePane" class="tumult-pane-content" />
                    <TimelinePane
                        v-else
                        :client="client"
                        :room="activeRoom"
                        :threads-enabled="threadsEnabled"
                        :settings-allowed="settingsAllowed"
                        @open-thread="openThread"
                        @settings="settingsOpen = true"
                    />
                    <!-- The workspace pane's own bottom bar, inside the timeline
                         track: a grid row would overlap a full-height timeline,
                         and the pane's bar belongs to the pane, not the shell. -->
                    <div v-if="activePane?.footer" class="tumult-pane-footer">
                        <component :is="activePane.footer" />
                    </div>
                    <!-- Stays mounted for the whole call, wherever the user browses:
                         unmounting its frame would hang up. -->
                    <CallPanel v-if="callsEnabled" :client="client" :active-room-id="activeRoomId" @return="onRoomJoined" />
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
                <div class="tumult-pane tumult-pane-members" :inert="membersHidden ? true : undefined">
                    <div v-if="phone" class="tumult-pane-toolbar">
                        <IconButton label="Back to chat" @click="phoneScreen = 'room'"><Icon name="chevron-left" /></IconButton>
                    </div>
                    <!-- Keyed: one room's subscription tears down before the next mounts. -->
                    <MembersPane
                        :key="`${activeRoomId ?? 'none'}:${feedsReady}`"
                        :client="client"
                        :room-id="activeRoomId"
                        @invite="roomAction = { kind: 'invite' }"
                    />
                </div>
                <!-- The account bar closes the grid: it owns the rail AND the
                     room list's tracks, so the two leftmost panes end above it. -->
                <UserBar
                    class="tumult-userbar"
                    :inert="chromeHidden ? true : undefined"
                    :client="client"
                    :session="session"
                    :compact="phone ? false : !showRoomList"
                    @profile="openAppSettings(SETTINGS_ACCOUNT)"
                    @settings="openAppSettings()"
                    @status="statusModal = true"
                />
            </div>
        <SecurityModal
            :client="client"
            :open="securityModalOpen"
            :initial="securityStep"
            @close="securityModalOpen = false"
        />
        <StatusDialog
            :client="client"
            :open="statusModal"
            @close="statusModal = false"
        />
        <RoomSettingsDialog
            :client="client"
            :open="settingsOpen && settingsRoom !== undefined"
            :room="settingsRoom"
            @close="closeSettings"
        />
        <SettingsDialog
            :client="client"
            :open="appSettingsOpen"
            :initial-tab="appSettingsTab"
            @close="appSettingsOpen = false"
            @sign-out="emit('signOut')"
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
    position: relative;
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
    /* Row 1 is the workspace, row 2 is the account bar spanning the rail and
       the room list; everything else keeps row 1 and stops where the bar
       starts (the bar is chrome to its left, so it is not a pane track). */
    grid-template-rows: minmax(0, 1fr) auto;
}
.tumult-userbar {
    grid-column: 1 / 3;
    grid-row: 2;
}
.tumult-shell-grid > .tumult-rail {
    grid-column: 1;
    grid-row: 1;
}
.tumult-pane-roomlist {
    grid-column: 2;
    grid-row: 1;
}
.tumult-pane-timeline {
    grid-column: 3;
    grid-row: 1 / -1;
}
.tumult-pane-members {
    grid-column: 4;
    grid-row: 1 / -1;
}
.tumult-pane-footer {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface-pane);
    border-top: var(--border-width) solid var(--border-default);
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
/* A workspace pane replaces the room list and the timeline: the member list
   is about a room, so it has nothing to say here. */
.tumult-shell-grid[data-view="pane"] {
    grid-template-columns:
        var(--layout-guild-rail-width)
        var(--layout-roomlist-width)
        minmax(0, 1fr)
        0;
}
.tumult-shell-grid[data-view="pane"][data-roomlist="closed"] {
    grid-template-columns:
        var(--layout-guild-rail-width)
        0
        minmax(0, 1fr)
        0;
}
/* Phone: one screen at a time. Declared after the wide variants, at the same
   or higher specificity, so a stale data-roomlist/data-members cannot win. The
   hidden screens stay mounted as 0-width inert tracks. */
.tumult-shell-grid[data-layout="phone"][data-screen="nav"] {
    grid-template-columns:
        var(--layout-guild-rail-width)
        minmax(0, 1fr)
        0
        0;
}
.tumult-shell-grid[data-layout="phone"][data-screen="room"] {
    grid-template-columns:
        0
        0
        minmax(0, 1fr)
        0;
}
.tumult-shell-grid[data-layout="phone"][data-screen="members"] {
    grid-template-columns:
        0
        0
        0
        minmax(0, 1fr);
}
.tumult-shell-grid[data-layout="phone"] > .tumult-rail[inert],
.tumult-shell-grid[data-layout="phone"] > .tumult-userbar[inert],
.tumult-shell-grid[data-layout="phone"] > .tumult-pane-timeline[inert] {
    width: 0;
    overflow: hidden;
    visibility: hidden;
}
/* Measures the side-by-side threshold in the theme's own units. Wider than a
   phone by definition, so it hangs off the inline END: overflow toward the
   start edge is not scrollable, and a probe that widened the page would force
   the very zoom-out this layout exists to prevent. */
.tumult-shell-probe {
    position: absolute;
    top: 0;
    inset-inline-end: 0;
    width: calc(var(--layout-guild-rail-width) + var(--layout-roomlist-width) + var(--layout-timeline-min-width));
    height: 0;
    visibility: hidden;
    pointer-events: none;
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
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--timeline-bg);
}
/* The pane's content fills the track; its own layout is the plugin's. */
.tumult-pane-content {
    flex: 1 1 auto;
    min-height: 0;
}
/* The pane's left nav fills the room-list track, the same place the channel
   list lives. */
.tumult-pane-sidebar {
    flex: 1 1 auto;
    min-height: 0;
}
.tumult-thread-overlay {
    position: absolute;
    inset: 0 0 0 auto;
    z-index: var(--panel-z);
    width: min(var(--panel-width), 100%);
    border-left: var(--border-width) solid var(--panel-border);
    box-shadow: var(--panel-shadow);
}
.tumult-pane-toolbar {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-bottom: var(--border-width) solid var(--border-default);
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
    border-bottom: var(--border-width) solid var(--border-default);
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
