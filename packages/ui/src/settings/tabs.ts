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
 * The settings sidebar's groups, in nav order. The shell's account pages sit
 * under `account`, its app-wide pages under `app`; a tab that names no section
 * lands under `plugins`.
 */
export const SETTINGS_SECTIONS = ["account", "app", "plugins"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Sidebar heading per section. */
export const SETTINGS_SECTION_TITLES: Record<SettingsSection, string> = {
    account: "User settings",
    app: "App settings",
    plugins: "Plugins",
};

/** One sidebar group: a section and its tabs, in priority order. */
export interface SettingsGroup {
    section: SettingsSection;
    title: string;
    tabs: SettingsTab[];
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
    /** Label in the sidebar. */
    title: string;
    component: Component;
    /** Sidebar group. Default `"plugins"`. */
    section?: SettingsSection;
    /** Higher sorts earlier within its section. Default 0. */
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

    /** The tab registered under `id`, or undefined. */
    public get(id: string): SettingsTab | undefined {
        return this.list.get(id);
    }

    /**
     * The sidebar: one group per section that has tabs, in `SETTINGS_SECTIONS`
     * order, each in priority order. An empty section is dropped, so a host
     * with no theme controls shows no empty "App settings" heading.
     */
    public grouped(): SettingsGroup[] {
        const all = this.list.all();
        const groups: SettingsGroup[] = [];
        for (const section of SETTINGS_SECTIONS) {
            const tabs = all.filter((tab) => (tab.section ?? "plugins") === section);
            if (tabs.length > 0) groups.push({ section, title: SETTINGS_SECTION_TITLES[section], tabs });
        }
        return groups;
    }
}

export const SettingsTabsKey: InjectionKey<SettingsTabsRegistry> = Symbol("tumult/settings-tabs");

export function useSettingsTabs(): SettingsTabsRegistry {
    const registry = inject(SettingsTabsKey);
    if (!registry) throw new Error("useSettingsTabs() requires TumultShell above it.");
    return registry;
}
