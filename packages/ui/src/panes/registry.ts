import { inject, type Component, type InjectionKey } from "vue";

import { ContributionList } from "../plugins/contributions.ts";
import type { Disposable } from "../plugins/types.ts";

/**
 * One workspace pane — a top-level region of the shell that a plugin fills.
 *
 * A pane is what the guild rail's *other* kind of tile opens: the DMs button
 * and the guild tiles open rooms, a pane tile opens the plugin's own region.
 * The shell keeps its layout (the rail, the tracks, the chrome) and hands the
 * pane three slots to fill; the plugin never replaces a region, it occupies
 * the one it was given.
 */
export interface WorkspacePane {
    /** Stable, namespaced id — the registry keys by it, and the route uses it. */
    id: string;
    /** Label in the rail tile's tooltip and its accessible name. */
    label: string;
    /** Glyph rendered in the rail tile. Defaults to the label's first letter. */
    icon?: string;
    /** Higher sorts nearer the top of the rail. Default 0. */
    priority?: number;
    /** The main area — the track the timeline normally occupies. */
    content: Component;
    /** The left nav — the track the channel list normally occupies. */
    sidebar?: Component;
    /** The bottom bar, spanning the pane's width — the player. */
    footer?: Component;
}

/**
 * Per-shell workspace-pane registry (provide/inject — never a module
 * singleton, same rule as `SettingsTabsRegistry`).
 */
export class WorkspacePanesRegistry {
    private readonly list = new ContributionList<WorkspacePane>(
        (pane) => pane.id,
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    public add(pane: WorkspacePane): Disposable {
        return this.list.add(pane);
    }

    public remove(id: string): boolean {
        return this.list.remove(id);
    }

    /** The pane registered under `id`, or undefined. */
    public get(id: string): WorkspacePane | undefined {
        return this.list.get(id);
    }

    /** Highest priority first. */
    public all(): WorkspacePane[] {
        return this.list.all();
    }
}

export const WorkspacePanesKey: InjectionKey<WorkspacePanesRegistry> = Symbol("tumult/workspace-panes");

export function useWorkspacePanes(): WorkspacePanesRegistry {
    const registry = inject(WorkspacePanesKey);
    if (!registry) throw new Error("useWorkspacePanes() requires TumultShell above it.");
    return registry;
}
