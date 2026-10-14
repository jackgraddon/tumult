import { ref, type Ref } from "vue";

import type { Disposable } from "./types.ts";

/**
 * A tiny keyed contribution list — the shared machinery behind the
 * composer-action, command and member-decoration registries.
 *
 * Same snapshot-plus-version-counter shape as `TimelineRegistry`: the entries
 * array is a plain array invisible to Vue, so every reader (`all`, `get`, …)
 * touches `version` to register the dependency — a contribution that lands
 * after first paint repaints.
 */
export class ContributionList<T> {
    public readonly version: Ref<number> = ref(0);

    private readonly entries: T[] = [];
    private readonly keyOf: (entry: T) => string;
    private readonly compare: (a: T, b: T) => number;

    /**
     * `keyOf` is the identity — a key names exactly one entry, and a second
     * add under a live key is refused (so a disposer can never remove someone
     * else's contribution). `compare` is the snapshot order.
     */
    public constructor(keyOf: (entry: T) => string, compare: (a: T, b: T) => number) {
        this.keyOf = keyOf;
        this.compare = compare;
    }

    /** Add an entry. Throws on a key collision. Returns its (idempotent) disposer. */
    public add(entry: T): Disposable {
        const key = this.keyOf(entry);
        if (!key) throw new Error("[tumult] a contribution needs a non-empty key");
        if (this.get(key)) {
            throw new Error(`[tumult] a contribution with the key "${key}" is already registered`);
        }
        this.entries.push(entry);
        this.entries.sort(this.compare);
        this.version.value++;

        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            // Remove only OUR entry: if the key was released and re-taken since,
            // a stale disposer must not take the replacement down.
            if (this.get(key) === entry) this.remove(key);
        };
    }

    /** Remove the entry under `key`. Resolves `false` when there is none. */
    public remove(key: string): boolean {
        const index = this.entries.findIndex((entry) => this.keyOf(entry) === key);
        if (index < 0) return false;
        this.entries.splice(index, 1);
        this.version.value++;
        return true;
    }

    /** The entry registered under `key`, or undefined. */
    public get(key: string): T | undefined {
        void this.version.value;
        return this.entries.find((entry) => this.keyOf(entry) === key);
    }

    /** Sorted snapshot (the `compare` order) — safe to keep and iterate. */
    public all(): T[] {
        void this.version.value;
        return [...this.entries];
    }
}
