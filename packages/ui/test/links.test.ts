import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { matrixEventLink, matrixRoomLink, matrixUserLink } from "../src/links.ts";

/**
 * The link builders are tiny on purpose: a copy item must never depend on a
 * round trip, so what a link looks like is decided here and nowhere else.
 */
describe("matrix.to links", () => {
    it("links an event under its room", () => {
        assert.equal(
            matrixEventLink("!room:example.com", "$event:example.com"),
            "https://matrix.to/#/!room:example.com/$event:example.com",
        );
    });

    it("prefers a room's canonical alias", () => {
        assert.equal(
            matrixRoomLink("!room:example.com", "#general:example.com"),
            "https://matrix.to/#/#general:example.com",
        );
    });

    it("falls back to the room id without an alias", () => {
        assert.equal(matrixRoomLink("!room:example.com", null), "https://matrix.to/#/!room:example.com");
        assert.equal(matrixRoomLink("!room:example.com"), "https://matrix.to/#/!room:example.com");
        assert.equal(
            matrixRoomLink("!room:example.com", ""),
            "https://matrix.to/#/!room:example.com",
            "an empty alias is not an alias",
        );
    });

    it("links a user", () => {
        assert.equal(matrixUserLink("@alice:example.com"), "https://matrix.to/#/@alice:example.com");
    });
});
