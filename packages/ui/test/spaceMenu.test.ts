import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSpaceMenu, type SpaceMenu } from "../src/rail/spaceMenu.ts";

function shape(menu: SpaceMenu): string[] {
    return menu.entries.map((entry) => (entry.kind === "separator" ? "|" : entry.id));
}

describe("buildSpaceMenu", () => {
    it("offers the link, the id and the way out, in that order", () => {
        assert.deepEqual(shape(buildSpaceMenu("!space:example.com")), [
            "copy-link",
            "copy-id",
            "|",
            "leave",
        ]);
    });

    it("links the space's canonical alias when it has one", () => {
        assert.equal(
            buildSpaceMenu("!space:example.com", "#guild:example.com").spaceLink,
            "https://matrix.to/#/#guild:example.com",
        );
    });

    it("falls back to the space id, because the rail tile carries no alias", () => {
        assert.equal(
            buildSpaceMenu("!space:example.com").spaceLink,
            "https://matrix.to/#/!space:example.com",
        );
    });

    it("marks leave as the only destructive item", () => {
        const entries = buildSpaceMenu("!space:example.com").entries;
        const danger = entries.filter((entry) => entry.kind === "item" && entry.danger);
        assert.deepEqual(
            danger.map((entry) => (entry.kind === "item" ? entry.id : "")),
            ["leave"],
        );
    });

    it("labels the items with what they do", () => {
        const labels = buildSpaceMenu("!space:example.com").entries.map((entry) =>
            entry.kind === "item" ? entry.label : "|",
        );
        assert.deepEqual(labels, ["Copy link", "Copy space ID", "|", "Leave space"]);
    });
});
