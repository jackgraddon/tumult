import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    ClientEvent,
    EventType,
    RoomMemberEvent,
    RoomStateEvent,
    SyncState,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
} from "matrix-js-sdk";

import { createFakeChatClient } from "../src/fake/index.ts";
import {
    banMember,
    kickMember,
    PowerLevelsTracker,
    setMemberPowerLevel,
    snapshotBanned,
    snapshotPowerLevels,
    unbanMember,
} from "../src/rooms/moderation.ts";
import { MembersTracker } from "../src/rooms/members.ts";

const selfId = "@me:localhost";
const anyEvent = {} as MatrixEvent;

interface StubMemberInit {
    roomId?: string;
    membership?: string;
    powerLevel?: number;
    rawDisplayName?: string;
}

function member(userId: string, init: StubMemberInit = {}): RoomMember {
    return {
        userId,
        roomId: init.roomId ?? "!a",
        membership: init.membership ?? "join",
        powerLevel: init.powerLevel ?? 0,
        rawDisplayName: init.rawDisplayName ?? userId,
        getMxcAvatarUrl: () => undefined,
    } as unknown as RoomMember;
}

interface StubRoom extends Room {
    members: RoomMember[];
    powerLevels: Record<string, unknown> | undefined;
}

function room(roomId: string, members: RoomMember[], powerLevels?: Record<string, unknown>): StubRoom {
    const stub = {
        roomId,
        members,
        powerLevels,
        getMembers: () => stub.members,
        getMember: (userId: string) => stub.members.find((m) => m.userId === userId) ?? null,
        currentState: {
            getStateEvents: (_type: string, _key: string) =>
                stub.powerLevels ? ({ getContent: () => stub.powerLevels } as unknown as MatrixEvent) : null,
        },
    };
    return stub as unknown as StubRoom;
}

function stubMatrix(rooms: Room[]): MatrixClient & { emit: (event: string, ...args: unknown[]) => void } {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const matrix = {
        getUserId: () => selfId,
        getRoom: (roomId: string) => rooms.find((r) => (r as StubRoom).roomId === roomId),
        getUser: () => undefined,
        on: (event: string, fn: (...args: unknown[]) => void) => {
            const set = listeners.get(event) ?? new Set();
            set.add(fn);
            listeners.set(event, set);
        },
        removeListener: (event: string, fn: (...args: unknown[]) => void) => {
            listeners.get(event)?.delete(fn);
        },
        emit: (event: string, ...args: unknown[]) => {
            for (const fn of listeners.get(event) ?? []) fn(...args);
        },
    };
    return matrix as unknown as MatrixClient & { emit: (event: string, ...args: unknown[]) => void };
}

function powerEvent(roomId: string, content: Record<string, unknown>): MatrixEvent {
    return {
        getType: () => EventType.RoomPowerLevels,
        getRoomId: () => roomId,
        getContent: () => content,
    } as unknown as MatrixEvent;
}

describe("snapshotPowerLevels", () => {
    it("applies spec defaults when the room has no power-levels event", () => {
        const view = snapshotPowerLevels(room("!a", [member(selfId, { powerLevel: 100 })]), selfId);
        assert.equal(view.usersDefault, 0);
        assert.equal(view.eventsDefault, 0);
        assert.equal(view.stateDefault, 50);
        assert.equal(view.ban, 50);
        assert.equal(view.kick, 50);
        assert.equal(view.redact, 50);
        assert.equal(view.invite, 0);
        assert.deepEqual(view.users, {});
        assert.deepEqual(view.events, {});
        assert.equal(view.myPowerLevel, 100);
        assert.equal(view.canKick, true);
        assert.equal(view.canBan, true);
        assert.equal(view.canSetPowerLevel, true);
        assert.equal(view.canEditSettings, true);
    });

    it("parses content and computes the current user's thresholds", () => {
        const content = {
            users: { "@alice:localhost": 75, "@bad:localhost": "nope" },
            users_default: 10,
            state_default: 80,
            ban: 90,
            kick: 60,
            redact: 70,
            invite: 20,
            events: { "m.room.name": 100 },
            events_default: 5,
        };
        const view = snapshotPowerLevels(room("!a", [member(selfId, { powerLevel: 30 })], content), selfId);
        assert.deepEqual(view.users, { "@alice:localhost": 75 }, "malformed user entries are dropped");
        assert.equal(view.usersDefault, 10);
        assert.equal(view.eventsDefault, 5);
        assert.equal(view.stateDefault, 80);
        assert.equal(view.ban, 90);
        assert.equal(view.kick, 60);
        assert.equal(view.redact, 70);
        assert.equal(view.invite, 20);
        assert.deepEqual(view.events, { "m.room.name": 100 });
        assert.equal(view.myPowerLevel, 30);
        assert.equal(view.canKick, false, "30 < kick 60");
        assert.equal(view.canBan, false, "30 < ban 90");
        assert.equal(view.canSetPowerLevel, false, "30 < state_default 80");
        assert.equal(view.canEditSettings, false);
    });

    it("falls back to the raw users map when the self member is not loaded", () => {
        const content = { users: { [selfId]: 42 }, users_default: 7 };
        const view = snapshotPowerLevels(room("!a", [member("@alice:localhost")], content), selfId);
        assert.equal(view.myPowerLevel, 42);

        const fallback = snapshotPowerLevels(room("!a", [member("@alice:localhost")], { users_default: 7 }), selfId);
        assert.equal(fallback.myPowerLevel, 7, "no override → users_default");
    });

    it("treats a non-object events map as empty", () => {
        const view = snapshotPowerLevels(
            room("!a", [member(selfId, { powerLevel: 100 })], { events: "broken" }),
            selfId,
        );
        assert.deepEqual(view.events, {});
    });
});

