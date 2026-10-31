import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    ClientEvent,
    RoomMemberEvent,
    SyncState,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
} from "matrix-js-sdk";

import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import { UserVerificationStatus } from "matrix-js-sdk/lib/crypto-api/index.js";

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

/** Mutable membership list, so a lazy load can "arrive" mid-test. */
interface StubRoom extends Room {
    members: RoomMember[];
    loadCalls: number;
    failLoads: boolean;
}

function room(roomId: string, members: RoomMember[]): StubRoom {
    const state = { members, loadCalls: 0, failLoads: false, inflight: undefined as Promise<boolean> | undefined };
    const stub = {
        roomId,
        get members() {
            return state.members;
        },
        set members(value: RoomMember[]) {
            state.members = value;
        },
        getMembers: () => state.members,
        get loadCalls() {
            return state.loadCalls;
        },
        set loadCalls(value: number) {
            state.loadCalls = value;
        },
        get failLoads() {
            return state.failLoads;
        },
        set failLoads(value: boolean) {
            state.failLoads = value;
        },
        // Mirrors the SDK: one shared promise while in flight, cleared on
        // failure so a rejected load can be retried. Only a cache miss is a
        // real fetch.
        loadMembersIfNeeded(): Promise<boolean> {
            if (!state.inflight) {
                state.loadCalls++;
                state.inflight = (async () => {
                    if (state.failLoads) throw new Error("members fetch failed");
                    return true;
                })().finally(() => {
                    state.inflight = undefined;
                });
            }
            return state.inflight;
        },
    };
    return stub as unknown as StubRoom;
}

interface StubUser {
    presence: string;
    lastActiveAgo: number;
}

