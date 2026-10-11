import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BackfillQueue } from "../src/rooms/backfill-queue.ts";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("BackfillQueue", () => {
    it("dedupes a key that is queued or running", async () => {
        let runs = 0;
        const queue = new BackfillQueue(async () => {
            runs++;
        }, 1);
        queue.enqueue("a");
        queue.enqueue("a");
        queue.enqueue("a");
        assert.equal(queue.has("a"), true);
        await tick();
        await tick();
        assert.equal(runs, 1);
        assert.equal(queue.has("a"), false);
    });

    it("caps concurrency and still runs every key", async () => {
        let active = 0;
        let peak = 0;
        const done: string[] = [];
        const gates: Array<() => void> = [];
        const queue = new BackfillQueue(async (key) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise<void>((resolve) => gates.push(resolve));
            active--;
            done.push(key);
        }, 2);
        queue.enqueue("a");
        queue.enqueue("b");
        queue.enqueue("c");
        assert.equal(active, 2);
        for (let i = 0; i < 12 && done.length < 3; i++) {
            gates.shift()?.();
            await tick();
        }
        assert.equal(peak, 2);
        assert.deepEqual(done.slice().sort(), ["a", "b", "c"]);
    });

    it("clear() drops queued keys but lets the running one finish", async () => {
        const order: string[] = [];
        const gates: Array<() => void> = [];
        const queue = new BackfillQueue(async (key) => {
            order.push(key);
            await new Promise<void>((resolve) => gates.push(resolve));
        }, 1);
        queue.enqueue("a");
        await tick();
        queue.enqueue("b");
        queue.clear();
        assert.equal(queue.has("b"), false);
        gates.shift()?.();
        await tick();
        await tick();
        assert.deepEqual(order, ["a"]);
    });

    it("allows re-enqueueing a key after it completes", async () => {
        let runs = 0;
        const queue = new BackfillQueue(async () => {
            runs++;
        }, 1);
        queue.enqueue("a");
        await tick();
        await tick();
        assert.equal(runs, 1);
        queue.enqueue("a");
        await tick();
        await tick();
        assert.equal(runs, 2);
    });
});
