/**
 * The composer's "don't lose my half-typed message" cache.
 *
 * A reload otherwise throws away whatever sits in the composer: the draft is a
 * per-component `ref` that resets to `""` when the shell remounts. This module
 * mirrors the two other persisted UI-hint seams — the theme store
 * (`@tumult/theme`'s `runtime.ts`) and the shell room-list cache
 * (`@tumult/core`'s `shellCache.ts`): one versioned `localStorage` key, a
 * storage-agnostic interface so the store is testable without a browser, and
 * readers/writers that never throw and degrade to empty.
 *
 * It is UI polish only, not server truth: the real read position and favourite
 * order come from account data through the sync, so this cache holds just the
 * unsent text. It is NOT account-scoped — a `!room` id is unique and multi-
 * account is a v1 non-goal, so a shared `tumult.drafts` key is fine; a draft is
 * unsent text, not a secret.
 *
 * The write path is frequent (a keystroke at a time), unlike the infrequent
 * theme writes, so a trailing debounce collapses a burst into one localStorage
 * write. The map is authoritative within a session (so re-selecting a room
 * shows its draft instantly); localStorage is only the durable mirror for the
 * next boot.
 */
import { inject, type InjectionKey } from "vue";

/** One key holds the whole draft cache — one read at boot. */
export const DRAFTS_STORAGE_KEY = "tumult.drafts";
/** Storage envelope version; bump when the persisted shape changes. */
export const DRAFTS_STATE_VERSION = 1;
/**
 * Debounce for the localStorage write. Draft text is typed per-keystroke, so a
 * write per keystroke would thrash the store; a trailing collapse means the
 * durable write lands once typing settles. `flush()` bypasses it on unmount.
 */
export const DRAFTS_PERSIST_MS = 500;
/** A draft longer than this isn't worth caching (a paste, an attachment note). */
export const DRAFT_MAX_CHARS = 10_000;
/** Cap on distinct rooms held, so a huge account can't unbounded the cache. */
export const DRAFT_MAX_ROOMS = 100;

/** Minimal storage surface (localStorage-shaped), so the store is testable. */
export interface DraftStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** The envelope persisted to the one key. */
export interface StoredDrafts {
    version: number;
    drafts: Record<string, string>;
}

/**
 * The contract the composer depends on. All reads are synchronous (in-memory);
 * writes are debounced to storage and forced with {@link DraftStore.flush}.
 */
export interface DraftStore {
    /** The restored draft for a room, or `null` when none (or cleared). */
    get(roomId: string): string | null;
    /** Set a room's draft; an empty string clears it. In-memory now, debounced to storage. */
    set(roomId: string, text: string): void;
    /** Drop a room's draft entirely (e.g. on send). */
    delete(roomId: string): void;
    /** Write the in-memory map to storage now (e.g. on unmount or a rapid switch). */
    flush(): void;
    /** Cancel a pending write without persisting it. Contrast {@link flush}; a store the caller is about to abandon. */
    dispose(): void;
}

/**
 * `null` outside a shell: `MessageComposer` is an exported primitive, so a
 * standalone use (the thread composer, which carries no `roomId`) renders a
 * non-persistent draft rather than throwing.
 */
export const DraftsKey: InjectionKey<DraftStore> = Symbol("tumult/drafts");

/** Read the shell's draft store, or `null`. */
export function useDrafts(): DraftStore | null {
    return inject(DraftsKey, null);
}

/**
 * The localStorage-backed store. A `null` storage (SSR / a test without a
 * browser) keeps drafts in memory only — the session still restores, it simply
 * does not survive a reload.
 */
export class LocalStorageDraftStore implements DraftStore {
    private readonly storage: DraftStorage | null;
    private readonly drafts = new Map<string, string>();
    private readonly persistAfterMs: number;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** The JSON last written, so an unchanged re-persist (a load) is a no-op. */
    private lastWritten = "";