describe("snapshotBanned", () => {
    it("keeps only banned members, ordered like the roster", () => {
        const members = [
            member(selfId, { powerLevel: 100 }),
            member("@alice:localhost", { membership: "join", powerLevel: 50, rawDisplayName: "Alice" }),
            member("@mallory:localhost", { membership: "ban", powerLevel: 25, rawDisplayName: "Mallory" }),
            member("@zara:localhost", { membership: "ban", powerLevel: 25, rawDisplayName: "Zara" }),
            member("@carol:localhost", { membership: "invite", powerLevel: 0, rawDisplayName: "Carol" }),
            member("@dave:localhost", { membership: "leave", powerLevel: 0, rawDisplayName: "Dave" }),
            member("@nox:localhost", { membership: "knock", powerLevel: 0, rawDisplayName: "Nox" }),
        ];
        const banned = snapshotBanned(room("!a", members), stubMatrix([room("!a", members)]));
        assert.deepEqual(
            banned.map((m) => m.userId),
            ["@mallory:localhost", "@zara:localhost"],
            "only bans, name-sorted within the same power level",
        );
        assert.deepEqual(banned.map((m) => m.membership), ["ban", "ban"]);
        assert.deepEqual(banned.map((m) => m.presence), ["unknown", "unknown"]);
        assert.deepEqual(banned.map((m) => m.lastActiveTs), [null, null]);
        assert.equal(banned[0]?.isSelf, false);
    });
});

