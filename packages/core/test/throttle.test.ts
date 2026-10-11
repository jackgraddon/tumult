import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ThrottledTask } from "../src/util/throttle.ts";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("ThrottledTask", () => {
    it("runs once for a burst of schedule() calls", async () => {
        let runs = 0;
        const task = new ThrottledTask(() => {
            runs++;
        }, 10);
        for (let i = 0; i < 6; i++) task.schedule();
        await delay(30);
        assert.equal(runs, 1);
        assert.equal(task.pending, false);
    });

    it("arms a fresh run after the interval elapses", async () => {
        let runs = 0;
        const task = new ThrottledTask(() => {
            runs++;
        }, 10);
        task.schedule();
        await delay(25);
        assert.equal(runs, 1);
        task.schedule();
        await delay(25);
        assert.equal(runs, 2);
    });

    it("stays pending until the interval fires", () => {
        const task = new ThrottledTask(() => undefined, 20);
        assert.equal(task.pending, false);
        task.schedule();
        assert.equal(task.pending, true);
        task.clear();
        assert.equal(task.pending, false);
    });

    it("clear() drops a pending run without executing it", async () => {
        let runs = 0;
        const task = new ThrottledTask(() => {
            runs++;
        }, 10);
        task.schedule();
        task.clear();
        await delay(30);
        assert.equal(runs, 0);
    });
});
