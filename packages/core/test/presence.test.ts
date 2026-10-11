import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type MatrixClient } from "matrix-js-sdk";

import { PresencePoller } from "../src/rooms/presence.ts";
import { type PresenceInput } from "../src/rooms/members.ts";

import type { RoomMember } from "matrix-js-sdk";

interface StubRoom {
    members: RoomMember[];
    getMembers: () => RoomMember[];
}

function room(roomId: string, members: RoomMember[]): Room {
    return {
        roomId,
        members,
        getMembers: () => members,
    } as unknown as Room;
}

function matrixWith(rooms: Room[]): MatrixClient & {
    presenceHits: string[];
    getRooms: () => Room[];
    getPresence: (userId: string) => Promise<{ presence: string }>;
} {
    const presenceHits = [] as string[];
    return {
        presenceHits,
        getRooms: () => rooms,
        getPresence: async (userId: string) => {
            presenceHits.push(userId);
            return { presence: "online" };
        },
    } as unknown as MatrixClient;
}

describe("PresencePoller", () => {
    it("polls each joined/invited member once across all rooms", () => {
        const alice = { userId: "@alice:localhost", membership: "join" } as unknown as RoomMember
        const bob = { userId: "@bob:localhost", membership: "join" } as unknown as RoomMember
        const carol = { userId: "@carol:localhost", membership: "invite" } as unknown as RoomMember
        const dave = { userId: "@dave:localhost", membership: "leave" } as unknown as RoomMember
        const membersA = [alice, carol, dave] as unknown as RoomMember[]
        const membersB = [bob, carol] as unknown as RoomMember[]
        const m = matrixWith([room("!a", membersA), room("!b", membersB)])
        const feed: Array<PresenceInput> = [];
        const poller = new PresencePoller(m, (p) => { feed.push(...p) });
        poller.tick();
        // Give the async request a chance to resolve.
        return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
            assert.deepEqual(feed.map((x) => x.userId).sort(), [
                "@alice:localhost",
                "@bob:localhost",
                "@carol:localhost",
            ], "leave excluded; carol is deduped across rooms")
        })
    })

    it("skips a failing request per-user without aborting the poll", async () => {
        const alice = { userId: "@alice:localhost", membership: "join" } as unknown as RoomMember
        const bob = { userId: "@bob:localhost", membership: "join" } as unknown as RoomMember
        const hits: string[] = []
        let failures = 0
        const m = {
            presenceHits: hits,
            getRooms: () => [room("!a", [alice, bob])],
            getPresence: async (userId: string) => {
                hits.push(userId);
                // Fail exactly the first attempt (alice); the poll must skip
                // that user but still resolve everyone else.
                if (failures === 0) { failures++; throw new Error("boom") }
                return { presence: "online" };
            },
        } as unknown as MatrixClient;
        const feed: Array<PresenceInput> = [];
        const poller = new PresencePoller(m, (p) => { feed.push(...p) });
        poller.tick()
        await new Promise((resolve) => setTimeout(resolve, 10));
        const ids = feed.map((x) => x.userId).sort();
        assert.deepEqual(ids, ["@bob:localhost"], "failing alice skipped, bob still resolved");
        assert.ok(!ids.includes("@alice:localhost"), "one unreachable user does not blind the poll");
        const aliceCalls = hits.filter((u) => u === "@alice:localhost").length;
        const bobCalls = hits.filter((u) => u === "@bob:localhost").length;
        assert.equal(failures, 1, "the single failure propagated to exactly one caller");
        assert.equal(bobCalls, 1, "bob was polled once and resolved");
        assert.equal(aliceCalls + bobCalls, 2, "every user is polled exactly once");
    })

    it("deduplicates overlapping ticks running into each other", async () => {
        const alice = { userId: "@alice:localhost", membership: "join" } as unknown as RoomMember
        const hits: string[] = []
        let resolveOnce: (v: { presence: string }) => void = () => {}
        const m = {
            presenceHits: hits,
            getRooms: () => [room("!a", [alice])],
            getPresence: (userId: string) => {
                hits.push(userId);
                // Hold the first call open until both ticks have fired, so the
                // poller's in-flight guard is what suppresses the second call.
                return new Promise((r) => { resolveOnce = r });
            },
        } as unknown as MatrixClient;
        const poller = new PresencePoller(m, () => {});
        const callsBefore = hits.length;
        poller.tick();
        // second tick fires while the first request is still in flight
        poller.tick();
        assert.equal(hits.length, callsBefore + 1, "the in-flight poll suppressed a duplicate call");
        resolveOnce({ presence: "online" });
        await new Promise((resolve) => setTimeout(resolve, 5));
    })

    it("commits a poll wave as a single feed call", async () => {
        const alice = { userId: "@alice:localhost", membership: "join" } as unknown as RoomMember
        const bob = { userId: "@bob:localhost", membership: "join" } as unknown as RoomMember
        const carol = { userId: "@carol:localhost", membership: "join" } as unknown as RoomMember
        const m = matrixWith([room("!a", [alice, bob, carol])])
        let calls = 0
        let committed = 0
        const poller = new PresencePoller(m, (p) => { calls++; committed += p.length })
        poller.tick()
        await new Promise((resolve) => setTimeout(resolve, 10))
        assert.equal(calls, 1, "three responses coalesce into one roster rebuild")
        assert.equal(committed, 3, "every polled user still reaches the sink")
    })

    it("polls priority users every tick and others on the slow cadence", async () => {
        const alice = { userId: "@alice:localhost", membership: "join" } as unknown as RoomMember
        const bob = { userId: "@bob:localhost", membership: "join" } as unknown as RoomMember
        const m = matrixWith([room("!a", [alice, bob])])
        // Only prioritize Alice.
        const poller = new PresencePoller(m, () => {}, 30000, () => ["@alice:localhost"])
        const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

        // Warm-up tick (tick 1) polls everyone so a fresh roster isn't blank.
        poller.tick()
        await settle()
        assert.deepEqual(
            m.presenceHits.slice().sort(),
            ["@alice:localhost", "@bob:localhost"],
            "the warm-up tick polls everyone",
        )

        // A fast tick polls only the on-screen members.
        m.presenceHits.length = 0
        poller.tick() // tick 2
        await settle()
        assert.deepEqual(m.presenceHits, ["@alice:localhost"], "fast ticks poll only priority users")

        // The slow cadence (every 5th tick) refreshes everyone again.
        m.presenceHits.length = 0
        poller.tick() // tick 3
        poller.tick() // tick 4
        poller.tick() // tick 5 -> slow
        await settle()
        assert.ok(m.presenceHits.includes("@bob:localhost"), "the slow tick refreshes non-priority users")
    })
})
