import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Component } from "vue";

import { WorkspacePanesRegistry, type WorkspacePane } from "../src/panes/registry.ts";

const Comp = { name: "Comp" } as unknown as Component;

function pane(id: string, priority?: number): WorkspacePane {
    const base: WorkspacePane = { id, label: id, content: Comp };
    return priority === undefined ? base : { ...base, priority };
}

describe("WorkspacePanesRegistry", () => {
    it("registers a pane and finds it by id", () => {
        const panes = new WorkspacePanesRegistry();
        panes.add(pane("cc.example.one"));

        assert.equal(panes.get("cc.example.one")?.id, "cc.example.one");
        assert.equal(panes.get("cc.example.missing"), undefined);
        assert.equal(panes.all().length, 1);
    });

    it("refuses a second pane under a live id", () => {
        const panes = new WorkspacePanesRegistry();
        panes.add(pane("cc.example.one"));

        assert.throws(() => panes.add(pane("cc.example.one")), /already registered/);
    });

    it("disposes a pane, idempotently", () => {
        const panes = new WorkspacePanesRegistry();
        const dispose = panes.add(pane("cc.example.one"));

        dispose();
        dispose();
        assert.equal(panes.all().length, 0);
        assert.equal(panes.get("cc.example.one"), undefined);
    });

    it("does not let a stale disposer take down its replacement", () => {
        const panes = new WorkspacePanesRegistry();
        const dispose = panes.add(pane("cc.example.one"));
        dispose();

        panes.add(pane("cc.example.one"));
        dispose(); // the old disposer, run a second time

        assert.equal(panes.all().length, 1, "the replacement pane was removed by a stale disposer");
    });

    it("orders panes by priority, highest first, and treats a missing priority as zero", () => {
        const panes = new WorkspacePanesRegistry();
        panes.add(pane("cc.example.low", -10));
        panes.add(pane("cc.example.middle"));
        panes.add(pane("cc.example.high", 10));

        assert.deepEqual(
            panes.all().map((entry) => entry.id),
            ["cc.example.high", "cc.example.middle", "cc.example.low"],
        );
    });

    it("hands out a snapshot, so a caller cannot mutate the registry through it", () => {
        const panes = new WorkspacePanesRegistry();
        panes.add(pane("cc.example.one"));

        const snapshot = panes.all();
        snapshot.push(pane("cc.example.sneaky"));

        assert.equal(panes.all().length, 1);
    });

    it("removes a pane by id", () => {
        const panes = new WorkspacePanesRegistry();
        panes.add(pane("cc.example.one"));

        assert.equal(panes.remove("cc.example.one"), true);
        assert.equal(panes.remove("cc.example.one"), false);
        assert.equal(panes.all().length, 0);
    });
});
