import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { forgetRoom, recallRoom, rememberRoom, viewKey, type LastRooms } from "../src/shell/lastRoom.ts";

const available = (id: string): boolean => id === "!dm-1" || id === "!chan-1" || id === "!chan-2";

describe("last-room memory", () => {
    it("keys DMs and each guild separately, and not a workspace pane", () => {
        assert.equal(viewKey({ view: "dms" }), "dms");
        assert.equal(viewKey({ view: "dms", roomId: "!dm-1" }), "dms");
        assert.equal(viewKey({ view: "guild", guildId: "!guild-a" }), "guild:!guild-a");
        assert.equal(viewKey({ view: "pane", paneId: "demo" }), null);
    });

    it("remembers an explicit pick in each view", () => {
        const memory: LastRooms = new Map();
        rememberRoom(memory, { view: "dms", roomId: "!dm-1" });
        rememberRoom(memory, { view: "guild", guildId: "!guild-a", roomId: "!chan-1" });
        rememberRoom(memory, { view: "guild", guildId: "!guild-b", roomId: "!chan-2" });
        // Navigation without a room, and panes, never erase what was remembered.
        rememberRoom(memory, { view: "dms" });
        rememberRoom(memory, { view: "pane", paneId: "demo", roomId: "!dm-1" });
        assert.deepEqual([...memory], [
            ["dms", "!dm-1"],
            ["guild:!guild-a", "!chan-1"],
            ["guild:!guild-b", "!chan-2"],
        ]);
    });

    it("recalls only for a bare route in the same view", () => {
        const memory: LastRooms = new Map([
            ["dms", "!dm-1"],
            ["guild:!guild-a", "!chan-1"],
        ]);
        assert.equal(recallRoom(memory, { view: "dms" }, available), "!dm-1");
        assert.equal(recallRoom(memory, { view: "guild", guildId: "!guild-a" }, available), "!chan-1");
        // An explicit room wins; another guild has no memory.
        assert.equal(recallRoom(memory, { view: "dms", roomId: "!dm-2" }, available), undefined);
        assert.equal(recallRoom(memory, { view: "guild", guildId: "!guild-b" }, available), undefined);
        assert.equal(recallRoom(memory, { view: "pane", paneId: "demo" }, available), undefined);
    });

    it("does not resurrect a room that is no longer available in the view", () => {
        const memory: LastRooms = new Map([["dms", "!left"]]);
        assert.equal(recallRoom(memory, { view: "dms" }, available), undefined);
        forgetRoom(memory, "!left");
        assert.equal(memory.size, 0);
    });
});