describe("PowerLevelsTracker", () => {
    it("publishes a lazy, per-room feed and returns the same observable", () => {
        const tracker = new PowerLevelsTracker(
            stubMatrix([room("!a", [member(selfId, { powerLevel: 100 })]), room("!b", [member(selfId)])]),
        );
        assert.equal(tracker.powerLevels("!a").get()?.myPowerLevel, 100);
        assert.equal(tracker.powerLevels("!a"), tracker.powerLevels("!a"));
        assert.notEqual(tracker.powerLevels("!a"), tracker.powerLevels("!b"));
    });

    it("publishes null for an unknown room instead of inventing thresholds", () => {
        const tracker = new PowerLevelsTracker(stubMatrix([]));
        assert.equal(tracker.powerLevels("!nope").get(), null);
    });

    it("rebuilds on a power-levels state event and ignores unrelated state", () => {
        const roomA = room("!a", [member(selfId, { powerLevel: 30 })]);
        const matrix = stubMatrix([roomA]);
        const tracker = new PowerLevelsTracker(matrix);
        assert.equal(tracker.powerLevels("!a").get()?.canSetPowerLevel, false);

        roomA.powerLevels = { state_default: 20 };
        // The client re-emits RoomStateEvent.Events with (event, state, prev).
        matrix.emit(RoomStateEvent.Events, powerEvent("!a", { state_default: 20 }), {} as unknown, null);
        assert.equal(tracker.powerLevels("!a").get()?.canSetPowerLevel, true, "30 >= state_default 20");

        // A different state event must not trigger a rebuild.
        const before = tracker.powerLevels("!a").get();
        matrix.emit(
            RoomStateEvent.Events,
            { getType: () => "m.room.name", getRoomId: () => "!a" } as unknown as MatrixEvent,
            {} as unknown,
            null,
        );
        assert.equal(tracker.powerLevels("!a").get(), before);
    });

    it("rebuilds on a member power change, a membership change, and every sync", () => {
        const alice = member("@alice:localhost", { powerLevel: 0, rawDisplayName: "Alice" });
        const roomA = room("!a", [member(selfId, { powerLevel: 100 }), alice], {
            users: { "@alice:localhost": 0 },
        });
        const matrix = stubMatrix([roomA]);
        const tracker = new PowerLevelsTracker(matrix);
        assert.equal(tracker.powerLevels("!a").get()?.users["@alice:localhost"], 0);

        // A member power event fires after the content changed; the rebuild
        // reads the new content.
        roomA.powerLevels = { users: { "@alice:localhost": 50 } };
        alice.powerLevel = 50;
        matrix.emit(RoomMemberEvent.PowerLevel, anyEvent, alice);
        assert.equal(tracker.powerLevels("!a").get()?.users["@alice:localhost"], 50);

        // A membership flip is a rebuild trigger too (it can remove the room).
        roomA.powerLevels = { users: { "@alice:localhost": 50 }, state_default: 25 };
        matrix.emit(RoomMemberEvent.Membership, anyEvent, alice, "join");
        assert.equal(tracker.powerLevels("!a").get()?.stateDefault, 25);

        // Sync is the backstop.
        roomA.powerLevels = { users: { "@alice:localhost": 25 } };
        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        assert.equal(tracker.powerLevels("!a").get()?.users["@alice:localhost"], 25);
    });

    it("publishes null when the room disappears", () => {
        const rooms: Room[] = [room("!a", [member(selfId, { powerLevel: 100 })])];
        const matrix = stubMatrix(rooms);
        const tracker = new PowerLevelsTracker(matrix);
        assert.ok(tracker.powerLevels("!a").get());

        rooms.splice(0, rooms.length);
        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        assert.equal(tracker.powerLevels("!a").get(), null);
    });

    it("detachAll stops every listener", () => {
        const alice = member("@alice:localhost", { powerLevel: 0 });
        const roomA = room("!a", [member(selfId, { powerLevel: 100 }), alice]);
        const matrix = stubMatrix([roomA]);
        const tracker = new PowerLevelsTracker(matrix);
        const feed = tracker.powerLevels("!a");
        const before = feed.get();

        tracker.detachAll();
        alice.powerLevel = 50;
        matrix.emit(RoomMemberEvent.PowerLevel, anyEvent, alice);
        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        assert.equal(feed.get(), before);
    });
});

describe("MembersTracker banned feed", () => {
    it("lists bans separately from the roster and rebuilds on a membership change", () => {
        const mallory = member("@mallory:localhost", { membership: "ban", rawDisplayName: "Mallory" });
        const alice = member("@alice:localhost", { rawDisplayName: "Alice" });
        const roomA = room("!a", [member(selfId, { powerLevel: 100 }), alice, mallory]);
        const matrix = stubMatrix([roomA]);
        const tracker = new MembersTracker(matrix);

        assert.deepEqual(tracker.members("!a").get().map((m) => m.userId), [selfId, "@alice:localhost"]);
        assert.deepEqual(tracker.banned("!a").get().map((m) => m.userId), ["@mallory:localhost"]);
        assert.equal(tracker.banned("!a"), tracker.banned("!a"));

        // Banning alice moves her from roster to banned.
        alice.membership = "ban";
        matrix.emit(RoomMemberEvent.Membership, anyEvent, alice, "join");
        assert.deepEqual(tracker.members("!a").get().map((m) => m.userId), [selfId]);
        assert.deepEqual(
            tracker.banned("!a").get().map((m) => m.userId),
            ["@alice:localhost", "@mallory:localhost"],
        );
    });

    it("empties the banned feed when the room disappears", () => {
        const rooms: Room[] = [room("!a", [member(selfId), member("@mallory:localhost", { membership: "ban" })])];
        const matrix = stubMatrix(rooms);
        const tracker = new MembersTracker(matrix);
        assert.equal(tracker.banned("!a").get().length, 1);

        rooms.splice(0, rooms.length);
        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        assert.deepEqual(tracker.banned("!a").get(), []);
    });

    it("detachAll stops banned-feed updates too", () => {
        const mallory = member("@mallory:localhost", { membership: "ban" });
        const roomA = room("!a", [member(selfId), mallory]);
        const matrix = stubMatrix([roomA]);
        const tracker = new MembersTracker(matrix);
        const feed = tracker.banned("!a");
        const before = feed.get();

        tracker.detachAll();
        mallory.membership = "leave";
        matrix.emit(RoomMemberEvent.Membership, anyEvent, mallory, "ban");
        assert.equal(feed.get(), before);
    });
});

