import { test, describe } from "node:test";
import assert from "node:assert";
import {
    SlidingSyncRangeManager,
    SSS_LIST_KEY,
    type SssWindowStore,
} from "../../src/sync/range-manager.ts";
import type { SlidingSync } from "matrix-js-sdk/lib/sliding-sync.js";

/** Minimal `SlidingSync` stand-in: records the ranges it is asked to apply. */
class FakeSync {
    public readonly calls: Array<{ key: string; ranges: number[][] }> = [];
    /** Server-reported total joined rooms, as SSS lists report it. */
    public joinedCount = 0;
    public setListRanges(key: string, ranges: number[][]): void {
        this.calls.push({ key, ranges });
    }
    public getListData(_key: string): { joinedCount: number } | null {
        return { joinedCount: this.joinedCount };
    }
}

/** In-memory {@link SssWindowStore} that also records every save. */
function fakeStore(initial: number | null = null): SssWindowStore & { saved: number[] } {
    const saved: number[] = [];
    let value = initial;
    return {
        saved,
        loadEnd: () => value,
        saveEnd: (end) => {
            value = end;
            saved.push(end);
        },
    };
}

function manager(sync: FakeSync, store?: SssWindowStore): SlidingSyncRangeManager {
    return new SlidingSyncRangeManager(sync as unknown as SlidingSync, store);
}

describe("SlidingSyncRangeManager", () => {
    test("restores the default window before start", () => {
        const sync = new FakeSync();
        const store = fakeStore(null);
        const range = manager(sync, store);

        assert.equal(range.currentEnd, -1, "no window before restoreWindow()");
        assert.equal(range.restoreWindow(), 999);
        assert.deepEqual(sync.calls, [{ key: SSS_LIST_KEY, ranges: [[0, 999]] }]);
        assert.deepEqual(store.saved, [999], "the restored default is persisted");
    });

    test("restores a persisted window and clamps it to the supported bounds", () => {
        const wide = new FakeSync();
        assert.equal(manager(wide, fakeStore(4000)).restoreWindow(), 4000);
        assert.deepEqual(wide.calls.at(-1), { key: SSS_LIST_KEY, ranges: [[0, 4000]] });

        // Below the default is bumped up; above the cap is clamped down.
        assert.equal(manager(new FakeSync(), fakeStore(10)).restoreWindow(), 999);
        assert.equal(manager(new FakeSync(), fakeStore(99_999)).restoreWindow(), 5000);
    });

    test("loadMore grows the window by one page and persists it", () => {
        const sync = new FakeSync();
        const store = fakeStore(null);
        const range = manager(sync, store);
        range.restoreWindow();

        assert.equal(range.loadMore(), true);
        assert.equal(range.currentEnd, 1499);
        assert.deepEqual(sync.calls.at(-1), { key: SSS_LIST_KEY, ranges: [[0, 1499]] });
        assert.deepEqual(store.saved, [999, 1499]);
    });

    test("loadMore reports false at the cap and never applies past it", () => {
        const sync = new FakeSync();
        const range = manager(sync, fakeStore(5000));
        range.restoreWindow();

        assert.equal(range.currentEnd, 5000);
        assert.equal(range.loadMore(), false);
        // Only restore + nothing else was applied.
        assert.equal(sync.calls.length, 1);
    });

    test("loadMore before restoreWindow is a no-op", () => {
        const sync = new FakeSync();
        assert.equal(manager(sync, fakeStore(null)).loadMore(), false);
        assert.deepEqual(sync.calls, []);
    });

    test("works without a store (persistence is optional)", () => {
        const sync = new FakeSync();
        const range = manager(sync);
        assert.equal(range.restoreWindow(), 999);
        assert.equal(range.loadMore(), true);
        assert.equal(range.currentEnd, 1499);
    });

    test("hasMore tracks the server's joined count, never past the cap", () => {
        const sync = new FakeSync();
        const range = manager(sync, fakeStore(null));
        range.restoreWindow(); // 0..999

        sync.joinedCount = 1000;
        assert.equal(range.hasMore(), false, "window covers every joined room");
        sync.joinedCount = 1200;
        assert.equal(range.hasMore(), true, "more rooms exist behind the window");

        const cappedSync = new FakeSync();
        const capped = manager(cappedSync, fakeStore(5000));
        capped.restoreWindow();
        cappedSync.joinedCount = 100_000;
        assert.equal(capped.hasMore(), false, "never offers more past the cap");

        assert.equal(manager(new FakeSync(), fakeStore(null)).hasMore(), false, "false before restoreWindow");
    });
});
