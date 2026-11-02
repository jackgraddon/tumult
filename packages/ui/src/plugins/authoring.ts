/**
 * The plugin **authoring surface** — the one entry point a plugin typechecks
 * against, and the only thing `templates/plugin/types/plugin.d.ts` is generated
 * from.
 *
 * This module re-exports, explicitly, exactly what a plugin may see. It is not
 * "everything in `@tumult/ui`": the shell's own internals (`PluginDeps`, the
 * dialog frames, every layout component) are deliberately absent, so the
 * generated `.d.ts` cannot drift wider than the real contract by accident.
 *
 * Three rules keep it honest:
 *
 *   - **Every export here must be plugin-safe.** Nothing that hands out a
 *     `window`/`document` handle or a shell-internal object.
 *   - **It must not reach a `.vue` import.** The generator runs `tsc` over this
 *     graph, and a component would drag SFC handling into it. Components are
 *     given TO plugins (as `unknown`, typed by their own props interfaces), never
 *     imported BY them.
 *   - **It must be able to stand alone.** The graph it pulls in (its own modules
 *     plus `@tumult/core/contract` and `vue`) is what gets bundled; anything that
 *     reached the shell's app-level modules would make the output unusable.
 *
 * `packages/ui/scripts/emit-plugin-types.ts` bundles this into
 * `templates/plugin/types/plugin.d.ts`; `packages/ui/test/plugin-types.test.ts`
 * fails when the committed file drifts.
 */

// ── The core contract a plugin reads through `ctx.client` ───────────────────
export { CONTRACT_VERSION } from "@tumult/core/contract";
export type {
    ChatClient,
    CompleteLoginParams,
    ConnectionState,
    CreateChannelParams,
    CreateDmParams,
    CreateSpaceParams,
    DecryptionStatus,
    DeviceView,
    EncryptedAttachment,
    HistoryVisibility,
    JoinRule,
    LoginParams,
    MemberView,
    Membership,
    MessageStatus,
    MessageView,
    NotificationPermission,
    OwnPresenceState,
    OwnPresenceView,
    PresenceState,
    ProfileView,
    ReactionView,
    ReplyView,
    RoomPowerLevelsView,
    RoomSettingsPatch,
    RoomSummary,
    SearchPage,
    SecurityStatus,
    SessionView,
    Subscribable,
    Subscription,
    ThreadSummary,
    UserSearchResult,
} from "@tumult/core/contract";

// ── What a plugin IS ────────────────────────────────────────────────────────
export { PLUGIN_PERMISSIONS } from "./types.ts";
export type {
    Disposable,
    Permission,
    Plugin,
    PluginApi,
    PluginContext,
    PluginManifest,
    PluginMedia,
} from "./types.ts";

// ── The six extension points and their payloads ─────────────────────────────
export { RegistryKey, useTimelineRegistry } from "../timeline/registry.ts";
export type { RendererEntry, TimelineRendererProps, TimelineRegistry } from "../timeline/registry.ts";
export { ComposerActionsKey, useComposerActions } from "../timeline/composer-actions.ts";
export type {
    ComposerAction,
    ComposerActionContext,
    ComposerActionsRegistry,
} from "../timeline/composer-actions.ts";
export { CommandsKey, useCommands } from "../timeline/commands.ts";
export type {
    Command,
    CommandContext,
    CommandsRegistry,
    ResolvedCommand,
} from "../timeline/commands.ts";
export { MemberDecorationsKey, useMemberDecorations } from "../members/decorations.ts";
export { ActivityRenderersKey, useActivity, useActivityRenderers } from "../members/activity.ts";
export type {
    ActivityProps,
    ActivityRenderer,
    ActivityRenderersRegistry,
    ActivityVariant,
    ResolvedActivity,
} from "../members/activity.ts";
export type {
    NativeActivity,
    NativeActivityFeed,
} from "./types.ts";
export type {
    MemberDecoration,
    MemberDecorationProps,
    MemberDecorationsRegistry,
} from "../members/decorations.ts";
export { SettingsTabsKey, useSettingsTabs } from "../settings/tabs.ts";
export type { SettingsTab, SettingsTabProps, SettingsTabsRegistry } from "../settings/tabs.ts";
export { WorkspacePanesKey, useWorkspacePanes } from "../panes/registry.ts";
export type { WorkspacePane, WorkspacePanesRegistry } from "../panes/registry.ts";

// ── Navigation and cross-pane actions ───────────────────────────────────────
export { SelectionKey, useSelection } from "../selection.ts";
export type { RoomSelection, SelectionContext } from "../selection.ts";
export { ActionsKey, useActions } from "../actions.ts";
export type {
    ActionsContext,
    LeaveTarget,
    MemberModeration,
    MemberModerationKind,
} from "../actions.ts";

// ── Install-time helpers a plugin may call at runtime ───────────────────────
export { PLUGIN_API_VERSION, compareVersions } from "./compat.ts";
export { deriveLane, SANDBOXABLE_PERMISSIONS } from "./lane.ts";
export type { PluginLane } from "./lane.ts";
