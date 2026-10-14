import { inject, ref, type Component, type InjectionKey, type Ref } from "vue";
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

    /**
     * Bumped on every `register()`. The `buckets` map itself is a plain Map, not
     * `reactive()`, so Vue has no way to see a mutation inside it — a renderer
     * registered after a message has already rendered (the common case: a plugin
     * registers from `onMounted`, by which time fixture/cached messages have
     * already painted) would otherwise never take effect, because the consuming
     * `computed` has nothing reactive to re-run on. Reading `.value` inside
     * `resolve()`'s caller creates that dependency — the same snapshot-plus-
     * version-counter shape used for SDK-mutated objects elsewhere in this repo.
     */
    public readonly version: Ref<number> = ref(0);

    public register(type: string, entry: RendererEntry): void {
        const list = this.buckets.get(type) ?? [];
        list.push(entry);
        list.sort((a, b) => b.priority - a.priority || (a.match ? 0 : 1) - (b.match ? 0 : 1));
        this.buckets.set(type, list);
        this.version.value++;
    }

    /**
     * Remove exactly this entry (by identity) — the other half of `register`,
     * so plugin disposables can take a registration back. A no-op when the
     * entry is already gone (a disposable run twice must stay harmless).
     * Bumps `version` like `register`, so resolution re-runs.
     */
    public unregister(type: string, entry: RendererEntry): void {
        const list = this.buckets.get(type);
        if (!list) return;
        const next = list.filter((candidate) => candidate !== entry);
        if (next.length === list.length) return;
        if (next.length === 0) this.buckets.delete(type);
        else this.buckets.set(type, next);
        this.version.value++;
    }

    public resolve(message: MessageView, fallback: Component): Component {
        // Touch `version` so callers that resolve inside a `computed` re-run
        // when a renderer registers after the fact.
        void this.version.value;
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
