import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { selectSpaceTree } from "../src/selectors/spaceTree.ts";
import type { RoomSummary } from "../src/contract.ts";

function room(partial: Partial<RoomSummary> & { id: string; name: string }): RoomSummary {
    return {
        topic: null,
        avatarUrl: null,
        isSpace: false,
        parentSpaceIds: [],
        unreadCount: 0,
        highlightCount: 0,
        ...partial,
    };
}

function space(id: string, name: string, parents: string[] = []): RoomSummary {
    return room({ id, name, isSpace: true, parentSpaceIds: parents });
}

describe("selectSpaceTree", () => {
    it("nests rooms under parent-less spaces; orphans become DMs", () => {
        const tree = selectSpaceTree([
            space("!g:1", "Guild"),
            room({ id: "!r:1", name: "general", parentSpaceIds: ["!g:1"] }),
            room({ id: "!d:1", name: "dm" }),
        ]);
        assert.equal(tree.guilds.length, 1);
        assert.equal(tree.guilds[0]?.rooms.length, 1);
        assert.equal(tree.orphans.length, 1);
    });

    it("drops dangling / non-space / self parents", () => {
        const tree = selectSpaceTree([
            space("!g:1", "Guild"),
            room({ id: "!r:1", name: "x", parentSpaceIds: ["!missing:1", "!r:1"] }),
            room({ id: "!notspace:1", name: "plain" }),
            room({ id: "!r:2", name: "y", parentSpaceIds: ["!notspace:1", "!r:2"] }),
        ]);
        assert.equal(tree.orphans.length, 3);
        assert.equal(tree.guilds[0]?.rooms.length, 0);
    });

    it("renders diamonds under both parents independently", () => {
        const rooms = [
            space("!g:1", "G"),
            space("!a:1", "A", ["!g:1"]),
            space("!b:1", "B", ["!g:1"]),
            room({ id: "!r:1", name: "shared", parentSpaceIds: ["!a:1", "!b:1"] }),
        ];
        const tree = selectSpaceTree(rooms);
        const g = tree.guilds[0];
        assert.equal(g?.spaces.length, 2);
        assert.equal(g?.spaces[0]?.rooms.length, 1);
        assert.equal(g?.spaces[1]?.rooms.length, 1);
        assert.deepEqual(tree.guildIdsByRoomId.get("!r:1"), ["!g:1", "!g:1"]);
    });

    it("truncates reachable cycles instead of recursing", () => {
        const tree = selectSpaceTree([
            space("!g:1", "G"),
            space("!a:1", "A", ["!g:1", "!b:1"]),
            space("!b:1", "B", ["!a:1"]),
        ]);
        const g = tree.guilds[0];
        const a = g?.spaces.find((s) => s.room.id === "!a:1");
        assert.ok(a);
        // A -> B -> A(re-entry truncated)
        const b = a.spaces.find((s) => s.room.id === "!b:1");
        assert.ok(b);
        assert.ok(b.spaces.some((s) => s.truncated));
    });

    it("promotes unreachable cycles deterministically", () => {
        const tree = selectSpaceTree([
            space("!b:1", "Bee", ["!a:1"]),
            space("!a:1", "Aye", ["!b:1"]),
        ]);
        // a<->b with no root: A ⊂ B ⊂ A; lowest id promoted
        assert.deepEqual(tree.promotedGuildIds, ["!a:1"]);
        assert.equal(tree.guilds.length, 1);
        assert.equal(tree.guilds[0]?.room.id, "!a:1");
    });

    it("does not drop rooms when the lowest-id promotion candidate is a childless pendant", () => {
        // Pendant's id sorts first but has no children of its own; the real content
        // (the P<->Q cycle and the rooms under each) hangs off P and Q. Promoting
        // only the pendant must not make P, Q, or their rooms vanish.
        const tree = selectSpaceTree([
            space("!a_pendant:1", "Pendant", ["!p:1"]),
            space("!p:1", "P", ["!q:1"]),
            space("!q:1", "Q", ["!p:1"]),
            room({ id: "!room-under-p:1", name: "room under P", parentSpaceIds: ["!p:1"] }),
            room({ id: "!room-under-q:1", name: "room under Q", parentSpaceIds: ["!q:1"] }),
        ]);

        const allRoomIds = new Set<string>();
        const visit = (node: (typeof tree.guilds)[number]): void => {
            for (const r of node.rooms) allRoomIds.add(r.id);
            for (const s of node.spaces) visit(s);
        };
        for (const g of tree.guilds) visit(g);

        assert.ok(allRoomIds.has("!room-under-p:1"), "room under P must not vanish");
        assert.ok(allRoomIds.has("!room-under-q:1"), "room under Q must not vanish");
        assert.equal(tree.orphans.length, 0, "rooms with valid parents must not become orphans");
    });

    it("caps output with maxDepth/maxNodes and counts truncation", () => {
        const rooms: RoomSummary[] = [space("!g:1", "G")];
        let parent = "!g:1";
        for (let i = 0; i < 12; i++) {
            const id = `!s${i}:1`;
            rooms.push(space(id, `S${i}`, [parent]));
            parent = id;
        }
        const tree = selectSpaceTree(rooms, { maxDepth: 4 });
        assert.ok(tree.truncatedCount > 0);
        const tiny = selectSpaceTree(rooms, { maxNodes: 3 });
        assert.ok(tiny.truncatedCount > 0);
    });

    it("orders rooms-before-spaces and sorts deterministically", () => {
        const tree = selectSpaceTree([
            space("!g:1", "G"),
            space("!z:1", "zeta", ["!g:1"]),
            room({ id: "!r:1", name: "beta", parentSpaceIds: ["!g:1"] }),
            room({ id: "!r:2", name: "alpha", parentSpaceIds: ["!g:1"] }),
        ]);
        const g = tree.guilds[0];
        assert.deepEqual(g?.rooms.map((r) => r.name), ["alpha", "beta"]);
        assert.equal(g?.spaces.length, 1);
    });

    it("aggregates unread/highlight through collapsed subtrees", () => {
        const tree = selectSpaceTree([
            space("!g:1", "G"),
            space("!a:1", "A", ["!g:1"]),
            room({ id: "!r:1", name: "x", parentSpaceIds: ["!a:1"], unreadCount: 120, highlightCount: 2 }),
        ]);
        assert.equal(tree.guilds[0]?.aggregateUnread, 120);
        assert.equal(tree.guilds[0]?.aggregateHighlight, 2);
    });
});
