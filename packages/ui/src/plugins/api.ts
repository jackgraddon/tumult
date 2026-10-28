/**
 * The permission-checked, disposable-tracking API handed to plugins.
 *
 * Kept apart from the registry so the "safe surface" is one readable file:
 * every method here (a) demands its manifest permission, (b) registers
 * through the shell's own handle, and (c) returns a disposable that the
 * registry tracks — so uninstall cleans up even if the plugin drops it.
 */

import type { Disposable, Permission, PluginApi } from "./types.ts";
import type { RendererEntry } from "../timeline/registry.ts";
import type { ComposerAction } from "../timeline/composer-actions.ts";
import type { Command } from "../timeline/commands.ts";
import type { MemberDecoration } from "../members/decorations.ts";
import type { ActivityRenderer } from "../members/activity.ts";
import type { SettingsTab } from "../settings/tabs.ts";
import type { WorkspacePane } from "../panes/registry.ts";

export interface PluginApiTarget {
    /** Throws when the manifest did not declare `permission`. */
    require(permission: Permission): void;
    /** The shell-level registrations (no check of their own). */
    addRenderer(type: string, entry: RendererEntry): Disposable;
    addComposerAction(action: ComposerAction): Disposable;
    addCommand(command: Command): Disposable;
    addMemberDecoration(decoration: MemberDecoration): Disposable;
    addActivityRenderer(renderer: ActivityRenderer): Disposable;
    addSettingsTab(tab: SettingsTab): Disposable;
    addPane(pane: WorkspacePane): Disposable;
    /** Injects under this plugin's id as the owner (the registry binds it). */
    injectStylesheet(css: string): Disposable;
    /** Record a disposable so uninstall runs it whether or not the plugin kept it. */
    track(dispose: Disposable): Disposable;
}

export function createPluginApi(target: PluginApiTarget): PluginApi {
    return {
        addRenderer(type, entry) {
            target.require("timeline-renderers");
            return target.track(target.addRenderer(type, entry));
        },
        addComposerAction(action) {
            target.require("composer-actions");
            return target.track(target.addComposerAction(action));
        },
        addCommand(command) {
            target.require("commands");
            return target.track(target.addCommand(command));
        },
        addMemberDecoration(decoration) {
            target.require("member-decorations");
            return target.track(target.addMemberDecoration(decoration));
        },
        addActivityRenderer(renderer) {
            target.require("activity-renderers");
            return target.track(target.addActivityRenderer(renderer));
        },
        addSettingsTab(tab) {
            target.require("settings-tabs");
            return target.track(target.addSettingsTab(tab));
        },
        addPane(pane) {
            target.require("workspace-panes");
            return target.track(target.addPane(pane));
        },
        injectStylesheet(css) {
            target.require("styles");
            return target.track(target.injectStylesheet(css));
        },
    };
}
