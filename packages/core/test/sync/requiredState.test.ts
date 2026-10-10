import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { REQUIRED_STATE } from "../../src/sync/requiredState.ts";

describe("sliding-sync required_state", () => {
    it("requests child/parent links with the wildcard state key", () => {
        // `m.space.child` is keyed by the CHILD room id, `m.room.parent` by the
        // PARENT space id. `""` matches neither, which silently drops every
        // parent link — all spaces land in the guild rail and all rooms in DMs.
        for (const type of ["m.space.child", "m.room.parent"]) {
            assert.deepEqual(
                REQUIRED_STATE.filter(([t]) => t === type),
                [[type, "*"]],
                `${type} must use the wildcard state key`,
            );
        }
    });

    it("keeps the member wildcard so senders resolve", () => {
        assert.ok(REQUIRED_STATE.some(([t, k]) => t === "m.room.member" && k === "$ME"));
        assert.ok(REQUIRED_STATE.some(([t, k]) => t === "m.room.member" && k === "*"));
    });
});
