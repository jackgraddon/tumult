import { inject, ref, type InjectionKey, type Ref } from "vue";

import type { RendererEntry } from "../timeline/registry.ts";
import type { ComposerAction } from "../timeline/composer-actions.ts";
import type { Command } from "../timeline/commands.ts";
import type { MemberDecoration } from "../members/decorations.ts";
import type { ActivityRenderer } from "../members/activity.ts";
import type { SettingsTab } from "../settings/tabs.ts";
import type { WorkspacePane } from "../panes/registry.ts";
import type {
    Disposable,
    Permission,
    Plugin,
    PluginContext,
    PluginDeps,
    PluginManifest,
} from "./types.ts";
import { checkManifestCompatibility } from "./compat.ts";
import { createPluginApi } from "./api.ts";

interface InstalledPlugin {
    plugin: Plugin;
    /** Context disposables (and the install-time teardown) — run on uninstall. */
    disposables: Disposable[];
    teardown: Disposable | null;
}

/** Run disposables best-effort: one plugin's cleanup cannot block the rest. */
function runAll(disposables: readonly Disposable[]): void {
    for (const dispose of disposables) {
        try {
            dispose();
        } catch (error) {
            console.error("[tumult] plugin disposal failed", error);
        }
    }
}

/**
 * Per-shell plugin host — owned via provide/inject (`PluginsKey`), never a
 * module singleton, so two shells on one page cannot share install state
 * (same rule as {@link TimelineRegistry}).
 *
 * Wraps the shell's `TimelineRegistry`: the built-in renderers go through
 * `addRenderer` unpermissioned (that call IS the shell), while plugin calls
 * go through the permission-checked API in `api.ts`.
 */
export class PluginRegistry {
    /**
     * Bumped on every install/uninstall. The `installed` map is a plain Map,
     * invisible to Vue — a consumer reading `.value` inside a `computed` (the
     * same snapshot-plus-version-counter shape as `TimelineRegistry.version`)
     * gets that dependency, so plugins registered after first paint take effect.
     */
    public readonly version: Ref<number> = ref(0);

    private readonly deps: PluginDeps;
    private readonly installed = new Map<string, InstalledPlugin>();

    public constructor(deps: PluginDeps) {
        this.deps = deps;
    }

