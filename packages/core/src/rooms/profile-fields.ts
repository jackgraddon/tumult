import { Observable } from "../observable.ts";
import type { Subscribable } from "../contract.ts";

/**
 * Keys the profile endpoint already owns. They have dedicated APIs
 * (`setProfile`) and must never be written through the generic field path.
 */
const RESERVED_KEYS = new Set(["displayname", "avatar_url"]);

/**
 * Validate a custom profile-field key: namespaced (it contains a dot, e.g.
 * `app.tumult.activity`) and not one of the spec's own keys. Throws with the
 * offending key named, so a plugin sees why its write was refused.
 */
export function assertProfileFieldKey(key: string): void {
    if (RESERVED_KEYS.has(key)) {
        throw new Error(`Profile field "${key}" is reserved; use setProfile()`);
    }
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(key)) {
        throw new Error(`Profile field key "${key}" must be namespaced, e.g. "app.example.field"`);
    }
}

/**
 * Result of one read. `undefined` means "could not ask" (no client yet, or a
 * transient failure) — the entry stays stale so the next subscriber retries.
 * `null` is a real answer: unset, or the server has no extended profiles.
 */
export type ProfileFieldRead = (userId: string, key: string) => Promise<unknown>;

interface Entry {
    feed: Observable<unknown>;
    /** When the last real answer landed; 0 = never (or invalidated). */
    fetchedAt: number;
    inflight: boolean;
}

/**
 * Cached, lazily fetched MSC4133 profile fields.
 *
 * Profile fields do not arrive through sync, so every value is one GET. The
 * store therefore fetches only while something is watching a feed (the
 * members pane subscribes only for rows the virtualizer renders), and treats
 * an answer as fresh for `ttlMs`: a field another user changes lands on the
 * next subscription after that window, not live.
 *
 * `feed()` returns the SAME `Subscribable` per (userId, key), like
 * `timeline(roomId)`.
 */
export class ProfileFieldStore {
    private readonly entries = new Map<string, Entry>();
    private readonly read: ProfileFieldRead;
    private readonly ttlMs: number;
    private readonly now: () => number;
    /** Bumped by clear(): a read started before it must not land after it. */
    private generation = 0;

    public constructor(read: ProfileFieldRead, options: { ttlMs: number; now?: () => number }) {
        this.read = read;
        this.ttlMs = options.ttlMs;
        this.now = options.now ?? Date.now;
    }

    public feed(userId: string, key: string): Subscribable<unknown> {
        const id = `${userId}\u0000${key}`;
        let entry = this.entries.get(id);
        if (!entry) {
            const created: Entry = {
                feed: new Observable<unknown>(null, {
                    onFirstSubscribe: () => this.refreshIfStale(userId, key, created),
                }),
                fetchedAt: 0,
                inflight: false,
            };
            this.entries.set(id, created);
            entry = created;
        }
        return entry.feed;
    }

    /** Publish a value we just wrote ourselves, fresh as of now. */
    public publish(userId: string, key: string, value: unknown): void {
        this.feed(userId, key);
        const entry = this.entries.get(`${userId}\u0000${key}`)!;
        entry.fetchedAt = this.now();
        entry.feed.set(value);
    }

    /** Forget everything (stop/logout): feeds publish null, the next watch refetches. */
    public clear(): void {
        this.generation++;
        for (const entry of this.entries.values()) {
            entry.fetchedAt = 0;
            entry.inflight = false;
            entry.feed.set(null);
        }
    }

    private refreshIfStale(userId: string, key: string, entry: Entry): void {
        if (entry.inflight) return;
        if (entry.fetchedAt !== 0 && this.now() - entry.fetchedAt < this.ttlMs) return;
        entry.inflight = true;
        const generation = this.generation;
        void this.read(userId, key).then(
            (value) => {
                if (generation !== this.generation) return;
                entry.inflight = false;
                if (value === undefined) return; // could not ask — stay stale
                entry.fetchedAt = this.now();
                entry.feed.set(value);
            },
            (error: unknown) => {
                if (generation !== this.generation) return;
                entry.inflight = false;
                console.error("[tumult] profile field read failed", error);
            },
        );
    }
}
