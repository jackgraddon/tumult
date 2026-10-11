import type { Subscribable, Subscription } from "./contract.ts";

/**
 * Lifecycle hooks for ref-counted consumers. `TimelineFeed` uses them to keep
 * an idle room's snapshot only while something is watching it (and to refresh
 * the snapshot the moment a watcher arrives, since an unsubscribed feed may
 * have skipped rebuilds).
 */
export interface ObservableHooks {
    onFirstSubscribe?: () => void;
    onLastUnsubscribe?: () => void;
}

/**
 * The write side of a {@link Subscribable}.
 *
 * Deliberately snapshot-oriented: `set` replaces the value wholesale rather than
 * exposing a mutable object. The SDK mutates `Room` and `MatrixEvent` in place,
 * so core recomputes a fresh snapshot on every invalidation signal and pushes it
 * through here. Downstream code can then rely on identity changes meaning
 * "something actually changed".
 */
export class Observable<T> implements Subscribable<T> {
    private listeners = new Set<(value: T) => void>();
    private value: T;
    private readonly hooks: ObservableHooks | undefined;

    // No parameter properties: Node's type-stripping (used by node --test)
    // only supports erasable syntax.
    public constructor(value: T, hooks?: ObservableHooks) {
        this.value = value;
        this.hooks = hooks;
    }

    public get(): T {
        return this.value;
    }

    public set(next: T): void {
        if (Object.is(next, this.value)) return;
        this.value = next;
        this.emit();
    }

    /** Recompute from the current value. Always emits, even if the result is identical. */
    public update(fn: (current: T) => T): void {
        this.value = fn(this.value);
        this.emit();
    }

    public subscribe(listener: (value: T) => void): Subscription {
        const wasEmpty = this.listeners.size === 0;
        this.listeners.add(listener);
        if (wasEmpty) this.hooks?.onFirstSubscribe?.();
        return {
            unsubscribe: () => {
                const removed = this.listeners.delete(listener);
                if (removed && this.listeners.size === 0) this.hooks?.onLastUnsubscribe?.();
            },
        };
    }

    public get subscriberCount(): number {
        return this.listeners.size;
    }

    private emit(): void {
        // Copy first: a listener may unsubscribe (or subscribe) during dispatch.
        for (const listener of [...this.listeners]) {
            try {
                listener(this.value);
            } catch (error) {
                // One bad subscriber must not stop the rest from seeing the update.
                console.error("[tumult] subscriber threw", error);
            }
        }
    }
}