    // No parameter property: Node's type-stripping rejects it.
    public constructor(storage: DraftStorage | null, persistAfterMs: number = DRAFTS_PERSIST_MS) {
        this.storage = storage;
        this.persistAfterMs = persistAfterMs;
        this.seed();
    }

    public get(roomId: string): string | null {
        return this.drafts.get(roomId) ?? null;
    }

    public set(roomId: string, text: string): void {
        const capped = text.length > DRAFT_MAX_CHARS ? text.slice(0, DRAFT_MAX_CHARS) : text;
        // An empty draft is not a draft: drop the room so a cleared composer
        // does not resurrect on the next load.
        if (capped.length === 0) {
            this.delete(roomId);
            return;
        }
        // A fresh room that pushes past the cap evicts the oldest-inserted.
        // Re-set on an existing key refreshes it without eviction.
        if (!this.drafts.has(roomId) && this.drafts.size >= DRAFT_MAX_ROOMS) {
            this.evictOldest();
        }
        this.drafts.set(roomId, capped);
        this.schedule();
    }

    public delete(roomId: string): void {
        if (this.drafts.delete(roomId)) this.schedule();
    }

    public flush(): void {
        this.cancelTimer();
        this.write();
    }

    public dispose(): void {
        this.cancelTimer();
    }

    private schedule(): void {
        if (this.storage === null) return;
        this.cancelTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            this.write();
        }, this.persistAfterMs);
    }

    private cancelTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private evictOldest(): void {
        // `Map` preserves insertion order, so the first key is the least recent.
        const oldest = this.drafts.keys().next().value;
        if (oldest !== undefined) this.drafts.delete(oldest);
    }

    /**
     * Seed the in-memory map from storage. Never throws and trusts nothing: a
     * missing, malformed, or wrong-version entry degrades to an empty cache.
     * Records the serialized envelope as `lastWritten` so the load-time persist
     * the composer fires for is recognized as a no-op (it writes back identical
     * bytes).
     */
    private seed(): void {
        if (this.storage === null) {
            this.lastWritten = JSON.stringify({ version: DRAFTS_STATE_VERSION, drafts: {} });
            return;
        }
        let raw: string | null = null;
        try {
            raw = this.storage.getItem(DRAFTS_STORAGE_KEY);
        } catch {
            raw = null;
        }
        if (raw === null || raw.trim() === "") return;

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        if (!isRecord(parsed) || parsed["version"] !== DRAFTS_STATE_VERSION) return;
        if (!isRecord(parsed["drafts"])) return;
        for (const [roomId, value] of Object.entries(parsed["drafts"])) {
            if (typeof value === "string") this.drafts.set(roomId, value);
        }
        this.lastWritten = this.serialize();
    }

    /**
     * Persist the map. Best-effort: a full or unavailable store must not break
     * typing — the in-memory map still serves this session, so the failure is
     * swallowed (the write just never lands).
     */
    private write(): void {
        if (this.storage === null) return;
        const serialized = this.serialize();
        // A load re-persists identical bytes; skip the write. This is the
        // signature gate: structure-churn (a re-persist of the same map)
        // forces no storage traffic.
        if (serialized === this.lastWritten) return;
        try {
            this.storage.setItem(DRAFTS_STORAGE_KEY, serialized);
            this.lastWritten = serialized;
        } catch {
            // Keep the in-memory draft; the durable mirror is the hint, the
            // map is the truth for this session.
        }
    }

    private serialize(): string {
        return JSON.stringify({
            version: DRAFTS_STATE_VERSION,
            drafts: Object.fromEntries(this.drafts),
        });
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The shell's draft store: localStorage when present, in-memory-only otherwise
 * (SSR / tests). One per shell — the shell provides it via {@link DraftsKey},
 * and the composer injects it.
 */
export function createDraftStore(): DraftStore {
    const storage: DraftStorage | null =
        typeof globalThis !== "undefined" && "localStorage" in globalThis
            ? (globalThis as { localStorage: DraftStorage }).localStorage
            : null;
    return new LocalStorageDraftStore(storage);
}
