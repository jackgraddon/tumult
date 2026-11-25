import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { estimateTimelineRowHeight } from "../src/timeline/rowEstimate.ts";

const plain = { grouped: false, dayLabel: null, unreadBefore: false };
const grouped = { grouped: true, dayLabel: null, unreadBefore: false };

describe("estimateTimelineRowHeight", () => {
    it("adds separators to the row instead of replacing its height", () => {
        // The old estimate treated a day label as a SHORTER row. A day row is
        // a normal (ungrouped) row PLUS the divider; the divider never stands in
        // for the message.
        assert.equal(estimateTimelineRowHeight(plain, "cozy"), 44);
        assert.equal(estimateTimelineRowHeight({ ...plain, dayLabel: "Monday" }, "cozy"), 74);
        assert.equal(estimateTimelineRowHeight({ ...plain, unreadBefore: true }, "cozy"), 66);
        assert.equal(
            estimateTimelineRowHeight({ ...plain, dayLabel: "Monday", unreadBefore: true }, "cozy"),
            96,
        );
    });

    it("keeps a grouped continuation short, without separator or density surprises", () => {
        assert.equal(estimateTimelineRowHeight(grouped, "cozy"), 19);
        assert.equal(estimateTimelineRowHeight(grouped, "spacious"), 19);
        assert.equal(estimateTimelineRowHeight({ ...grouped, dayLabel: "Monday" }, "cozy"), 49);
    });

    it("applies density only to rows with vertical padding", () => {
        assert.equal(estimateTimelineRowHeight(plain, "compact"), 40);
        assert.equal(estimateTimelineRowHeight(plain, "spacious"), 52);
        assert.equal(estimateTimelineRowHeight({ ...plain, dayLabel: "Monday" }, "compact"), 70);
    });
});
