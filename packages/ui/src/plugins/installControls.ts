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
     * True when a record for this id already exists and its permissions/hash
     * changed — so the dialog leads with "this asks for something new".
     */
    changed: boolean;
    /** Permissions the pending manifest gains over the stored record. */
    added: Permission[];
    /** The installed version being replaced, or `null` for a fresh install. */
    previousVersion: string | null;
}

/** The result of a completed install, for the dialog to close on. */
export interface InstallOutcome {
    ok: boolean;
    /** User-facing message when `ok` is false. */
    error: string | null;
}

/**
 * What the Plugins tab and the consent dialog are handed. The controller owns
 * the network, the store and the registry; the UI only calls these.
 */
export interface PluginInstallControls {
    /** Reactive list of installed plugins, re-read on every mutation. */
    readonly installed: Ref<InstalledPluginView[]>;
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
