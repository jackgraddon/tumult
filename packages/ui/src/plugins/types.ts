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
import type { SettingsTabsRegistry, SettingsTab } from "../settings/tabs.ts";
import type { SelectionContext } from "../selection.ts";
import type { ActionsContext } from "../actions.ts";

/** Undoes one registration. Idempotent — calling it twice is a no-op. */
export type Disposable = () => void;

/**
 * Capabilities a plugin may declare in its manifest. Each extension API in
 * `PluginContext` names the permission it requires; the registry refuses the
 * call (and rolls back the install) when the manifest did not declare it.
 *
 * All six are enforced: `timeline-renderers`, `composer-actions`, `commands`,
 * `member-decorations`, `settings-tabs` and `styles`.
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
    "commands",
    "settings-tabs",
    "styles",
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
    /** Add a tab to the settings dialog. */
    addSettingsTab(tab: SettingsTab): Disposable;
    /**
     * Append a `<style>` element to the document. The CSS applies app-wide
     * (there is no shadow root to scope into) and must be self-contained:
     * `@import` and any `url()` other than `data:`, `blob:` or a `#fragment`
     * throw instead of landing.
     */
    injectStylesheet(css: string): Disposable;
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
    settingsTabs: SettingsTabsRegistry;
    selection: SelectionContext;
    actions: ActionsContext;
    media: PluginMedia;
    /**
     * Shell-provided stylesheet injection (see `plugins/styles.ts`). The
     * registry passes the plugin's manifest id as the owner.
     */
    injectStylesheet(css: string, owner: string): Disposable;
}
