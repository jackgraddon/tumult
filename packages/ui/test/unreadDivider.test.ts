import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { unreadDividerIndex } from "../src/timeline/unreadDivider.ts";

const messages = [
    { id: "$e17", senderId: "@alice:x" },
    { id: "$e18", senderId: "@bob:x" },
    { id: "$e19", senderId: "@carol:x" },
    { id: "$e20", senderId: "@demo:x" },
    { id: "$e21", senderId: "@demo:x" },
    { id: "$e22", senderId: "@alice:x" },
];

describe("unreadDividerIndex", () => {
    it("places nothing without a marker or with a marker outside the window", () => {
        assert.equal(unreadDividerIndex(messages, null, "@demo:x"), -1);
        assert.equal(unreadDividerIndex(messages, "$missing", "@demo:x"), -1);
    });

    it("anchors on the first message after the marker", () => {
        assert.equal(unreadDividerIndex(messages, "$e18", "@demo:x"), 2);
    });

    it("skips our own sends so they can never look unread", () => {
        // The reported bug: marker e18, then two of our messages, then a reply.
        // The divider belongs on the reply, not underneath our own send.
        assert.equal(unreadDividerIndex(messages, "$e19", "@demo:x"), 5);
    });

    it("places nothing when only our own messages follow the marker", () => {
        assert.equal(unreadDividerIndex(messages.slice(0, 5), "$e19", "@demo:x"), -1);
    });

    it("places nothing when the marker is the tail", () => {
        assert.equal(unreadDividerIndex(messages, "$e22", "@demo:x"), -1);
    });

    it("treats every message as potentially unread when our id is unknown", () => {
        assert.equal(unreadDividerIndex(messages, "$e19", null), 3);
    });
});