function stubMatrix(rooms: Room[], crypto?: { getUserVerificationStatus(userId: string): Promise<UserVerificationStatus> }): MatrixClient & { users: Map<string, StubUser> } {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const users = new Map<string, StubUser>();
    const matrix = {
        getUserId: () => selfId,
        getRoom: (roomId: string) => rooms.find((r) => r.roomId === roomId),
        getUser: (userId: string) => users.get(userId),
        getCrypto: () => crypto,
        users,
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
    return matrix as unknown as MatrixClient & { users: Map<string, StubUser> };
}

function presenceEvent(userId: string): MatrixEvent {
    return {
        getType: () => "m.presence",
        getSender: () => userId,
        getContent: () => ({ user_id: userId }),
    } as unknown as MatrixEvent;
}

describe("MembersTracker", () => {
    it("snapshots join and invite members ordered by power level, then name", () => {
        const alice = member("@alice:localhost", { powerLevel: 100, rawDisplayName: "Alice" });
        const self = member(selfId, { powerLevel: 100, rawDisplayName: "Zed" });
        const bob = member("@bob:localhost", { powerLevel: 50, rawDisplayName: "Bob" });
        const carol = member("@carol:localhost", { powerLevel: 0, rawDisplayName: "@carol:localhost" });
        const erin = member("@erin:localhost", { membership: "invite", powerLevel: 0, rawDisplayName: "Erin" });
        const left = member("@dave:localhost", { membership: "leave", rawDisplayName: "Dave" });
        const banned = member("@mallory:localhost", { membership: "ban", rawDisplayName: "Mallory" });
        const knocked = member("@nox:localhost", { membership: "knock", rawDisplayName: "Nox" });
        const tracker = new MembersTracker(
            stubMatrix([room("!a", [self, carol, left, alice, erin, bob, banned, knocked])]),
        );

        const snapshot = tracker.members("!a").get();
        assert.deepEqual(
            snapshot.map((m) => m.userId),
            ["@alice:localhost", selfId, "@bob:localhost", "@carol:localhost", "@erin:localhost"],
            "power desc, then name; leave/ban/knock never reach a roster",
        );
        assert.deepEqual(
            snapshot.map((m) => m.membership),
            ["join", "join", "join", "join", "invite"],
        );
        assert.deepEqual(
            snapshot.map((m) => m.isSelf),
            [false, true, false, false, false],
        );
        assert.deepEqual(
            snapshot.map((m) => m.displayName),
            ["Alice", "Zed", "Bob", "carol", "Erin"],
            "unnamed members fall back to the localpart, never disambiguated",
        );
        assert.deepEqual(
            snapshot.map((m) => m.powerLevel),
            [100, 100, 50, 0, 0],
        );
        assert.equal(snapshot[1]?.avatarUrl, null);
    });

    it("presence stays unknown until a live sync commits it", () => {
        const roomA = room("!a", [member(selfId, { powerLevel: 100 }), member("@alice:localhost", { rawDisplayName: "Alice" })]);
        const matrix = stubMatrix([roomA]);
        matrix.users.set("@alice:localhost", { presence: "online", lastActiveAgo: 1000 });
        const tracker = new MembersTracker(matrix);

        const before = tracker.members("!a").get().find((m) => m.userId === "@alice:localhost");
        assert.equal(before?.presence, "unknown", "a presence object alone proves nothing");
        assert.equal(before?.lastActiveTs, null);

        // A presence event queues the user; it is not live until a sync
        // response boundary says it came from a live batch.
        matrix.emit(ClientEvent.Event, presenceEvent("@alice:localhost"));
        assert.equal(
            tracker.members("!a").get().find((m) => m.userId === "@alice:localhost")?.presence,
            "unknown",
            "queued but not committed",
        );

        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        const after = tracker.members("!a").get().find((m) => m.userId === "@alice:localhost");
        assert.equal(after?.presence, "online");
        assert.ok(
            after?.lastActiveTs !== null && Math.abs(after.lastActiveTs - (Date.now() - 1000)) < 5000,
            `lastActiveTs tracks last_active_ago, got ${after?.lastActiveTs}`,
        );

        // Our own row is NOT read from the SDK's User: it mirrors the client's
        // ownPresence snapshot, so it agrees with the user bar.
        const self = () => tracker.members("!a").get().find((m) => m.isSelf);
        assert.equal(self()?.presence, "unknown", "no own snapshot yet");
        tracker.setSelfPresence("unavailable");
        assert.equal(self()?.presence, "unavailable");
        tracker.setSelfPresence("online");
        assert.equal(self()?.presence, "online");
    });

    it("keeps a member's away (unavailable) distinct from offline", () => {
        const roomA = room("!a", [member("@alice:localhost", { rawDisplayName: "Alice" })]);
        const matrix = stubMatrix([roomA]);
        matrix.users.set("@alice:localhost", { presence: "unavailable", lastActiveAgo: 1000 });
        const tracker = new MembersTracker(matrix);
        tracker.members("!a");
        tracker.applyPollPresence([{ userId: "@alice:localhost" }]);
        assert.equal(tracker.members("!a").get()[0]?.presence, "unavailable");
    });

    it("drops presence queued from the cached first sync", () => {
        const roomA = room("!a", [member(selfId, { powerLevel: 100 }), member("@alice:localhost", { rawDisplayName: "Alice" })]);
        const matrix = stubMatrix([roomA]);
        matrix.users.set("@alice:localhost", { presence: "online", lastActiveAgo: 1000 });
        const tracker = new MembersTracker(matrix);

        matrix.emit(ClientEvent.Event, presenceEvent("@alice:localhost"));
        matrix.emit(ClientEvent.Sync, SyncState.Prepared, null, { fromCache: true });
        assert.equal(
            tracker.members("!a").get().find((m) => m.userId === "@alice:localhost")?.presence,
            "unknown",
            "replayed cache presence must never look live",
        );

        // The next live batch carries it (or any real change): commit.
        matrix.emit(ClientEvent.Event, presenceEvent("@alice:localhost"));
        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Prepared);
        assert.equal(tracker.members("!a").get().find((m) => m.userId === "@alice:localhost")?.presence, "online");
    });

    it("rebuilds a room's feed on member membership, name and power-level events", () => {
        const alice = member("@alice:localhost", { powerLevel: 0, rawDisplayName: "Alice" });
        const dave = member("@dave:localhost", { membership: "leave", powerLevel: 0, rawDisplayName: "Dave" });
        const roomA = room("!a", [member(selfId, { powerLevel: 100 }), alice, dave]);
        const matrix = stubMatrix([roomA]);
        const tracker = new MembersTracker(matrix);

        assert.deepEqual(
            tracker.members("!a").get().map((m) => m.userId),
            [selfId, "@alice:localhost"],
        );

        // A power-level change re-sorts: alice ties self's 100 and wins the
        // display-name tie-break.
        alice.powerLevel = 100;
        matrix.emit(RoomMemberEvent.PowerLevel, anyEvent, alice);
        assert.equal(tracker.members("!a").get()[0]?.userId, "@alice:localhost");

        // A rename lands under the same rebuild rule.
        alice.rawDisplayName = "Alicia";
        matrix.emit(RoomMemberEvent.Name, anyEvent, alice, "Alice");
        assert.equal(tracker.members("!a").get()[0]?.displayName, "Alicia");

        // A leave→join flip brings dave into the roster.
        dave.membership = "join";
        matrix.emit(RoomMemberEvent.Membership, anyEvent, dave, "leave");
        assert.ok(tracker.members("!a").get().some((m) => m.userId === "@dave:localhost"));
    });

    it("returns the same observable per room", () => {
        const tracker = new MembersTracker(stubMatrix([room("!a", [member(selfId)]), room("!b", [member(selfId)])]));
        assert.equal(tracker.members("!a"), tracker.members("!a"));
        assert.notEqual(tracker.members("!a"), tracker.members("!b"));
    });

    it("loadMembers completes a partial roster, collapsing concurrent calls", async () => {
        const roomA = room("!a", [member(selfId, { powerLevel: 100 })]);
        const tracker = new MembersTracker(stubMatrix([roomA]));

        assert.equal(tracker.members("!a").get().length, 1, "lazy sync ships only who has spoken");

        // The SDK collapses loadMembersIfNeeded() onto one in-flight promise,
        // so concurrent pane opens make one request.
        await Promise.all([tracker.loadMembers("!a"), tracker.loadMembers("!a")]);
        assert.equal(roomA.loadCalls, 1);

        roomA.members = [
            ...roomA.members,
            member("@alice:localhost", { powerLevel: 50, rawDisplayName: "Alice" }),
            member("@bob:localhost", { powerLevel: 0, rawDisplayName: "Bob" }),
        ];
        await tracker.loadMembers("!a");
        assert.deepEqual(
            tracker.members("!a").get().map((m) => m.userId),
            [selfId, "@alice:localhost", "@bob:localhost"],
        );
    });

    it("loadMembers rejects for an unknown room", async () => {
        const tracker = new MembersTracker(stubMatrix([]));
        await assert.rejects(tracker.loadMembers("!nope"), /unknown room/);
    });

    it("loadMembers rejection propagates and keeps the partial roster", async () => {
        const roomA = room("!a", [member(selfId, { powerLevel: 100 })]);
        const tracker = new MembersTracker(stubMatrix([roomA]));
        const before = tracker.members("!a").get();

        roomA.failLoads = true;
        await assert.rejects(tracker.loadMembers("!a"), /members fetch failed/);
        assert.equal(tracker.members("!a").get(), before, "a failed load never pretends completeness");

        // The SDK clears the failed promise, so a retry is a real attempt.
        roomA.failLoads = false;
        await tracker.loadMembers("!a");
        assert.equal(roomA.loadCalls, 2);
    });

    it("publishes an empty roster when the room disappears, and fills it when it arrives", () => {
        const rooms: Room[] = [room("!a", [member(selfId)])];
        const matrix = stubMatrix(rooms);
        const tracker = new MembersTracker(matrix);

        assert.deepEqual(tracker.members("!a").get().map((m) => m.userId), [selfId]);

        rooms.splice(0, rooms.length);
        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        assert.deepEqual(tracker.members("!a").get(), [], "leaving the room empties the roster");

        rooms.push(room("!a", [member(selfId), member("@alice:localhost", { rawDisplayName: "Alice" })]));
        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        assert.deepEqual(
            tracker.members("!a").get().map((m) => m.userId),
            ["@alice:localhost", selfId],
            "same ordering guarantee on the way back in",
        );
    });

    it("detachAll stops every listener", () => {
        const alice = member("@alice:localhost", { powerLevel: 0, rawDisplayName: "Alice" });
        const roomA = room("!a", [member(selfId, { powerLevel: 100 }), alice]);
        const matrix = stubMatrix([roomA]);
        matrix.users.set("@alice:localhost", { presence: "online", lastActiveAgo: 1000 });
        const tracker = new MembersTracker(matrix);
        const feed = tracker.members("!a");
        const before = feed.get();

        tracker.detachAll();

        alice.powerLevel = 90;
        matrix.emit(RoomMemberEvent.PowerLevel, anyEvent, alice);
        matrix.emit(ClientEvent.Event, presenceEvent("@alice:localhost"));
        matrix.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        assert.equal(feed.get(), before, "detached listeners rebuild nothing");
    });

    it("applyPollPresence marks a user live and rebuilds — the SSS poll path", () => {
        const alice = member("@alice:localhost", { powerLevel: 0, rawDisplayName: "Alice" });
        const roomA = room("!a", [member(selfId, { powerLevel: 100 }), alice]);
        const matrix = stubMatrix([roomA]);
        matrix.users.set("@alice:localhost", { presence: "online", lastActiveAgo: 1000 });
        const tracker = new MembersTracker(matrix);
        const feed = tracker.members("!a");
        assert.equal(feed.get().find((m) => m.userId === "@alice:localhost")?.presence, "unknown");

        // The REST poll only hands back the id; the tracker marks it live and
        // the already-populated User (getPresence() populated it) is read.
        assert.equal(tracker.applyPollPresence([{ userId: "@alice:localhost" }]), true);
        const after = feed.get().find((m) => m.userId === "@alice:localhost");
        assert.equal(after?.presence, "online");
        assert.ok(after?.lastActiveTs !== null, "live activity time surfaces");

        assert.equal(tracker.applyPollPresence([]), false, "empty payload rebuilds nothing");
        const before = feed.get();
        tracker.applyPollPresence([{ userId: "@carol:localhost" }]);
        assert.notEqual(feed.get(), before, "a new live user still rebuilds");
    });
});

