/**
 * The plugin-install seam between the app and the UI.
 *
 * `@tumult/ui` renders the Plugins settings tab and the consent dialog, but it
 * must not know how a plugin is fetched, verified or stored — that is app
 * business (GitHub, IndexedDB, blob imports, CSP). So the app implements this
 * interface (see `apps/web/src/plugins/controller.ts`), provides it above the
 * shell, and the tab talks only to it. A host that renders `TumultShell`
 * without providing one simply has no install UI — the extension API itself is
 * unchanged (docs/plugins.md §11, "What the host must allow").
 *
 * The shape mirrors `ThemeControls` on purpose: a reactive snapshot plus
 * imperative calls, so the same component patterns work on both.
 */

import { inject, type InjectionKey, type Ref } from "vue";

import type { PluginLane } from "./lane.ts";
import type { Permission, PluginManifest } from "./types.ts";

/** One installed plugin, as the settings tab lists it. */
export interface InstalledPluginView {
    id: string;
    name: string;
    version: string;
    author: string | null;
    description: string | null;
    /** `owner/repo` the plugin was installed from. */
    source: string;
    /** Browsable repository URL. */
    sourceUrl: string;
    /** Release tag, or `""` when installed from a raw file. */
    tag: string;
    /** Derived by the host at install time, never a claim from the manifest. */
    lane: PluginLane;
    permissions: Permission[];
    /** `sha256-<base64>` the bundle was verified against. */
    integrity: string;
    enabled: boolean;
    /** True when the currently loaded code is this record (i.e. it is running). */
    active: boolean;
}

/**
 * A release resolved and verified, waiting on the consent screen. The dialog
 * renders `manifest` + `lane` + `permissions` and calls `confirm()` or
 * `cancel()`; nothing is downloaded beyond this point until `confirm()`.
 */
export interface PendingInstall {
    manifest: PluginManifest;
    lane: PluginLane;
    /** `owner/repo`. */
    source: string;
    /** Browsable repository URL, for the source link. */
    sourceUrl: string;
    /** The release tag, or `""`. */
    tag: string;
    /** `sha256-<base64>` the bundle already hashed to. */
    integrity: string;
    /**
     * True only when the permission set differs from the installed copy. A
     * version or hash bump still re-opens consent (new bytes are a new thing to
     * accept), but it is NOT a permissions change and must not lead the dialog
     * with "this asks for something different".
     */
    permissionsChanged: boolean;
    /** Permissions the pending manifest gains over the stored record. */
    added: Permission[];
    /** The installed version being replaced, or `null` for a fresh install. */
    previousVersion: string | null;
    /**
     * The repository (`owner/repo`) the installed copy came from, or `null` for
     * a fresh install. When it differs from `source`, a DIFFERENT publisher is
     * taking over this plugin id, and the dialog says so (review finding G-F2).
     */
    previousSource: string | null;
}

/** The result of a completed install, for the dialog to close on. */
export interface InstallOutcome {
    ok: boolean;
    /** User-facing message when `ok` is false. */
    error: string | null;
}

/** A published release newer than the installed one. */
export interface AvailablePluginUpdate {
    /** The version from the release manifest, not the tag. */
    version: string;
    /** The GitHub release tag, for display. */
    tag: string;
}

/**
 * One row of a manual update check. `update` is null both when the check failed
 * and when the installed version is current; `latestVersion` distinguishes the
 * two, so the tab can say "up to date (v1.2.3)" without implying a download.
 */
export interface PluginUpdateCheck extends InstallOutcome {
    id: string;
    latestVersion: string | null;
    latestTag: string | null;
    update: AvailablePluginUpdate | null;
}

/**
 * What the Plugins tab and the consent dialog are handed. The controller owns
 * the network, the store and the registry; the UI only calls these.
 */
export interface PluginInstallControls {
    /** Reactive list of installed plugins, re-read on every mutation. */
    readonly installed: Ref<InstalledPluginView[]>;
    /**
     * Ids that are third-party RIGHT NOW, including one whose install is still
     * completing.
     *
     * `installed` is read back from the store, so it only gains an id after the
     * record is persisted — but the controller registers the plugin in the
     * registry *before* that write (the bundle is hashed and booted first, so a
     * broken one is never stored). For that window the id is registered but
     * absent from `installed`, and anything classifying "registered but not
     * installed" as a built-in renders a third-party plugin as `Built in`,
     * without its lane badge or source. This is the synchronous truth the tab
     * needs to classify a row correctly at every instant.
     */
    readonly thirdPartyIds: Ref<ReadonlySet<string>>;
    /** The install awaiting consent, or `null`. */
    readonly pending: Ref<PendingInstall | null>;
    /** True while a prepare/commit is in flight (the dialog shows "Working…"). */
    readonly busy: Ref<boolean>;

    /**
     * Resolve a pasted repository URL or `owner/repo` down to a verified
     * release and park it on the consent screen. Resolves the outcome: `ok`
     * with nothing more to do when `pending` is now set, or `ok: false` with
     * the reason (bad link, no release, hash mismatch, …).
     */
    prepare(input: string): Promise<InstallOutcome>;

    /** Install the pending release through the registry and persist it. */
    confirm(): Promise<InstallOutcome>;

    /** Discard the pending release without installing it. */
    cancel(): void;

    /**
     * Read each installed plugin's latest GitHub release manifest and report
     * whether a newer version is published. This downloads no bundle, loads no
     * code and changes nothing; an actual update still goes through
     * {@link prepare} and {@link confirm}, including hash verification and
     * consent.
     */
    checkForUpdates(): Promise<PluginUpdateCheck[]>;

    /** Load (or reload) one stored plugin: re-hash, then register. */
    enable(id: string): Promise<InstallOutcome>;
    /** Unregister a plugin but keep its record so re-enabling is offline. */
    disable(id: string): void;
    /** Unregister and drop a plugin entirely. */
    remove(id: string): void;

    /**
     * Re-hash and register every enabled record at boot, dropping any whose
     * stored bundle no longer matches its hash. Failures are reported through
     * the returned list, not thrown — one bad install must not stop the rest.
     */
    restore(): Promise<InstallOutcome[]>;
}

export const PluginInstallKey: InjectionKey<PluginInstallControls> = Symbol("tumult/plugin-install");

/** Throwing accessor, for the tab (which only renders when a controller exists). */
export function usePluginInstall(): PluginInstallControls {
    const controls = inject(PluginInstallKey, null);
    if (!controls) throw new Error("[tumult] no plugin install controller was provided above this component");
    return controls;
}

/** Non-throwing accessor, for the shell to decide whether to offer the tab. */
export function tryUsePluginInstall(): PluginInstallControls | null {
    return inject(PluginInstallKey, null);
}
