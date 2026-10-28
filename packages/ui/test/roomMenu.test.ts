import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { RoomSummary } from "@tumult/core";

import { buildRoomMenu, type RoomMenu } from "../src/roomlist/roomMenu.ts";

/** A room row, with the fields the menu reads spelled out. */
function room(overrides: Partial<RoomSummary> = {}): RoomSummary {
    return {
        id: "!room:example.com",
        name: "general",
        topic: null,
        avatarUrl: null,
        isSpace: false,
        parentSpaceIds: ["!space:example.com"],
        unreadCount: 0,
        highlightCount: 0,
        fullyReadEventId: null,
        joinRule: "invite",
        historyVisibility: "shared",
        canonicalAlias: "#general:example.com",
        favourite: false,
        favouriteOrder: null,
        muted: false,
        ...overrides,
    };
}

/** Entry ids with group separators as "|", so grouping is assertable. */
function shape(menu: RoomMenu): string[] {
    return menu.entries.map((entry) => (entry.kind === "separator" ? "|" : entry.id));
}

describe("buildRoomMenu", () => {
    it("offers the opposite of the room's pin and mute state", () => {
        const ids = shape(buildRoomMenu(room({ favourite: true, muted: true })));
        assert.deepEqual(ids.slice(0, 2), ["unpin", "unmute"]);
    });

    it("offers copy and leave for a read room, with no mark-read to do", () => {
        assert.deepEqual(shape(buildRoomMenu(room())), ["pin", "mute", "|", "copy-link", "copy-id", "|", "leave"]);
    });

    it("offers mark-read when there is something unread", () => {
        assert.deepEqual(shape(buildRoomMenu(room({ unreadCount: 3 }))), [
            "mark-read",
            "pin",
            "mute",
            "|",
            "copy-link",
            "copy-id",
            "|",
            "leave",
        ]);
    });

    it("treats a highlight with no unread count as something to mark read", () => {
        assert.deepEqual(shape(buildRoomMenu(room({ highlightCount: 1 }))), [
            "mark-read",
            "pin",
            "mute",
            "|",
            "copy-link",
            "copy-id",
            "|",
            "leave",
        ]);
    });

    it("links the canonical alias", () => {
        assert.equal(buildRoomMenu(room()).roomLink, "https://matrix.to/#/#general:example.com");
    });

    it("links the room id when the room has no alias", () => {
        assert.equal(
            buildRoomMenu(room({ canonicalAlias: null })).roomLink,
            "https://matrix.to/#/!room:example.com",
        );
    });

    it("marks leave as destructive and nothing else", () => {
        const entries = buildRoomMenu(room({ unreadCount: 1 })).entries;
        const danger = entries.filter((entry) => entry.kind === "item" && entry.danger);
        assert.deepEqual(
            danger.map((entry) => (entry.kind === "item" ? entry.id : "")),
            ["leave"],
        );
    });

    it("labels the items with what they do", () => {
        const labels = buildRoomMenu(room({ unreadCount: 1 })).entries.map((entry) =>
            entry.kind === "item" ? entry.label : "|",
        );
        assert.deepEqual(labels, [
            "Mark as read",
            "Copy link",
            "Copy room ID",
            "|",
            "Leave room",
        ]);
    });
});