describe("moderation writers", () => {
    it("routes each action to its SDK method with the right arguments", async () => {
        const calls: Array<[string, ...unknown[]]> = [];
        const matrix = {
            kick: async (...args: unknown[]) => {
                calls.push(["kick", ...args]);
            },
            ban: async (...args: unknown[]) => {
                calls.push(["ban", ...args]);
            },
            unban: async (...args: unknown[]) => {
                calls.push(["unban", ...args]);
            },
            setPowerLevel: async (...args: unknown[]) => {
                calls.push(["setPowerLevel", ...args]);
            },
        } as unknown as MatrixClient;

        await kickMember(matrix, "!a", "@bob:localhost", "spam");
        await banMember(matrix, "!a", "@bob:localhost", "spam");
        await unbanMember(matrix, "!a", "@bob:localhost");
        await setMemberPowerLevel(matrix, "!a", "@bob:localhost", 50);

        assert.deepEqual(calls, [
            ["kick", "!a", "@bob:localhost", "spam"],
            ["ban", "!a", "@bob:localhost", "spam"],
            ["unban", "!a", "@bob:localhost"],
            ["setPowerLevel", "!a", "@bob:localhost", 50],
        ]);
    });

    it("omits the reason when none is given", async () => {
        const calls: unknown[][] = [];
        const matrix = {
            kick: async (...args: unknown[]) => {
                calls.push(args);
            },
        } as unknown as MatrixClient;
        await kickMember(matrix, "!a", "@bob:localhost");
        assert.deepEqual(calls, [["!a", "@bob:localhost", undefined]]);
    });
});

describe("fake parity", () => {
    it("demotes to a banned section without leaking into the roster", async () => {
        const fake = createFakeChatClient();
        const general = "!a-general:fake";

        assert.ok(fake.banned(general).get().some((m) => m.userId === "@mallory:example.com"));
        assert.ok(!fake.members(general).get().some((m) => m.userId === "@mallory:example.com"));

        await fake.unban(general, "@mallory:example.com");
        assert.deepEqual(fake.banned(general).get(), []);
        assert.ok(!fake.members(general).get().some((m) => m.userId === "@mallory:example.com"));
    });

    it("kick removes from the roster; ban moves to banned; unban drops out", async () => {
        const fake = createFakeChatClient();
        const roomId = "!a-general:fake";

        await fake.kick(roomId, "@carol:example.com");
        assert.ok(!fake.members(roomId).get().some((m) => m.userId === "@carol:example.com"));

        await fake.ban(roomId, "@bob:example.com");
        assert.ok(!fake.members(roomId).get().some((m) => m.userId === "@bob:example.com"));
        assert.ok(fake.banned(roomId).get().some((m) => m.userId === "@bob:example.com"));

        await fake.unban(roomId, "@bob:example.com");
        assert.ok(!fake.banned(roomId).get().some((m) => m.userId === "@bob:example.com"));
    });

    it("setPowerLevel re-sorts the roster and updates the power feed", async () => {
        const fake = createFakeChatClient();
        const roomId = "!a-general:fake";

        await fake.setPowerLevel(roomId, "@carol:example.com", 50);
        assert.equal(fake.powerLevels(roomId).get()?.users["@carol:example.com"], 50);
        // Carol jumps from 0 to 50, so she sorts above the 0-level invitee.
        const ids = fake.members(roomId).get().map((m) => m.userId);
        assert.ok(ids.indexOf("@carol:example.com") < ids.indexOf("@erin:example.com"));
    });

    it("refuses to moderate self or an equal/higher power level", async () => {
        const fake = createFakeChatClient();
        const roomId = "!a-general:fake";
        await assert.rejects(fake.kick(roomId, "@alice:example.com"), /at or above/);
        await assert.rejects(fake.ban(roomId, "@demo:example.com"), /at or above/);
    });
});
