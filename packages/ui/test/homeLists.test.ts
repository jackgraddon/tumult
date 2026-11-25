import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RoomSummary } from "@tumult/core";

import { recentChats, topSpaceId, unreadChats } from "../src/rooms/homeLists.ts";

function room(id: string, ts: number, unread = 0, highlight = 0, isSpace = false): RoomSummary {
    return {
        id,
        name: id,
        topic: null,
        avatarUrl: null,
        isSpace,
        parentSpaceIds: [],
        lastActivityTs: ts,
        unreadCount: unread,
        highlightCount: highlight,
        fullyReadEventId: null,
        joinRule: "invite",
        historyVisibility: "shared",
        canonicalAlias: null,
        favourite: false,
        favouriteOrder: null,
        muted: false,
    };
}

const rooms = [
    room("!space", 1000, 9, 0, true),
    room("!old", 100),
    room("!c", 300, 0, 1),
    room("!a", 500, 0, 0),
    room("!b", 400, 4, 0),
    room("!d", 200, 2, 0),
];

describe("empty pane's short lists", () => {
    it("takes the three newest conversations and never a space", () => {
        assert.deepEqual(
            recentChats(rooms).map((r) => r.id),
            ["!a", "!b", "!c"],
        );
    });

    it("takes the three newest unreads, counting highlights", () => {
        assert.deepEqual(
            unreadChats(rooms).map((r) => r.id),
            ["!b", "!c", "!d"],
        );
    });

    it("does not sort the rooms feed in place", () => {
        const before = rooms.map((r) => r.id);
        recentChats(rooms);
        unreadChats(rooms);
        assert.deepEqual(rooms.map((r) => r.id), before);
    });

    it("is honest when there is nothing unread", () => {
        assert.deepEqual(unreadChats([room("!quiet", 1)]), []);
    });

    it("finds the rail-level guild through nested spaces, and DMs have none", () => {
        const space = (id: string, parents: string[] = []) => {
            const s = room(id, 1, 0, 0, true);
            return { ...s, parentSpaceIds: parents };
        };
        const nested = { ...room("!nested-room", 1), parentSpaceIds: ["!inner"] };
        const cyclic = { ...room("!cyclic", 1), parentSpaceIds: ["!cycle-a", "!cycle-b"] };
        const set = [
            space("!outer"),
            space("!inner", ["!outer"]),
            nested,
            room("!cycle-a", 1, 0, 0, true),
            room("!cycle-b", 1, 0, 0, true),
            cyclic,
        ];
        assert.equal(topSpaceId(set, nested), "!outer");
        assert.equal(topSpaceId(set, room("!a", 1)), undefined);
        // A cycle must not spin forever; the last distinct space wins.
        assert.equal(topSpaceId(set, cyclic), "!cycle-a");
    });
});
