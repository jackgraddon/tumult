/**
 * The plugin contract: what a plugin IS, and what its context exposes.
 *
 * Plugins are plain TypeScript modules registered at runtime by the app: a
 * manifest plus `install(ctx)`. Built-in plugins are compiled into the app;
 * third-party plugins are downloaded as release artifacts, verified against
 * the manifest's `integrity` hash and handed over by the app's installer
 * (docs/plugins.md §11). Nothing in THIS module fetches, evaluates or loads a
 * script — the registry only ever receives a `Plugin` object — so everything
 * here stays CSP-safe by construction.
 *
 * Isolation is two-fold: by API surface (a plugin only touches the shell
 * through `PluginContext`, which carries no `window`/`document` handles) and
 * by lane (`deriveLane` in lane.ts) — logic-only plugins are loaded into a
 * Worker, while a plugin that contributes Vue components runs in-page at the
 * app's trust level, which the installer says out loud before it installs.
 * Neither is a guarantee against hostile code beyond what the lane promises:
 * the in-page lane is an extension seam, not a sandbox.
 */

import type { ChatClient, EncryptedAttachment } from "@tumult/core";

import type { RendererEntry, TimelineRegistry } from "../timeline/registry.ts";
import type { ComposerActionsRegistry, ComposerAction } from "../timeline/composer-actions.ts";
import type { CommandsRegistry, Command } from "../timeline/commands.ts";
import type { MemberDecorationsRegistry, MemberDecoration } from "../members/decorations.ts";
import type { ActivityRenderersRegistry, ActivityRenderer } from "../members/activity.ts";
import type { SettingsTabsRegistry, SettingsTab } from "../settings/tabs.ts";
import type { WorkspacePanesRegistry, WorkspacePane } from "../panes/registry.ts";
import type { SelectionContext } from "../selection.ts";
import type { ActionsContext } from "../actions.ts";

/** Undoes one registration. Idempotent — calling it twice is a no-op. */
export type Disposable = () => void;

/**
 * Capabilities a plugin may declare in its manifest. Each extension API in
 * `PluginContext` names the permission it requires; the registry refuses the
 * call (and rolls back the install) when the manifest did not declare it.
 *
 * All nine are enforced: the eight in-page ones (the component permissions
 * `timeline-renderers`, `member-decorations`, `activity-renderers`,
 * `settings-tabs`, `workspace-panes` plus the data-in/capability-out
 * `composer-actions`, `commands`, `styles`) and `native-activity` — the one
 * non-component permission that still forces the trusted lane, because the
 * native feed lives on the preload's bridge and a sandboxed worker cannot
 * reach it (see `native-activity.ts`).
 *
 * This array is the single runtime source: the `Permission` union is derived
 * from it, the release schema's enum is built from it, and the installer
 * refuses a manifest that names anything outside it. Adding a permission
 * means adding it here first.
 */
export const PLUGIN_PERMISSIONS = [
    "timeline-renderers",
    "composer-actions",
    "member-decorations",
    "activity-renderers",
    "commands",
    "settings-tabs",
    "styles",
    "workspace-panes",
    "native-activity",
] as const;

export type Permission = (typeof PLUGIN_PERMISSIONS)[number];

/**
 * What a plugin declares about itself. Purely descriptive for built-in
 * plugins; for a third-party plugin the same object is the release document
 * (`tumult.plugin.json`) the installer validates and asks consent for.
 */
