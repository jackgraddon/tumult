/**
 * The app's `PluginInstallControls`: GitHub in, registry out, IndexedDB
 * underneath.
 *
 * The pure decisions come from `@tumult/ui` (URL parsing, manifest checks, hash
 * verification, re-consent), the network and blob imports live in
 * `installer.ts`, and the persisted record lives in `store.ts`. This class is
 * the sequencing: prepare → consent → commit → persist, and the boot restore
 * that re-hashes every stored bundle before it runs.
 *
 * It needs the shell's `PluginRegistry`, which does not exist until
 * `TumultShell` has mounted — so the registry is *attached* after mount rather
 * than passed to the constructor. Before it is attached, `restore()` and
 * `confirm()` refuse with a message instead of throwing into a void.
 */

import { shallowRef, type Ref } from "vue";
import {
    hashBundle,
    hashMismatchReason,
    needsConsent,
    parsePluginSource,
    addedPermissions,
    checkReleaseManifest,
    deriveLane,
    type InstallOutcome,
    type InstalledPluginView,
    type PendingInstall,
    type PluginInstallControls,
    type Plugin,
    type SandboxHost,
} from "@tumult/ui";

import {
    InstallError,
    loadPlugin,
    prepareInstall,
    sandboxHost,
    type PreparedInstall,
} from "./installer.ts";
import { deleteInstall, listInstalls, putInstall, setInstallEnabled, type InstallRecord } from "./store.ts";

/**
 * The slice of `PluginRegistry` the controller drives. `defineExpose` in
 * `TumultShell` yields a structural type, not the class instance — and the
 * controller genuinely needs only these three calls, so naming them is both
 * what typechecks and what documents the coupling.
 */
export interface PluginHost {
    has(id: string): boolean;
    install(plugin: Plugin): void;
    uninstall(id: string): boolean;
}

