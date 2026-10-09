import { test, describe } from "node:test";
import assert from "node:assert";
import { SlidingSyncRangeManager } from "../../src/sync/range-manager.ts";

// Dummy client for testing
class FakeMatrixClient {
    baseUrl = "https://example.com";
    getUserId() { return "@fake:example.com"; }
    getDeviceId() { return "fake_device"; }
    doesServerSupportUnstableFeature() { return Promise.resolve(true); }
    // ... rest of the interface is not needed for this test
    // but TypeScript might complain if we don't satisfy it.
    // However, since we are testing the manager, we can use 'as any'
    // if it's a pure unit test.
    [key: string]: any;
}

describe("SlidingSyncRangeManager", () => {
    const client = new FakeMatrixClient() as any;
    const baseConfig = {
        timeline_limit: 20,
        required_state: [["m.room.name", ""]],
        filters: {},
        ranges: [[0, 99]],
    };

    test("manages ranges correctly", () => {
        const manager = new SlidingSyncRangeManager(client, baseConfig);

        // Initial state: no ranges in syncMap
        assert.strictEqual(manager.syncMap.size, 0);

        // Add first range
        manager.addRange("range-0-99", 0, 99);
        assert.strictEqual(manager.syncMap.size, 1);
        assert.ok(manager.getRangeIds().includes("range-0-99"));

        // Test next range
        const next = manager.getNextRange();
        assert.deepStrictEqual(next, { id: "range-100-599", start: 100, end: 599 });

        // Add next range
        if (next) {
            manager.addRange(next.id, next.start, next.end);
        }
        assert.strictEqual(manager.syncMap.size, 2);
        assert.ok(manager.getRangeIds().includes("range-100-599"));

        // Test eviction
        manager.touch("range-0-99"); // Make sure index 0 is NOT evicted
        
        // Mocking time by calling evict with a massive threshold (no eviction)
        manager.evictIdle(100000);
        assert.strictEqual(manager.syncMap.size, 2);

        // Mocking time by calling evict with a tiny threshold (immediate eviction)
        manager.evictIdle(-100000);
        assert.strictEqual(manager.syncMap.size, 0);
    });

    test("reaches cap", () => {
        const manager = new SlidingSyncRangeManager(client, baseConfig);

        // Advance currentEnd to near the cap
        manager.addRange("range-4999-4999", 4999, 4999);

        const next = manager.getNextRange();
        assert.strictEqual(next, null);
    });
});
