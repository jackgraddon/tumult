import { computed, inject, onScopeDispose, shallowRef, watch, type Component, type ComputedRef, type InjectionKey } from "vue";
import type { ChatClient, Subscription } from "@tumult/core";

import { ContributionList } from "../plugins/contributions.ts";
import type { Disposable } from "../plugins/types.ts";

/**
 * Where an activity is drawn. `row` is a member-list subtitle and MUST stay
 * one line (the members pane is virtualized and estimates row height); `self`
 * is the user bar's status line.
 */
export type ActivityVariant = "row" | "self";

/** Props every activity component receives. */
export interface ActivityProps {
    userId: string;
    /** The profile field's raw value — already accepted by the renderer's `match`. */
    value: unknown;
    variant: ActivityVariant;
}

/**
 * Renders a user's activity from one extended-profile field (MSC4133), in
 * place of their status line. Tumult defines no activity schema of its own:
 * the field's shape belongs to whoever registers the renderer.
 */
export interface ActivityRenderer {
    /** Stable, namespaced id — the registry keys by it. */
    id: string;
    /** The profile field to read, e.g. `app.tumult.activity`. */
    key: string;
    component: Component;
    /** Highest wins when several renderers accept a user. Default 0. */
    priority?: number;
    /** Accept a non-null value. Default: any non-null value. Keep it cheap. */
    match?(value: unknown): boolean;
}

/** The renderer that won for one user, and the value it renders. */
export interface ResolvedActivity {
    renderer: ActivityRenderer;
    value: unknown;
}

/**
 * Per-shell activity-renderer registry (provide/inject — never a module
 * singleton). Holds the shell's client so a consumer only needs a user id.
 */
export class ActivityRenderersRegistry {
    public readonly client: ChatClient;
    private readonly list = new ContributionList<ActivityRenderer>(
        (renderer) => renderer.id,
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    public constructor(client: ChatClient) {
        this.client = client;
    }

    public add(renderer: ActivityRenderer): Disposable {
        return this.list.add(renderer);
    }

    public remove(id: string): boolean {
        return this.list.remove(id);
    }

    /** Every renderer, highest priority first (reactive). */
    public all(): ActivityRenderer[] {
        return this.list.all();
    }

    /**
     * The winning renderer for a set of field values: the highest-priority
     * one whose field is non-null and whose `match` accepts it. A throwing
     * `match` counts as a refusal — one bad plugin must not blank the row.
     */
    public resolve(values: ReadonlyMap<string, unknown>): ResolvedActivity | null {
        for (const renderer of this.all()) {
            const value = values.get(renderer.key);
            if (value === null || value === undefined) continue;
            try {
                if (renderer.match && !renderer.match(value)) continue;
            } catch (error) {
                console.error(`[tumult] activity renderer "${renderer.id}" match threw`, error);
                continue;
            }
            return { renderer, value };
        }
        return null;
    }
}

export const ActivityRenderersKey: InjectionKey<ActivityRenderersRegistry> = Symbol("tumult/activity-renderers");

export function useActivityRenderers(): ActivityRenderersRegistry {
    const registry = inject(ActivityRenderersKey);
    if (!registry) throw new Error("useActivityRenderers() requires TumultShell above it.");
    return registry;
}

/**
 * The activity to draw for `userId`, or null (then the caller shows its
 * ordinary status line). Watches only the fields some renderer asks for, so a
 * shell with no activity plugin subscribes to nothing and fetches nothing.
 * The members pane mounts rows only for what the virtualizer renders, so
 * fields are fetched for visible members only.
 */
export function useActivity(userId: () => string): ComputedRef<ResolvedActivity | null> {
    const registry = useActivityRenderers();
    const values = shallowRef<ReadonlyMap<string, unknown>>(new Map());
    let subscriptions: Subscription[] = [];

    const release = (): void => {
        for (const subscription of subscriptions) subscription.unsubscribe();
        subscriptions = [];
    };

    watch(
        () => [userId(), [...new Set(registry.all().map((renderer) => renderer.key))].sort().join("\u0000")] as const,
        ([user, joined]) => {
            release();
            // No user yet (signed out) means nothing to read.
            const keys = user && joined ? joined.split("\u0000") : [];
            const next = new Map<string, unknown>();
            for (const key of keys) {
                const feed = registry.client.profileField(user, key);
                next.set(key, feed.get());
                subscriptions.push(
                    feed.subscribe((value) => {
                        const copy = new Map(values.value);
                        copy.set(key, value);
                        values.value = copy;
                    }),
                );
            }
            values.value = next;
        },
        { immediate: true },
    );
    onScopeDispose(release);

    return computed(() => registry.resolve(values.value));
}
