import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isFeedsReady } from "../src/feedsReady.ts";

describe("isFeedsReady", () => {
    it("is false until start() has built the feeds", () => {
        // `stopped` is the state before start() is called at all; `starting`
        // covers the warm-seed paint, when the shell already shows a room.
        assert.equal(isFeedsReady("stopped"), false);
        assert.equal(isFeedsReady("starting"), false);
    });

    it("is true once the sync loop reports anything", () => {
        // The sync listener only fires after every feed exists, so a dropped
        // connection still has feeds to read from.
        assert.equal(isFeedsReady("syncing"), true);
        assert.equal(isFeedsReady("reconnecting"), true);
        assert.equal(isFeedsReady("error"), true);
    });
});
