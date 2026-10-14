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

export interface PluginApiTarget {
    /** Throws when the manifest did not declare `permission`. */
    require(permission: Permission): void;
    /** The shell-level registrations (no check of their own). */
    addRenderer(type: string, entry: RendererEntry): Disposable;
    addComposerAction(action: ComposerAction): Disposable;
    addCommand(command: Command): Disposable;
    addMemberDecoration(decoration: MemberDecoration): Disposable;
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
    };
}
