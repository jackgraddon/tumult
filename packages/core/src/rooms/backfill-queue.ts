/**
 * A bounded work queue for unread-history backfills.
 *
 * Backfilling a room's history to its read position is network- and
 * CPU-heavy: each room paginates up to `BACKFILL_PAGES × BACKFILL_PAGE_SIZE`
 * events, and every returned page is processed by the SDK and handed to the
 * timeline. `UnreadTracker` used to fire one per qualifying room the moment a
 * room list refresh ran, so a first sync with a dozen out-of-window read
 * positions produced a dozen concurrent paginations — a burst of hundreds of
 * events in one frame.
 *
 * This queue runs at most `maxConcurrent` backfills at a time and dedupes by
 * key, so a room is never queued twice and the burst is spread out. It owns no
 * timers and is mode-agnostic; the tracker supplies the work.
 */
export class BackfillQueue {
    private readonly run: (key: string) => Promise<void>;
    private readonly maxConcurrent: number;
    private readonly waiting: string[] = [];
    /** Keys queued or currently running — the dedupe set. */
    private readonly tracked = new Set<string>();
    private active = 0;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(run: (key: string) => Promise<void>, maxConcurrent = 2) {
        this.run = run;
        this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    }

    /** Queue `key` unless it is already queued or running. */
    public enqueue(key: string): void {
        if (this.tracked.has(key)) return;
        this.tracked.add(key);
        this.waiting.push(key);
        this.pump();
    }

    /** Whether `key` is queued or running. */
    public has(key: string): boolean {
        return this.tracked.has(key);
    }

    /**
     * Drop everything not yet started. Running backfills finish on their own —
     * their `finally` still clears the key, and a torn-down client makes the
     * next `paginateEventTimeline` reject harmlessly.
     */
    public clear(): void {
        for (const key of this.waiting) this.tracked.delete(key);
        this.waiting.length = 0;
    }

    private pump(): void {
        while (this.active < this.maxConcurrent && this.waiting.length > 0) {
            const key = this.waiting.shift();
            if (key === undefined) return;
            this.active += 1;
            void this.run(key)
                .catch(() => {
                    // Best-effort: a failed backfill leaves the lower bound.
                })
                .finally(() => {
                    this.active -= 1;
                    this.tracked.delete(key);
                    this.pump();
                });
        }
    }
}
