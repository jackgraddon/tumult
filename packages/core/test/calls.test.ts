import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { CALL_MEMBER_EVENT_TYPE, membersCanJoinCalls } from "../src/contract.ts";
import { setMembersCanJoinCalls } from "../src/rooms/calls.ts";

/** What Synapse's private_chat preset writes (handlers/room.py), abridged. */
const PRESET = {
    users: { "@me:localhost": 100 },
    users_default: 0,
    events: { "m.room.power_levels": 100, "m.room.encryption": 100, "m.room.name": 50 },
    events_default: 0,
    state_default: 50,
};

function stub(levels: Record<string, unknown>): { matrix: MatrixClient; writes: Record<string, unknown>[] } {
    const writes: Record<string, unknown>[] = [];
    const matrix = {
        getStateEvent: async (_roomId: string, type: string, key: string) => {
            assert.equal(type, "m.room.power_levels");
            assert.equal(key, "");
            return structuredClone(levels);
        },
        sendStateEvent: async (_roomId: string, type: string, content: Record<string, unknown>, key: string) => {
            assert.equal(type, "m.room.power_levels");
            assert.equal(key, "");
            writes.push(content);
            return { event_id: "$e" };
        },
    } as unknown as MatrixClient;
    return { matrix, writes };
}

const callLevel = (content: Record<string, unknown> | undefined): number | undefined =>
    (content?.["events"] as Record<string, number> | undefined)?.[CALL_MEMBER_EVENT_TYPE];

describe("setMembersCanJoinCalls", () => {
    it("opens calls at the default user level, keeping every other level", async () => {
        const { matrix, writes } = stub(PRESET);
        await setMembersCanJoinCalls(matrix, "!r", true);
        assert.deepEqual(writes, [{ ...PRESET, events: { ...PRESET.events, [CALL_MEMBER_EVENT_TYPE]: 0 } }]);
    });

    it("closes calls to moderators, keeping every other level", async () => {
        const { matrix, writes } = stub({ ...PRESET, events: { ...PRESET.events, [CALL_MEMBER_EVENT_TYPE]: 0 } });
        await setMembersCanJoinCalls(matrix, "!r", false);
        assert.equal(writes.length, 1);
        assert.equal(callLevel(writes[0]), 50);
        assert.equal((writes[0]!["events"] as Record<string, number>)["m.room.power_levels"], 100);
    });

    it("really closes a room whose state_default lets everyone send state", async () => {
        // Closing to state_default (0) would leave it open; closed means 50.
        const { matrix, writes } = stub({ ...PRESET, state_default: 0, events: { [CALL_MEMBER_EVENT_TYPE]: 0 } });
        await setMembersCanJoinCalls(matrix, "!r", false);
        assert.equal(callLevel(writes[0]), 50);
    });

    it("opens at a raised default user level, not at 0", async () => {
        const { matrix, writes } = stub({ ...PRESET, users_default: 10 });
        await setMembersCanJoinCalls(matrix, "!r", true);
        assert.equal(callLevel(writes[0]), 10);
    });

    it("writes nothing when the room is already as asked", async () => {
        const open = stub({ ...PRESET, events: { [CALL_MEMBER_EVENT_TYPE]: 0 } });
        await setMembersCanJoinCalls(open.matrix, "!r", true);
        // No entry: state_default (50) applies, which is already closed.
        const closed = stub(PRESET);
        await setMembersCanJoinCalls(closed.matrix, "!r", false);
        assert.equal(open.writes.length + closed.writes.length, 0);
    });

    it("lets a refused read fail the call (the settings dialog shows it)", async () => {
        const matrix = { getStateEvent: async () => Promise.reject(new Error("M_FORBIDDEN")) } as unknown as MatrixClient;
        await assert.rejects(setMembersCanJoinCalls(matrix, "!r", true), /M_FORBIDDEN/);
    });
});

describe("membersCanJoinCalls", () => {
    const base = { events: {}, stateDefault: 50, usersDefault: 0 };
    it("is false where only state_default gates the event (the presets)", () => {
        assert.equal(membersCanJoinCalls(base), false);
    });
    it("is true once the event is at the default user level", () => {
        assert.equal(membersCanJoinCalls({ ...base, events: { [CALL_MEMBER_EVENT_TYPE]: 0 } }), true);
    });
    it("is true in a room that lets everyone send state", () => {
        assert.equal(membersCanJoinCalls({ ...base, stateDefault: 0 }), true);
    });
});