function fail(error: unknown): InstallOutcome {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export class AppPluginInstallController implements PluginInstallControls {
    public readonly installed: Ref<InstalledPluginView[]> = shallowRef<InstalledPluginView[]>([]);
    /**
     * Ids that are third-party as of this instant — see the contract comment.
     * A `shallowRef` holding an immutable `Set`: Vue compares the reference, so
     * every mutation must assign a new Set (never `.add()` in place).
     */
    public readonly thirdPartyIds: Ref<ReadonlySet<string>> = shallowRef<ReadonlySet<string>>(new Set());
    public readonly pending: Ref<PendingInstall | null> = shallowRef<PendingInstall | null>(null);
    public readonly busy: Ref<boolean> = shallowRef(false);

    /** The verified release behind `pending`, kept so `confirm()` need not refetch. */
    private prepared: PreparedInstall | null = null;

    private registry: PluginHost | null = null;

    /** Ids currently loaded in the registry, so a record can show as `active`. */
    private loaded = new Set<string>();

    /**
     * Mark an id as third-party (or not) and republish.
     *
     * `loaded` and `thirdPartyIds` are updated together everywhere a plugin
     * enters or leaves the registry, because they answer different questions at
     * different speeds: `loaded` says "the code is running", `thirdPartyIds`
     * says "the shell did not compile this in". The tab needs the second one to
     * avoid presenting a third-party plugin as a built-in while its record is
     * still being written.
     */
    private setThirdParty(id: string, present: boolean): void {
        const next = new Set(this.thirdPartyIds.value);
        if (present) next.add(id);
        else next.delete(id);
        this.thirdPartyIds.value = next;
    }

    /** Attach the shell's registry once it exists (see the class comment). */
    public attach(registry: PluginHost): void {
        this.registry = registry;
    }

    private requireRegistry(): PluginHost {
        if (!this.registry) {
            throw new InstallError("The shell is still starting up — try again in a moment.");
        }
        return this.registry;
    }

    /**
     * The sandbox host for one plugin id. A sandboxed plugin that dies AFTER a
     * successful `install()` (Worker crash, a throwing `install()`, a bundle
     * that would not import) has already contributed to the registry, so the
     * only honest response is to uninstall it and disable the record — otherwise
     * the Plugins tab would show a working plugin that does nothing.
     */
    private hostFor(id: string, lane: "sandbox" | "trusted"): SandboxHost {
        if (lane !== "sandbox") return sandboxHost;
        return {
            createWorker: sandboxHost.createWorker,
            onFailed: (failedId, error) => {
                console.error(`[tumult] sandboxed plugin "${failedId}" failed`, error);
                this.registry?.uninstall(failedId);
                this.loaded.delete(failedId);
                void setInstallEnabled(id, false).then(() => this.refresh());
            },
        };
    }

    /** Re-read the store and project it for the tab. */
    private async refresh(): Promise<void> {
        const records = await listInstalls();
        this.installed.value = records.map((record) => this.view(record));
        // The store is the other half of the third-party truth: a record whose
        // bundle we refused to load (a hash mismatch, a disabled plugin at boot)
        // never reaches `load()`, so it is absent from the registry — yet it is
        // still an installed third-party plugin and must never render as a
        // built-in. Union it with whatever the registry already registered.
        const next = new Set(this.thirdPartyIds.value);
        for (const record of records) next.add(record.id);
        this.thirdPartyIds.value = next;
    }

    private view(record: InstallRecord): InstalledPluginView {
        const manifest = record.manifest;
        return {
            id: record.id,
            name: manifest.name,
            version: manifest.version,
            author: manifest.author ?? null,
            description: manifest.description ?? null,
            source: record.source,
            sourceUrl: `https://github.com/${record.source}`,
            tag: record.tag,
            lane: record.lane,
            permissions: [...manifest.permissions],
            integrity: record.integrity,
            enabled: record.enabled,
            active: this.loaded.has(record.id),
        };
    }

    public async prepare(input: string): Promise<InstallOutcome> {
        if (this.busy.value) return { ok: false, error: "An install is already in progress." };
        const source = parsePluginSource(input);
        if (!source) {
            return {
                ok: false,
                error:
                    "That does not look like a GitHub repository. Paste a URL like " +
                    "https://github.com/owner/repo, or just owner/repo.",
            };
        }

        this.busy.value = true;
        try {
            const prepared = await prepareInstall(source);
            const previous = (await listInstalls()).find((record) => record.id === prepared.manifest.id) ?? null;
            const summary = previous
                ? {
                      id: previous.id,
                      version: previous.manifest.version,
                      permissions: previous.manifest.permissions,
                      integrity: previous.integrity,
                  }
                : null;

            this.prepared = prepared;
            this.pending.value = {
                manifest: prepared.manifest,
                lane: prepared.lane,
                source: prepared.slug,
                sourceUrl: prepared.url,
                tag: prepared.tag,
                integrity: prepared.integrity,
                changed: summary !== null && needsConsent(prepared.manifest, summary),
                added: summary ? addedPermissions(prepared.manifest, summary) : [],
                previousVersion: previous?.manifest.version ?? null,
            };
            return { ok: true, error: null };
        } catch (error) {
            this.prepared = null;
            this.pending.value = null;
            return fail(error);
        } finally {
            this.busy.value = false;
        }
    }

    public async confirm(): Promise<InstallOutcome> {
        const prepared = this.prepared;
        const pending = this.pending.value;
        if (!prepared || !pending) return { ok: false, error: "Nothing to install." };

        this.busy.value = true;
        try {
            const registry = this.requireRegistry();
            const plugin = await loadPlugin(prepared, {
                expectedId: prepared.manifest.id,
                lane: prepared.lane,
                sandboxHost: this.hostFor(prepared.manifest.id, prepared.lane),
            });

            // Replace any prior install of the same id: uninstall first so the
            // registry's duplicate check does not refuse, and so the record we
            // are about to overwrite is fully torn down.
            if (registry.has(prepared.manifest.id)) registry.uninstall(prepared.manifest.id);

            // Mark it third-party BEFORE registering. `registry.install()` bumps
            // the registry's version, which invalidates the tab's computeds; if
            // the mark came after, a render could observe "registered but not
            // third-party" and draw the row through the built-ins branch (the
            // `Built in` flash this ordering exists to prevent).
            this.setThirdParty(prepared.manifest.id, true);
            registry.install(plugin);
            this.loaded.add(prepared.manifest.id);

            const record: InstallRecord = {
                id: prepared.manifest.id,
                source: prepared.slug,
                tag: prepared.tag,
                manifest: prepared.manifest,
                lane: prepared.lane,
                bundle: prepared.bundle,
                integrity: prepared.integrity,
                enabled: true,
                installedAt: Date.now(),
            };
            await putInstall(record);

            this.prepared = null;
            this.pending.value = null;
            await this.refresh();
            return { ok: true, error: null };
        } catch (error) {
            // A throw here leaves nothing persisted (the record is written
            // last), matching the registry's own rollback.
            return fail(error);
        } finally {
            this.busy.value = false;
        }
    }

    public cancel(): void {
        this.prepared = null;
        this.pending.value = null;
    }

    public async enable(id: string): Promise<InstallOutcome> {
        try {
            const record = (await listInstalls()).find((entry) => entry.id === id);
            if (!record) return { ok: false, error: "That plugin is no longer installed." };
            await this.load(record);
            await setInstallEnabled(id, true);
            await this.refresh();
            return { ok: true, error: null };
        } catch (error) {
            // A stored bundle that no longer matches its hash fails closed:
            // mark it disabled so it is not retried into the same failure.
            await setInstallEnabled(id, false).catch(() => undefined);
            await this.refresh();
            return fail(error);
        }
    }

    public disable(id: string): void {
        // Still third-party: the record survives, so the tab must keep showing
        // it in the installed list (as disabled), never as a built-in. Set
        // before the uninstall, which bumps the registry version.
        this.setThirdParty(id, true);
        this.registry?.uninstall(id);
        this.loaded.delete(id);
        void setInstallEnabled(id, false).then(() => this.refresh());
    }

    public remove(id: string): void {
        this.setThirdParty(id, false);
        this.registry?.uninstall(id);
        this.loaded.delete(id);
        void deleteInstall(id).then(() => this.refresh());
    }

    public async restore(): Promise<InstallOutcome[]> {
        const records = await listInstalls();
        const outcomes: InstallOutcome[] = [];
        for (const record of records) {
            if (!record.enabled) continue;
            try {
                await this.load(record);
            } catch (error) {
                const outcome = fail(error);
                outcomes.push(outcome);
                // Fail closed: a bundle we will not load must not stay enabled.
                await setInstallEnabled(record.id, false).catch(() => undefined);
            }
        }
        await this.refresh();
        return outcomes;
    }

    /**
     * Re-hash the stored bundle and register it.
     *
     * What the re-hash does and does NOT buy (security review G-F1): it catches
     * a corrupted or half-written record — bytes that no longer match their own
     * recorded hash fail closed. It is NOT proof of consent: the hash lives in
     * the same record, so anything that can write the store can write a
     * matching pair. Who can write it is therefore the real boundary:
     *  - a SANDBOXED plugin cannot — its Worker has IndexedDB withdrawn
     *    (sandbox/worker/shim.ts, proven by the smoke test);
     *  - in-page code (a trusted plugin, or an XSS) can, and could persist by
     *    other means too (a service worker, say). That is inherent to running
     *    in-page, which is exactly what the trusted-lane consent warns about.
     */
    private async load(record: InstallRecord): Promise<void> {
        const actual = await hashBundle(new TextEncoder().encode(record.bundle));
        if (actual !== record.integrity) {
            throw new InstallError(
                `"${record.id}" was not loaded: the stored bundle no longer matches the hash you ` +
                    `consented to. ${hashMismatchReason(record.integrity, actual)}`,
            );
        }
        const registry = this.requireRegistry();
        const check = checkReleaseManifest({ ...record.manifest, entry: record.manifest.entry ?? "plugin.js" });
        // The lane is re-derived from the manifest on load too — a hand-edited
        // store cannot move a plugin from the trusted lane into the sandbox one.
        const lane = check.ok ? check.lane : deriveLane(record.manifest);
        if (lane !== record.lane) {
            throw new InstallError(`"${record.id}" declares permissions that do not match its stored lane.`);
        }

        const plugin = await loadPlugin(
            { manifest: record.manifest, bundle: record.bundle },
            {
                expectedId: record.id,
                lane: record.lane,
                sandboxHost: this.hostFor(record.id, record.lane),
            },
        );

        if (registry.has(record.id)) registry.uninstall(record.id);
        // Before the register — see the ordering note in `confirm()`.
        this.setThirdParty(record.id, true);
        registry.install(plugin);
        this.loaded.add(record.id);
    }
}

/** One controller per document (like the theme controller and the client). */
export const pluginInstallController = new AppPluginInstallController();