export interface PluginManifest {
    /**
     * Stable, namespaced id — e.g. `cc.jackg.tumult.demo-poll`. The registry
     * keys installs by it; two installs of one id are refused.
     */
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    /**
     * Minimum `@tumult/core` contract version (`CONTRACT_VERSION`) the plugin
     * understands. Enforced at install: a newer requirement refuses the
     * install with the shortfall named.
     */
    minCore?: string;
    /**
     * Minimum `@tumult/ui` plugin-API version (`PLUGIN_API_VERSION`) the
     * plugin understands. Enforced at install, same as `minCore`.
     */
    minUI?: string;
    /** Every extension API the plugin uses. The context enforces these. */
    permissions: Permission[];
    /**
     * Release artifact only (`tumult.plugin.json` in a plugin repository):
     * the filename of the built bundle attached to every release, e.g.
     * `plugin.js`. Absent for plugins compiled into the app; the installer
     * refuses a release manifest without it.
     */
    entry?: string;
    /**
     * Release artifact only: `sha256-<base64>` of the entry bundle, computed
     * by the template's release workflow from the same file it attaches. The
     * installer refuses a download that does not hash to this value and
     * re-checks the stored copy on every boot — what runs is what was hashed.
     * (Not required by the schema, because the file committed in the plugin
     * repo has no hash yet; the installer requires it.)
     */
    integrity?: string;
}

/** Media resolution, passed through from the shell's client. */
export interface PluginMedia {
    /** `mxc://` URI → loadable URL at `size` CSS px (thumbnail, 2x fetch). */
    resolve(uri: string, size: number): Promise<string>;
    /** `mxc://` URI → full (unresized) media as a loadable URL. */
    resolveDownload(uri: string): Promise<string>;
    /** Encrypted attachment descriptor → loadable URL (fetches + decrypts). */
    resolveEncrypted(file: EncryptedAttachment): Promise<string>;
}

/**
 * One native/RPC activity: what a desktop app pushes into Tumult. It mirrors a
 * rich-presence activity document on the wire (no `source`/`assets`
 * discriminator — producers coordinate client-side, the same way a manual
 * `/activity` and a native one do), so the host stays producer-agnostic and a
 * desktop-only capability can degrade to "nothing to show" on the web. Field
 * caps are enforced by the producer before it reaches here.
 */
export interface NativeActivity {
    /** What the app is doing — the rich-presence vocabulary. */
    readonly type: "playing" | "listening" | "watching" | "custom";
    /** The headline, e.g. "Visual Studio Code", "VLC", "Spotify". */
    readonly name: string;
    /** A second line of context, e.g. a file or track name. */
    readonly details?: string;
    /** A third line, e.g. a progress or current state. */
    readonly state?: string;
    /** Epoch milliseconds the activity started, when the caller knows it. */
    readonly startedAt?: number;
    /** A short emoji to show by the headline. */
    readonly emoji?: string;
}

/**
 * The native activity feed — the in-app view of what native apps (and, later,
 * a passive detection source) are doing. A browser tab cannot observe the
 * operating system, so on the web this is always empty: a consumer degrades to
 * the plain status line. On desktop the shell bridges a native
 * `window.tumultNative` (the one declared exception to the bridge-less shell)
 * into a live feed; see `native-activity.ts`.
 *
 * The feed is shell-owned and shared across plugins: a plugin that consumes it
 * subscribes through this method (which demands `native-activity`), and the
 * returned disposable is run on uninstall — but it is NOT registry-tracked,
 * because the feed outlives any single install.
 */
export interface NativeActivityFeed {
    /** The current native activity, or null when nothing is active. */
    readonly current: () => NativeActivity | null;
    /**
     * Subscribe to changes. `callback` fires on every change — a new activity,
     * an update, or a clear (null) — and is delivered the current value at
     * subscription time, so a consumer that starts after an activity is already
     * set still sees it. Returns a disposable run on unsubscription or on feed
     * teardown.
     */
    readonly subscribe: (callback: (activity: NativeActivity | null) => void) => Disposable;
}

/**
 * The registration surface every plugin gets — permission-checked and
 * disposable. New extension points append methods; existing plugins keep
 * working because it only grows.
 */
