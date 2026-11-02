export { useSubscribable } from "./subscribable.ts";
export { SelectionKey, useSelection } from "./selection.ts";
export type { RoomSelection, SelectionContext } from "./selection.ts";
export { ActionsKey, useActions } from "./actions.ts";
export type { ActionsContext, LeaveTarget, MemberModeration, MemberModerationKind } from "./actions.ts";
export { TimelineRegistry, RegistryKey, useTimelineRegistry } from "./timeline/registry.ts";
export type { RendererEntry, TimelineRendererProps } from "./timeline/registry.ts";
export { PluginRegistry, PluginsKey, usePluginRegistry } from "./plugins/registry.ts";
export {
    PLUGIN_PERMISSIONS,
} from "./plugins/types.ts";
export type {
    Disposable,
    Permission,
    Plugin,
    PluginApi,
    PluginContext,
    PluginDeps,
    PluginManifest,
    PluginMedia,
    NativeActivity,
    NativeActivityFeed,
} from "./plugins/types.ts";
export { deriveLane, SANDBOXABLE_PERMISSIONS } from "./plugins/lane.ts";
export type { PluginLane } from "./plugins/lane.ts";
export { createNativeActivityFeed, emptyNativeActivityFeed } from "./plugins/native-activity.ts";
export type {
    NativeActivityBridge,
    NativeActivityFeedController,
} from "./plugins/native-activity.ts";
export { sandboxPlugin } from "./plugins/sandbox/host.ts";
export type { SandboxEntry, SandboxHost, SandboxTransport } from "./plugins/sandbox/host.ts";
export { createFrameTransport, FRAME_BOOT_TIMEOUT_MS, FRAME_MESSAGE } from "./plugins/sandbox/frame.ts";
export type { FrameTransport, FrameTransportDeps, MountedFrame, PortLike } from "./plugins/sandbox/frame.ts";
export { SANDBOX_PROTOCOL_VERSION } from "./plugins/sandbox/protocol.ts";
export type { SandboxCapabilities } from "./plugins/sandbox/protocol.ts";
export { PLUGIN_API_VERSION, checkManifestCompatibility, compareVersions } from "./plugins/compat.ts";
export {
    parsePluginSource,
    sourceSlug,
    sourceUrl,
    releaseApiUrl,
    rawManifestUrl,
} from "./plugins/source.ts";
export type { PluginSource } from "./plugins/source.ts";
export {
    addedPermissions,
    checkReleaseManifest,
    hashBundle,
    hashMismatchReason,
    needsConsent,
    samePermissionSet,
} from "./plugins/verify.ts";
export type { InstallRecordSummary, ManifestCheck } from "./plugins/verify.ts";
export { describePermission, LANE_SUMMARY, PERMISSION_SUMMARY } from "./plugins/consent.ts";
export { PluginInstallKey, usePluginInstall, tryUsePluginInstall } from "./plugins/installControls.ts";
export type {
    InstallOutcome,
    InstalledPluginView,
    PendingInstall,
    PluginInstallControls,
} from "./plugins/installControls.ts";
export {
    buildPluginSchema,
    buildPluginSchemaJson,
    validatePluginManifest,
    REQUIRED_MANIFEST_KEYS,
} from "./plugins/schema.ts";
export {
    ComposerActionsKey,
    ComposerActionsRegistry,
    useComposerActions,
} from "./timeline/composer-actions.ts";
export type { ComposerAction, ComposerActionContext } from "./timeline/composer-actions.ts";
export { CommandsKey, CommandsRegistry, useCommands } from "./timeline/commands.ts";
export type { Command, CommandContext, ResolvedCommand } from "./timeline/commands.ts";
export { MemberDecorationsKey, MemberDecorationsRegistry, useMemberDecorations } from "./members/decorations.ts";
export type { MemberDecoration, MemberDecorationProps } from "./members/decorations.ts";
export { ActivityRenderersKey, ActivityRenderersRegistry, useActivity, useActivityRenderers } from "./members/activity.ts";
export type { ActivityProps, ActivityRenderer, ActivityVariant, ResolvedActivity } from "./members/activity.ts";
export { SettingsTabsKey, SettingsTabsRegistry, useSettingsTabs } from "./settings/tabs.ts";
export type { SettingsSection, SettingsTab, SettingsTabProps } from "./settings/tabs.ts";
export { default as Icon } from "./icons/Icon.vue";
export { createIconRegistry } from "./icons/index.ts";
export { DEFAULT_ICON_PACK, IconRegistry, IconsKey, parseIconRef, useIcons } from "./icons/registry.ts";
export type { IconDef, IconPack, IconRef } from "./icons/registry.ts";
export { WorkspacePanesKey, WorkspacePanesRegistry, useWorkspacePanes } from "./panes/registry.ts";
export type { WorkspacePane } from "./panes/registry.ts";
export { installVueBridge } from "./plugins/vueBridge.ts";
export { findExternalStylesheetReferences, injectStylesheet } from "./plugins/styles.ts";
export { default as SettingsDialog } from "./settings/SettingsDialog.vue";
export { default as PluginsTab } from "./settings/PluginsTab.vue";
export { default as InstallConsentDialog } from "./plugins/InstallConsentDialog.vue";
export { default as AppearanceTab } from "./settings/AppearanceTab.vue";
export { default as ThemesTab } from "./settings/ThemesTab.vue";
export { default as AccountPage } from "./settings/AccountPage.vue";
export { default as SecurityPage } from "./settings/SecurityPage.vue";
export { ThemeKey, useTheme, tryUseTheme } from "./theme/controls.ts";
export type { ThemeControls, ThemeState, ThemeResult, ThemeGalleryEntry } from "./theme/controls.ts";
export { resolveTokenValue, toHexColor, tokenHex } from "./theme/color.ts";
export { default as TumultShell } from "./shell/TumultShell.vue";
export { default as ConnectionBanner } from "./shell/ConnectionBanner.vue";
export { default as GuildRail } from "./rail/GuildRail.vue";
export { default as GuildRailItem } from "./rail/GuildRailItem.vue";
export { default as DmsRailItem } from "./rail/DmsRailItem.vue";
export { default as PaneRailItem } from "./rail/PaneRailItem.vue";
export { default as UserBar } from "./rail/UserBar.vue";
export { default as StatusDialog } from "./rail/StatusDialog.vue";
export { default as RoomListPane } from "./roomlist/RoomListPane.vue";
export { default as SpaceCategory } from "./roomlist/SpaceCategory.vue";
export { default as RoomListItem } from "./roomlist/RoomListItem.vue";
export { default as DmList } from "./roomlist/DmList.vue";
export { default as TimelinePane } from "./timeline/TimelinePane.vue";
export { default as TimelineViewport } from "./timeline/TimelineViewport.vue";
export { default as TimelineRow } from "./timeline/TimelineRow.vue";
export { default as MessageComposer } from "./timeline/MessageComposer.vue";
export { default as TextMessage } from "./timeline/renderers/TextMessage.vue";
export { default as UnknownEvent } from "./timeline/renderers/UnknownEvent.vue";
export { default as DecryptionPlaceholder } from "./timeline/renderers/DecryptionPlaceholder.vue";
export { default as MembersPane } from "./members/MembersPane.vue";
export { default as MemberListItem } from "./members/MemberListItem.vue";
export { default as SecurityBanner } from "./security/SecurityBanner.vue";
export { default as SecurityModal } from "./security/SecurityModal.vue";
export { default as Avatar } from "./primitives/Avatar.vue";
export { default as UnreadBadge } from "./primitives/UnreadBadge.vue";
export { default as IconButton } from "./primitives/IconButton.vue";
export { default as ThreadPanel } from "./threads/ThreadPanel.vue";
export { default as ThreadList } from "./threads/ThreadList.vue";
export { default as RoomDialog } from "./rooms/RoomDialog.vue";
export { default as UserPicker } from "./rooms/UserPicker.vue";
export { default as CreateSpaceDialog } from "./rooms/CreateSpaceDialog.vue";
export { default as CreateChannelDialog } from "./rooms/CreateChannelDialog.vue";
export { default as JoinRoomDialog } from "./rooms/JoinRoomDialog.vue";
export { default as CreateDmDialog } from "./rooms/CreateDmDialog.vue";
export { default as InviteDialog } from "./rooms/InviteDialog.vue";
export { default as LeaveConfirmDialog } from "./rooms/LeaveConfirmDialog.vue";
export { MediaKey, useMediaResolver, type MediaResolver } from "./media.ts";
export { MediaDownloadKey, useMediaDownloadResolver, type MediaDownloadResolver } from "./media.ts";
