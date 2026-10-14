import { inject, type Component, type InjectionKey } from "vue";
import type { ChatClient } from "@tumult/core";

import { ContributionList } from "../plugins/contributions.ts";
import type { Disposable } from "../plugins/types.ts";

/** Props every settings tab receives. */
export interface SettingsTabProps {
    /** The chat client — the same contract the UI itself uses. */
    client: ChatClient;
    /** Close the settings dialog (e.g. from a finished action). */
    close(): void;
}

/**
 * One tab in the settings dialog. The shell contributes its own tabs (the
 * plugin list) and plugins add theirs; everything else is a normal Vue
 * component, so a tab can `inject()` anything the shell provides (media
 * resolvers, the plugin registry) on top of its props.
 */
export interface SettingsTab {
    /** Stable, namespaced id — the registry keys by it. */
    id: string;
    /** Label in the tab strip. */
    title: string;
    component: Component;
    /** Higher sorts earlier (built-in tabs at 0, plugins default after). */
    priority?: number;
}

/**
 * Per-shell settings-tab registry (provide/inject — never a module singleton,
 * same rule as `TimelineRegistry`).
 */
export class SettingsTabsRegistry {
    private readonly list = new ContributionList<SettingsTab>(
        (tab) => tab.id,
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    public add(tab: SettingsTab): Disposable {
        return this.list.add(tab);
    }

    public remove(id: string): boolean {
        return this.list.remove(id);
    }

    /** Highest priority first. */
    public all(): SettingsTab[] {
        return this.list.all();
    }
}

export const SettingsTabsKey: InjectionKey<SettingsTabsRegistry> = Symbol("tumult/settings-tabs");

export function useSettingsTabs(): SettingsTabsRegistry {
    const registry = inject(SettingsTabsKey);
    if (!registry) throw new Error("useSettingsTabs() requires TumultShell above it.");
    return registry;
}
