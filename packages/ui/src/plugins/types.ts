/**
 * The plugin contract: what a plugin IS, and what its context exposes.
 *
 * Plugins are plain TypeScript modules registered at runtime by the app —
 * never evaluated from strings, never fetched from the network. Nothing in
 * this API can run `eval`/`new Function` or load a remote script, so plugins
 * are CSP-safe by construction.
 *
 * Isolation is by API surface: a plugin only touches the shell through its
 * `PluginContext`, which carries no `window`/`document` handles. Plugins are
 * app-authored code (Vencord-style capability, first-party trust level) — this
 * is an extension seam, not a security boundary against hostile code.
 */

import type { ChatClient, EncryptedAttachment } from "@tumult/core";

import type { RendererEntry, TimelineRegistry } from "../timeline/registry.ts";
import type { ComposerActionsRegistry, ComposerAction } from "../timeline/composer-actions.ts";
import type { CommandsRegistry, Command } from "../timeline/commands.ts";
import type { MemberDecorationsRegistry, MemberDecoration } from "../members/decorations.ts";
import type { SelectionContext } from "../selection.ts";
import type { ActionsContext } from "../actions.ts";

/** Undoes one registration. Idempotent — calling it twice is a no-op. */
export type Disposable = () => void;

/**
 * Capabilities a plugin may declare in its manifest. Each extension API in
 * `PluginContext` names the permission it requires; the registry refuses the
 * call (and rolls back the install) when the manifest did not declare it.
 *
 * `timeline-renderers`, `composer-actions`, `commands` and
 * `member-decorations` are enforced today. `settings-tabs` and `styles` name
 * the remaining Phase 2 extension points as they land.
 */
export type Permission =
    | "timeline-renderers"
    | "composer-actions"
    | "member-decorations"
    | "commands"
    | "settings-tabs"
    | "styles";

/** What a plugin declares about itself. Purely descriptive (discovery UI). */
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
    /** Minimum `@tumult/core` contract version the plugin understands. */
    minCore?: string;
    /** Minimum `@tumult/ui` version the plugin understands. */
    minUI?: string;
    /** Every extension API the plugin uses. The context enforces these. */
    permissions: Permission[];
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
 * disposable. Future extension points (settings tabs, styles) extend this
 * interface; existing plugins keep working because it only grows.
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
    selection: SelectionContext;
    actions: ActionsContext;
    media: PluginMedia;
}
