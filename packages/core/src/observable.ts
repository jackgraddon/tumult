import type { Subscribable, Subscription } from "./contract.ts";

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

    public constructor(private value: T) {}

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
        this.listeners.add(listener);
        return {
            unsubscribe: () => {
                this.listeners.delete(listener);
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