    /**
     * Register a timeline renderer as the shell itself (no permission — this
     * is how the built-ins are wired). Returns a disposer; a shell never needs
     * it (registrations die with the registry), but plugins' wrappers do.
     */
    public addRenderer(type: string, entry: RendererEntry): Disposable {
        this.deps.timeline.register(type, entry);
        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            this.deps.timeline.unregister(type, entry);
        };
    }

    /** Shell-level composer action (no permission — see {@link addRenderer}). */
    public addComposerAction(action: ComposerAction): Disposable {
        return this.deps.composerActions.add(action);
    }

    /** Shell-level slash command (no permission — see {@link addRenderer}). */
    public addCommand(command: Command): Disposable {
        return this.deps.commands.add(command);
    }

    /** Shell-level member decoration (no permission — see {@link addRenderer}). */
    public addMemberDecoration(decoration: MemberDecoration): Disposable {
        return this.deps.memberDecorations.add(decoration);
    }

    /** Shell-level activity renderer (no permission — see {@link addRenderer}). */
    public addActivityRenderer(renderer: ActivityRenderer): Disposable {
        return this.deps.activityRenderers.add(renderer);
    }

    /** Shell-level settings tab (no permission — see {@link addRenderer}). */
    public addSettingsTab(tab: SettingsTab): Disposable {
        return this.deps.settingsTabs.add(tab);
    }

    /** Shell-level workspace pane (no permission — see {@link addRenderer}). */
    public addPane(pane: WorkspacePane): Disposable {
        return this.deps.panes.add(pane);
    }

    /** Shell-level stylesheet, owned by `"shell"` (no permission — see {@link addRenderer}). */
    public injectStylesheet(css: string): Disposable {
        return this.deps.injectStylesheet(css, "shell");
    }

    /**
     * Install one plugin. Throws when the id is already installed, when the
     * manifest asks for a newer API/contract than this build provides
     * (`minUI`/`minCore`), or when `install()` itself throws — in which case
     * everything the plugin had registered is rolled back, so a failed
     * install leaves no residue.
     */
    public install(plugin: Plugin): void {
        const id = plugin.manifest.id;
        if (this.installed.has(id)) {
            throw new Error(`[tumult] plugin "${id}" is already installed`);
        }
        const incompatible = checkManifestCompatibility(plugin.manifest);
        if (incompatible) {
            throw new Error(`[tumult] plugin "${id}" cannot install: ${incompatible}`);
        }

        const disposables: Disposable[] = [];
        const track = (dispose: Disposable): Disposable => {
            let done = false;
            const wrapped: Disposable = () => {
                if (done) return;
                done = true;
                dispose();
            };
            disposables.push(wrapped);
            return wrapped;
        };
        const require = (permission: Permission): void => {
            if (!plugin.manifest.permissions.includes(permission)) {
                throw new Error(
                    `[tumult] plugin "${id}" tried to use "${permission}" without declaring it in its manifest`,
                );
            }
        };
        const api = createPluginApi({
            require,
            addRenderer: (type, entry) => this.addRenderer(type, entry),
            addComposerAction: (action) => this.addComposerAction(action),
            addCommand: (command) => this.addCommand(command),
            addMemberDecoration: (decoration) => this.addMemberDecoration(decoration),
            addActivityRenderer: (renderer) => this.addActivityRenderer(renderer),
            addSettingsTab: (tab) => this.addSettingsTab(tab),
            addPane: (pane) => this.addPane(pane),
            // The manifest id is the stylesheet's owner, so a failed install
            // and a later uninstall both remove exactly this plugin's styles.
            injectStylesheet: (css) => this.deps.injectStylesheet(css, id),
            track,
        });
        const ctx: PluginContext = {
            manifest: plugin.manifest,
            client: this.deps.client,
            selection: this.deps.selection,
            actions: this.deps.actions,
            media: this.deps.media,
            addRenderer: api.addRenderer,
            addComposerAction: api.addComposerAction,
            addCommand: api.addCommand,
            addMemberDecoration: api.addMemberDecoration,
            addActivityRenderer: api.addActivityRenderer,
            addSettingsTab: api.addSettingsTab,
            addPane: api.addPane,
            injectStylesheet: api.injectStylesheet,
        };

        let teardown: Disposable | null = null;
        try {
            const result = plugin.install(ctx);
            teardown = typeof result === "function" ? result : null;
        } catch (error) {
            runAll(disposables); // roll back the half-installed plugin
            throw error;
        }

        this.installed.set(id, { plugin, disposables, teardown });
        this.version.value++;
    }

    /**
     * Uninstall by id: run the context disposables (unregistering renderers),
     * then the install-time teardown, then `plugin.uninstall()` — each guarded,
     * so one throw never leaves the rest un-cleaned. Resolves `false` when the
     * id was not installed.
     */
    public uninstall(id: string): boolean {
        const entry = this.installed.get(id);
        if (!entry) return false;
        this.installed.delete(id);
        runAll(entry.disposables);
        if (entry.teardown) {
            try {
                entry.teardown();
            } catch (error) {
                console.error(`[tumult] plugin "${id}" teardown failed`, error);
            }
        }
        if (entry.plugin.uninstall) {
            try {
                entry.plugin.uninstall();
            } catch (error) {
                console.error(`[tumult] plugin "${id}" uninstall failed`, error);
            }
        }
        this.version.value++;
        return true;
    }

    /** Uninstall everything (shell teardown). */
    public uninstallAll(): void {
        for (const id of [...this.installed.keys()]) {
            this.uninstall(id);
        }
    }

    public has(id: string): boolean {
        return this.installed.has(id);
    }

    /** Manifests of everything installed, in install order. */
    public list(): PluginManifest[] {
        return [...this.installed.values()].map((entry) => entry.plugin.manifest);
    }
}

export const PluginsKey: InjectionKey<PluginRegistry> = Symbol("tumult/plugins");

export function usePluginRegistry(): PluginRegistry {
    const registry = inject(PluginsKey);
    if (!registry) throw new Error("usePluginRegistry() requires TumultShell above it.");
    return registry;
}
