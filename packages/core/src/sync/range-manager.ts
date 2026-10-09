import type { MatrixClient } from "matrix-js-sdk";

/** Configuration for a single sync range. */
export interface SlidingSyncRangeConfig {
    ranges: [number, number][];
    timeline_limit: number;
    required_state: string[][];
    filters: Record<string, unknown>;
}

/**
 * Manages the lifecycle of SSS ranges to support pagination and eviction.
 */
export class SlidingSyncRangeManager {
    private readonly ranges = new Map<string, SlidingSyncRangeConfig>();
    private readonly lastAccessed = new Map<string, number>();
    private readonly client: MatrixClient;
    private readonly baseConfig: Required<SlidingSyncRangeConfig>;
    /** The upper bound (exclusive) of the currently loaded room window. */
    public readonly currentEnd: number;

    constructor(client: MatrixClient, baseConfig: Required<SlidingSyncRangeConfig>) {
        this.client = client;
        this.baseConfig = baseConfig;
        this.currentEnd = -1;
    }

    /** Get the Map that must be passed to the SlidingSync constructor. */
    public get syncMap(): Map<string, SlidingSyncRangeConfig> {
        return this.ranges;
    }

    /** Adds a new range to the sync window. */
    public addRange(id: string, start: number, end: number): void {
        this.ranges.set(id, {
            ...this.baseConfig,
            ranges: [[start, end]],
        });
        this.lastAccessed.set(id, Date.now());
        this.currentEnd = end;
    }

    /** Marks a range as recently used to prevent eviction. */
    public touch(id: string): void {
        this.lastAccessed.set(id, Date.now());
    }

    /** Removes ranges that haven't been used for a certain time. */
    public evictIdle(thresholdMs: number): void {
        const now = Date.now();
        for (const [id, last] of this.lastAccessed.entries()) {
            if (now - last > thresholdMs) {
                this.ranges.delete(id);
                this.lastAccessed.delete(id);
            }
        }
    }

    /** Returns the next logical range (e.g., if current is 0-499, returns 500-999).
     * Returns null if we've reached a reasonable cap (e.g. 5000).
     */
    public getNextRange(): { id: string; start: number; end: number } | null {
        const size = 500;
        const start = this.currentEnd + 1;
        const end = start + size - 1;

        if (start >= 5000) return null;

        return { id: `range-${start}-${end}`, start, end };
    }

    /** Returns all current range IDs. */
    public getRangeIds(): string[] {
        return Array.from(this.ranges.keys());
    }
}
