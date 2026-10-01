import { inject, type Component, type InjectionKey } from "vue";
import type { MessageView } from "@tumult/core";

export interface TimelineRendererProps {
    message: MessageView;
}

export interface RendererEntry {
    component: Component;
    /** Higher wins. Entries without `match` sort last within their bucket. */
    priority: number;
    match?: (message: MessageView) => boolean;
}

/**
 * Owned per-shell via provide/inject — never a module singleton, so two
 * shells on one page cannot share mutable registration state.
 */
export class TimelineRegistry {
    private readonly buckets = new Map<string, RendererEntry[]>();

    public register(type: string, entry: RendererEntry): void {
        const list = this.buckets.get(type) ?? [];
        list.push(entry);
        list.sort((a, b) => b.priority - a.priority || (a.match ? 0 : 1) - (b.match ? 0 : 1));
        this.buckets.set(type, list);
    }

    public resolve(message: MessageView, fallback: Component): Component {
        const list = this.buckets.get(message.type);
        if (!list) return fallback;
        for (const entry of list) {
            if (!entry.match || entry.match(message)) return entry.component;
        }
        return fallback;
    }
}

export const RegistryKey: InjectionKey<TimelineRegistry> = Symbol("tumult/timeline-registry");

export function useTimelineRegistry(): TimelineRegistry {
    const registry = inject(RegistryKey);
    if (!registry) throw new Error("useTimelineRegistry() requires TumultShell (or TimelinePane) above it.");
    return registry;
}