export interface PluginApi {
    /**
     * Register a timeline renderer for one Matrix event type (or several,
     * via one call per type). Returns a disposable that unregisters exactly
     * this entry.
     */
    addRenderer(type: string, entry: RendererEntry): Disposable;
    /**
     * Add a button to the composer's action row. The action only runs when a
     * room and client are present (never in the thread composer today).
     */
    addComposerAction(action: ComposerAction): Disposable;
    /** Register a `/name` slash command for the composer. */
    addCommand(command: Command): Disposable;
    /** Add a badge/decoration to member rows that `match` accepts. */
    addMemberDecoration(decoration: MemberDecoration): Disposable;
    /**
     * Render a user's activity from one extended-profile field, in place of
     * their status line (member rows and the user bar). The highest-priority
     * renderer whose `match` accepts the field's value wins.
     */
    addActivityRenderer(renderer: ActivityRenderer): Disposable;
    /** Add a tab to the settings dialog. */
    addSettingsTab(tab: SettingsTab): Disposable;
    /**
     * Add a workspace pane — a top-level region of the shell, opened from a
     * tile in the guild rail. The pane fills three slots (left nav, content,
     * bottom bar); the shell keeps its own layout around them.
     */
    addPane(pane: WorkspacePane): Disposable;
    /**
     * Append a `<style>` element to the document. The CSS applies app-wide
     * (there is no shadow root to scope into) and must be self-contained:
     * `@import` and any `url()` other than `data:`, `blob:` or a `#fragment`
     * throw instead of landing.
     */
    injectStylesheet(css: string): Disposable;
    /**
     * The native activity feed — what a desktop app is doing, pushed through
     * the preload's bridge (`window.tumultNative`). Demands `native-activity`;
     * on the web the feed is always empty. The returned feed is shell-owned,
     * so its subscribers are not tracked by the registry; a plugin tears its
     * own subscription down through the disposable `subscribe` returns.
     */
    nativeActivity(): NativeActivityFeed;
}

/**
 * Everything one plugin can touch during `install()`.
 *
 * Read/write surface on the shell is explicit: data flows through `client`
 * (the `ChatClient` contract — snapshots + subscriptions), navigation through
 * `selection`, cross-pane dialogs through `actions`, and `mxc://` resolution
 * through `media`.
 */
export interface PluginContext extends PluginApi {
    /** This plugin's own manifest (id, name, declared permissions). */
    readonly manifest: PluginManifest;
    /** The chat client — the same contract the UI itself uses. */
    readonly client: ChatClient;
    /** Current room/guild selection and navigation. */
    readonly selection: SelectionContext;
    /** Cross-pane dialog channel (leave, moderation). */
    readonly actions: ActionsContext;
    /** `mxc://` resolvers wired to the client's authenticated media. */
    readonly media: PluginMedia;
}

/**
 * Lifecycle: `install` runs once per install; its returned disposable (and
 * every disposable handed back by the context APIs) is run on uninstall, then
 * `uninstall` (when present) for anything the plugin set up beyond the
 * context — timers, listeners it acquired elsewhere. Installing after a
 * successful uninstall is allowed.
 */
export interface Plugin {
    readonly manifest: PluginManifest;
    install(ctx: PluginContext): void | Disposable;
    uninstall?(): void;
}

/** What the registry is constructed with: the shell's own per-shell objects. */
export interface PluginDeps {
    client: ChatClient;
    timeline: TimelineRegistry;
    composerActions: ComposerActionsRegistry;
    commands: CommandsRegistry;
    memberDecorations: MemberDecorationsRegistry;
    activityRenderers: ActivityRenderersRegistry;
    settingsTabs: SettingsTabsRegistry;
    panes: WorkspacePanesRegistry;
    selection: SelectionContext;
    actions: ActionsContext;
    media: PluginMedia;
    /**
     * The shell's native activity feed. On the web this is the empty feed
     * (`native-activity.ts`); on desktop the shell builds a live one from the
     * preload's `window.tumultNative` bridge. The registry hands it to a plugin
     * through `ctx.nativeActivity()`; it is not a registry the registry owns.
     */
    nativeActivity: NativeActivityFeed;
    /**
     * Shell-provided stylesheet injection (see `plugins/styles.ts`). The
     * registry passes the plugin's manifest id as the owner.
     */
    injectStylesheet(css: string, owner: string): Disposable;
}