describe("MembersTracker identity trust", () => {
    // (crossSigningVerified, crossSigningVerifiedBefore, known, needsUserApproval),
    // built exactly as rust-crypto's getUserVerificationStatus does: (false,
    // false, false) for "no identity", (…, true, …) for a known one.
    const verified = new UserVerificationStatus(true, true, true);
    const unverified = new UserVerificationStatus(false, false, true);
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const trustOf = (tracker: MembersTracker, userId: string): string | undefined =>
        tracker.members("!a").get().find((m) => m.userId === userId)?.verification;

    it("starts unknown and fills in what the crypto layer says, one lookup per user", async () => {
        const asked: string[] = [];
        const statuses: Record<string, UserVerificationStatus> = { "@alice:localhost": verified, "@bob:localhost": unverified };
        const crypto = {
            getUserVerificationStatus: async (userId: string) => {
                asked.push(userId);
                return statuses[userId] ?? new UserVerificationStatus(false, false, false);
            },
        };
        const tracker = new MembersTracker(stubMatrix([room("!a", [member("@alice:localhost"), member("@bob:localhost")])], crypto));
        assert.equal(trustOf(tracker, "@alice:localhost"), "unknown", "never a guess before the answer");
        await settle();
        assert.equal(trustOf(tracker, "@alice:localhost"), "verified");
        tracker.members("!a"); // a rebuild must not ask again
        await settle();
        assert.deepEqual(asked.sort(), ["@alice:localhost", "@bob:localhost"]);
    });

    it("keeps a user with no known identity unknown, not unverified", async () => {
        assert.equal(new UserVerificationStatus(false, false, false).known, false, "precondition: the SDK's 'no identity' shape");
        const crypto = { getUserVerificationStatus: async () => new UserVerificationStatus(false, false, false) };
        const tracker = new MembersTracker(stubMatrix([room("!a", [member("@carol:localhost")])], crypto));
        tracker.members("!a");
        await settle();
        assert.equal(trustOf(tracker, "@carol:localhost"), "unknown");
    });

    it("republishes when the crypto layer reports a trust change", async () => {
        const crypto = { getUserVerificationStatus: async () => unverified };
        const matrix = stubMatrix([room("!a", [member("@bob:localhost")])], crypto);
        const tracker = new MembersTracker(matrix);
        tracker.members("!a");
        await settle();
        assert.equal(trustOf(tracker, "@bob:localhost"), "unverified");
        matrix.emit(CryptoEvent.UserTrustStatusChanged, "@bob:localhost", verified);
        assert.equal(trustOf(tracker, "@bob:localhost"), "verified");
    });

    it("asks nothing and says unknown without crypto", async () => {
        const tracker = new MembersTracker(stubMatrix([room("!a", [member("@alice:localhost")])]));
        await settle();
        assert.equal(trustOf(tracker, "@alice:localhost"), "unknown");
    });
});
