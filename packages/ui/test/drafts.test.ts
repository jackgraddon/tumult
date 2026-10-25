import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    DRAFT_MAX_CHARS,
    DRAFT_MAX_ROOMS,
    DRAFTS_STATE_VERSION,
    DRAFTS_STORAGE_KEY,
    createDraftStore,
    LocalStorageDraftStore,
    type DraftStorage,
} from "../src/timeline/drafts.ts";

/**
 * A localStorage-shaped store backed by a Map, with a write-call counter (to
 * observe the debounce dedupe) and optional fault injection. `setCalls` counts
 * every `setItem` attempt, thrown or not, so a best-effort failure still shows
 * up as "we tried".
 */
class FakeStorage implements DraftStorage {
    private readonly map = new Map<string, string>();
    public setCalls = 0;
    public throwOnWrite = false;

    public getItem(key: string): string | null {
        return this.map.has(key) ? (this.map.get(key) as string) : null;
    }

    public setItem(key: string, value: string): void {
        this.setCalls++;
        if (this.throwOnWrite) throw new Error("quota exceeded");
        this.map.set(key, value);
    }

    public removeItem(key: string): void {
        this.map.delete(key);
    }
}

/** Wait for a pending debounce to fire. Generous so it can't be timing-flaky. */
function tick(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("LocalStorageDraftStore", () => {
    it("reads empty until a room is drafted", () => {
        const store = new LocalStorageDraftStore(new FakeStorage());
        assert.equal(store.get("!room:example.com"), null);
    });

    it("round-trips a draft through storage (the reload path)", () => {
        const storage = new FakeStorage();
        const first = new LocalStorageDraftStore(storage);
        first.set("!room:example.com", "half-typed message");
        first.flush();
        assert.equal(storage.setCalls, 1, "the flush wrote once");

        // A fresh store seeded from the same storage restores the draft: this is
        // the "I reloaded and my composer still has my text" behaviour.
        const second = new LocalStorageDraftStore(storage);
        assert.equal(second.get("!room:example.com"), "half-typed message");
    });

    it("keeps the in-memory map authoritative for instant re-select", () => {
        const store = new LocalStorageDraftStore(new FakeStorage());
        store.set("!a", "draft A");
        store.set("!b", "draft B");
        // No flush: the map already serves both rooms this session.
        assert.equal(store.get("!a"), "draft A");
        assert.equal(store.get("!b"), "draft B");
    });

    it("an empty draft clears the room (a cleared composer does not resurrect)", () => {
        const store = new LocalStorageDraftStore(new FakeStorage());
        store.set("!room", "typing…");
        assert.equal(store.get("!room"), "typing…");
        store.set("!room", "");
        assert.equal(store.get("!room"), null, "an empty value deletes the entry");
    });

    it("delete drops a room's draft", () => {
        const store = new LocalStorageDraftStore(new FakeStorage());
        store.set("!room", "draft");
        store.delete("!room");
        assert.equal(store.get("!room"), null);
    });

    it("caps a draft at DRAFT_MAX_CHARS", () => {
        const store = new LocalStorageDraftStore(new FakeStorage());
        const huge = "a".repeat(DRAFT_MAX_CHARS + 500);
        store.set("!room", huge);
        const back = store.get("!room");
        assert.equal(back!.length, DRAFT_MAX_CHARS);
        assert.equal(back, "a".repeat(DRAFT_MAX_CHARS));
    });

    it("evicts the oldest room once DRAFT_MAX_ROOMS is exceeded", () => {
        const store = new LocalStorageDraftStore(new FakeStorage());
        for (let i = 0; i <= DRAFT_MAX_ROOMS; i++) store.set(`!room-${i}`, `draft ${i}`);
        // One more room than the cap: the very first is evicted, the rest held.
        assert.equal(store.get("!room-0"), null, "the oldest is evicted");
        assert.equal(store.get(`!room-${DRAFT_MAX_ROOMS}`), `draft ${DRAFT_MAX_ROOMS}`, "the newest is kept");
        assert.equal(store.get(`!room-${DRAFT_MAX_ROOMS - 1}`), `draft ${DRAFT_MAX_ROOMS - 1}`, "the rest are kept");
    });

    it("a wrong version degrades to empty", () => {
        const storage = new FakeStorage();
        storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ version: 999, drafts: { "!room": "x" } }));
        const store = new LocalStorageDraftStore(storage, 0);
        assert.equal(store.get("!room"), null);
    });

    it("malformed JSON degrades to empty, not a throw", () => {
        const storage = new FakeStorage();
        storage.setItem(DRAFTS_STORAGE_KEY, "{ not valid json");
        const store = new LocalStorageDraftStore(storage, 0);
        assert.equal(store.get("!room"), null);
    });

    it("a non-record drafts payload degrades to empty", () => {
        const storage = new FakeStorage();
        storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ version: DRAFTS_STATE_VERSION, drafts: "nope" }));
        const store = new LocalStorageDraftStore(storage, 0);
        assert.equal(store.get("!room"), null);
    });

    it("skips non-string draft values but keeps the good ones", () => {
        const storage = new FakeStorage();
        storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ version: DRAFTS_STATE_VERSION, drafts: { "!good": "hi", "!bad": 42 } }));
        const store = new LocalStorageDraftStore(storage, 0);
        assert.equal(store.get("!good"), "hi");
        assert.equal(store.get("!bad"), null, "a non-string value is dropped, not coerced");
    });

    it("a full/unavailable store never breaks a write (best-effort)", () => {
        const storage = new FakeStorage();
        storage.throwOnWrite = true;
        const store = new LocalStorageDraftStore(storage, 0);
        // Neither set nor flush throws when the store is broken; the draft still
        // lives in memory for this session.
        assert.doesNotThrow(() => store.set("!room", "draft"));
        assert.doesNotThrow(() => store.flush());
        assert.equal(store.get("!room"), "draft");
    });

    it("flush forces a write that the debounce has not yet fired", () => {
        const storage = new FakeStorage();
        // A long debounce: the write would not land on its own in this test.
        const store = new LocalStorageDraftStore(storage, 60_000);
        store.set("!room", "draft");
        assert.equal(storage.setCalls, 0, "the debounce has not fired yet");
        store.flush();
        assert.equal(storage.setCalls, 1, "flush wrote immediately");
    });

    it("recognises an unchanged re-persist as a no-op (lastWritten dedupe)", () => {
        const storage = new FakeStorage();
        const store = new LocalStorageDraftStore(storage, 0);
        store.set("!room", "draft");
        store.flush();
        assert.equal(storage.setCalls, 1);
        // A second flush of the same map writes nothing: the seed already left
        // lastWritten equal to the current serialisation.
        store.flush();
        assert.equal(storage.setCalls, 1, "an unchanged re-persist is skipped");
        // A real change still lands a new write.
        store.set("!room", "edited");
        store.flush();
        assert.equal(storage.setCalls, 2, "a changed draft writes again");
    });

    it("flush persists a load so the boot-time re-persist is a no-op", () => {
        const storage = new FakeStorage();
        storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ version: DRAFTS_STATE_VERSION, drafts: { "!room": "draft" } }));
        // Seed from storage; record lastWritten. A post-seed flush must not rewrite.
        const store = new LocalStorageDraftStore(storage, 0);
        assert.equal(store.get("!room"), "draft");
        storage.setCalls = 0;
        store.flush();
        assert.equal(storage.setCalls, 0, "a flush of just-loaded state writes nothing");
    });

    it("a pending write fires once the debounce elapses", async () => {
        const storage = new FakeStorage();
        const store = new LocalStorageDraftStore(storage, 5);
        store.set("!room", "draft");
        assert.equal(storage.setCalls, 0, "still debounced");
        await tick(60);
        assert.equal(storage.setCalls, 1, "the debounce fired the write");
    });

    it("dispose cancels a pending write without persisting", async () => {
        const storage = new FakeStorage();
        const store = new LocalStorageDraftStore(storage, 60_000);
        store.set("!room", "draft");
        store.dispose();
        await tick(30);
        assert.equal(storage.setCalls, 0, "the cancelled timer never wrote");
    });

    it("a null storage keeps drafts in memory only", () => {
        const store = new LocalStorageDraftStore(null);
        store.set("!room", "draft");
        assert.equal(store.get("!room"), "draft");
        // A flush with no storage is a no-op, not a throw.
        assert.doesNotThrow(() => store.flush());
    });

    it("createDraftStore is usable without a browser", () => {
        const store = createDraftStore();
        store.set("!room", "draft");
        assert.equal(store.get("!room"), "draft");
    });
});
