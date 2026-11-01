import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bestGrid, isSpotlit, partition, pruneOverrides } from "../src/calls/stageLayout.ts";

const tile = (key: string, source: "camera" | "screen" = "camera") => ({ key, source });

describe("bestGrid", () => {
    it("is one cell for one tile, whatever the box", () => {
        assert.deepEqual(bestGrid(1, 800, 100, 8), { cols: 1, rows: 1 });
        assert.deepEqual(bestGrid(0, 800, 100, 8), { cols: 1, rows: 1 });
    });

    it("lays a wide box out in a row and a tall box out in a column", () => {
        assert.deepEqual(bestGrid(3, 1500, 220, 8), { cols: 3, rows: 1 });
        assert.deepEqual(bestGrid(3, 300, 900, 8), { cols: 1, rows: 3 });
    });

    it("never produces more cells than needed per row, and always holds every tile", () => {
        for (const [w, h] of [[1200, 300], [400, 400], [320, 700], [2000, 900]] as const) {
            for (let n = 1; n <= 16; n++) {
                const { cols, rows } = bestGrid(n, w, h, 8);
                assert.ok(cols * rows >= n, `${n} tiles must fit ${cols}x${rows}`);
                assert.ok((rows - 1) * cols < n, `${cols}x${rows} leaves a whole empty row for ${n}`);
            }
        }
    });

    it("beats a naive square-ish grid when the box is short and wide", () => {
        // 4 tiles in 1600x200: a 2x2 would give cells of ~800x96; one row gives ~400x200.
        assert.deepEqual(bestGrid(4, 1600, 200, 8), { cols: 4, rows: 1 });
    });

    it("falls back to a square-ish grid before the first measurement", () => {
        assert.deepEqual(bestGrid(4, 0, 0, 8), { cols: 2, rows: 2 });
        assert.deepEqual(bestGrid(5, 0, 0, 8), { cols: 3, rows: 2 });
    });
});

describe("spotlight", () => {
    it("spotlights a screen by default and a camera only when chosen", () => {
        assert.equal(isSpotlit(tile("a", "screen"), {}), true);
        assert.equal(isSpotlit(tile("b"), {}), false);
        assert.equal(isSpotlit(tile("b"), { b: true }), true);
        assert.equal(isSpotlit(tile("a", "screen"), { a: false }), false, "a screen can be sent back to the strip");
    });

    it("puts a shared screen up front with everyone else in the strip", () => {
        const { main, strip } = partition([tile("cam1"), tile("scr", "screen"), tile("cam2")], {});
        assert.deepEqual(main.map((t) => t.key), ["scr"]);
        assert.deepEqual(strip.map((t) => t.key), ["cam1", "cam2"]);
    });

    it("lets several screens share the spotlight", () => {
        const { main, strip } = partition([tile("s1", "screen"), tile("s2", "screen"), tile("cam")], {});
        assert.deepEqual(main.map((t) => t.key), ["s1", "s2"]);
        assert.deepEqual(strip.map((t) => t.key), ["cam"]);
    });

    it("is one even grid when nothing is spotlit, including after the last spotlight is reversed", () => {
        const tiles = [tile("a"), tile("b", "screen")];
        assert.deepEqual(partition(tiles, { b: false }), { main: tiles, strip: [] });
    });

    it("has no strip when everything is spotlit", () => {
        const { main, strip } = partition([tile("a"), tile("b")], { a: true, b: true });
        assert.equal(main.length, 2);
        assert.equal(strip.length, 0);
    });

    it("forgets choices for tiles that left, so a re-shared screen starts spotlit again", () => {
        assert.deepEqual(pruneOverrides({ a: false, gone: true }, ["a"]), { a: false });
    });
});
