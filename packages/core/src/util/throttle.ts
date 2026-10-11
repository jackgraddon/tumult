/**
 * Collapse a burst of `schedule()` calls into at most one `run()` per interval.
 *
 * A trailing throttle: the first `schedule()` arms a one-shot timer; every
 * `schedule()` while it is pending is dropped; when it fires, `run()` executes
 * and the next `schedule()` arms a fresh timer. A steady stream therefore runs
 * roughly once per interval, and an isolated call runs after one interval.
 *
 * Used for the first-sync room flood, where the SDK emits one `ClientEvent.Room`
 * per room long before the terminal `ClientEvent.Sync`: a microtask coalescer
 * would still recompute once per room, while this paints the room list smoothly.
 */
export class ThrottledTask {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly run: () => void;
    private readonly intervalMs: number;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(run: () => void, intervalMs: number) {
        this.run = run;
        this.intervalMs = intervalMs;
    }

    /** Whether a run is pending (diagnostics/tests). */
    public get pending(): boolean {
        return this.timer !== null;
    }

    /** Request a run; ignored while one is already pending. */
    public schedule(): void {
        if (this.timer !== null) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.run();
        }, this.intervalMs);
    }

    /** Drop a pending run without executing it. */
    public clear(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
