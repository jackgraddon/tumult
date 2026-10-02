import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient, Room, RoomMember } from "matrix-js-sdk";

import { TypingTracker } from "../src/typing/tracker.ts";

function member(userId: string, typing: boolean): RoomMember {
    return { userId, typing } as unknown as RoomMember;
}

function room(roomId: string, members: RoomMember[]): Room {
    return { roomId, getMembers: () => members } as unknown as Room;
}

function stubMatrix(rooms: Room[], selfId = "@me:localhost"): MatrixClient {
    const listeners = new Map<string, Set<() => void>>();
    return {
        getUserId: () => selfId,
        getRooms: () => rooms,
        sendTyping: async () => ({}),
        on: (event: string, fn: () => void) => {
            const set = listeners.get(event) ?? new Set();
            set.add(fn);
            listeners.set(event, set);
        },
        removeListener: (event: string, fn: () => void) => {
            listeners.get(event)?.delete(fn);
        },
        emit: (event: string) => {
            for (const fn of listeners.get(event) ?? []) fn();
        },
    } as unknown as MatrixClient;
}

describe("TypingTracker", () => {
    it("collects typing members per room, excluding self", () => {
        const matrix = stubMatrix([
            room("!a", [member("@alice:localhost", true), member("@bob:localhost", false)]),
            room("!b", [member("@me:localhost", true), member("@carol:localhost", true)]),
        ]);
        const tracker = new TypingTracker(matrix);
        assert.deepEqual(tracker.snapshot, {
            rooms: { "!a": ["@alice:localhost"], "!b": ["@carol:localhost"] },
        });
    });

    it("rebuilds on member typing events", () => {
        const alice = member("@alice", false);
        const matrix = stubMatrix([room("!a", [alice])]);
        const tracker = new TypingTracker(matrix);
        assert.deepEqual(tracker.snapshot, { rooms: {} });
        alice.typing = true;
        matrix.emit("RoomMember.typing");
        assert.deepEqual(tracker.snapshot, { rooms: { "!a": ["@alice"] } });
    });

    it("sendTyping issues the request and reflects optimistically", async () => {
        const calls: unknown[][] = [];
        const matrix = {
            ...stubMatrix([]),
            sendTyping: async (...args: unknown[]) => {
                calls.push(args);
                return {};
            },
        } as unknown as MatrixClient;
        const tracker = new TypingTracker(matrix);
        await tracker.sendTyping("!a", true);
        assert.deepEqual(calls, [["!a", true, 20_000]]);
    });

    it("detachAll removes listeners", () => {
        const matrix = stubMatrix([]);
        const tracker = new TypingTracker(matrix);
        tracker.detachAll();
        matrix.emit("RoomMember.typing");
        matrix.emit("sync");
        assert.deepEqual(tracker.snapshot, { rooms: {} });
    });
});
