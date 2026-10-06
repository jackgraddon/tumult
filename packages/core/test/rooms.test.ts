import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { sameRoomSummaries, snapshotRooms } from "../src/rooms/snapshot.ts";
import { retryTextMessage, sendTextMessage } from "../src/rooms/send.ts";
import { createFakeChatClient } from "../src/fake/index.ts";

interface StubEvent {
    getStateKey(): string | undefined;
    getContent(): Record<string, unknown>;
}

interface StubRoom {
    roomId: string;
    name: string;
    membership: string;
    space: boolean;
    children: string[];
    /** Children whose m.space.child was emptied (removed from the space). */
    removedChildren?: string[];
    topic?: string;
    avatarMxc?: string;
    unreadTotal: number;
    unreadHighlight: number;
    /** The room's m.fully_read account data, when set. */
    fullyRead?: string;
}

function stubRoom(r: StubRoom): Record<string, unknown> {
    const childEvents: StubEvent[] = [
        ...r.children.map((id) => ({ getStateKey: () => id, getContent: () => ({ via: ["x"] }) })),
        ...(r.removedChildren ?? []).map((id) => ({ getStateKey: () => id, getContent: () => ({}) })),
    ];
    return {
        roomId: r.roomId,
        name: r.name,
        getMyMembership: () => r.membership,
        isSpaceRoom: () => r.space,
        currentState: {
            getStateEvents: (type: string, _key?: string) => {
                if (type === "m.space.child") return childEvents;
                if (type === "m.room.topic") {
                    return r.topic
                        ? { getContent: () => ({ topic: r.topic }) }
                        : null;
                }
                return null;
            },
        },
        getMxcAvatarUrl: () => r.avatarMxc ?? null,
        getUnreadNotificationCount: (kind?: string) =>
            kind === "highlight" ? r.unreadHighlight : r.unreadTotal,
        getAccountData: (type: string) =>
            type === "m.fully_read" && r.fullyRead
                ? { getContent: () => ({ event_id: r.fullyRead }) }
                : undefined,
    };
}

function stubClient(rooms: StubRoom[], avatarHttp: string | null = "https://cdn.example/x.png"): MatrixClient {
    return {
        getRooms: () => rooms.map((r) => stubRoom(r)),
        mxcUrlToHttp: () => avatarHttp,
    } as unknown as MatrixClient;
}

const GUILD = "!g:x";
const GENERAL = "!r:x";

describe("snapshotRooms", () => {
    it("maps names, topics, avatars and unread counts", () => {
        const rooms = snapshotRooms(
            stubClient([
                {
                    roomId: GENERAL,
                    name: "general",
                    membership: "join",
                    space: false,
                    children: [],
                    topic: "hello",
                    avatarMxc: "mxc://x/y",
                    unreadTotal: 5,
                    unreadHighlight: 1,
                    fullyRead: "$read:x",
                },
            ]),
        );
        assert.equal(rooms.length, 1);
        assert.deepEqual(rooms[0], {
            id: GENERAL,
            name: "general",
            topic: "hello",
            // Published as mxc: resolution (with the access token) is the UI's job.
            avatarUrl: "mxc://x/y",
            isSpace: false,
            parentSpaceIds: [],
            unreadCount: 5,
            highlightCount: 1,
            fullyReadEventId: "$read:x",
        });
    });

    it("derives parent links from m.space.child and skips non-joined rooms", () => {
        const rooms = snapshotRooms(
            stubClient([
                {
                    roomId: GUILD,
                    name: "Guild",
                    membership: "join",
                    space: true,
                    children: [GENERAL, "!left:x"],
                    unreadTotal: 0,
                    unreadHighlight: 0,
                },
                {
                    roomId: GENERAL,
                    name: "general",
                    membership: "join",
                    space: false,
                    children: [],
                    unreadTotal: 0,
                    unreadHighlight: 0,
                },
                {
                    roomId: "!left:x",
                    name: "gone",
                    membership: "leave",
                    space: false,
                    children: [],
                    unreadTotal: 0,
                    unreadHighlight: 0,
                },
            ]),
        );
        assert.deepEqual(
            rooms.map((r) => r.id).sort(),
            [GENERAL, GUILD].sort(),
        );
        assert.deepEqual(rooms.find((r) => r.id === GENERAL)?.parentSpaceIds, [GUILD]);
        assert.equal(rooms.find((r) => r.id === GUILD)?.isSpace, true);
    });

    it("nulls missing topics and avatars", () => {
        const rooms = snapshotRooms(
            stubClient(
                [
                    {
                        roomId: GENERAL,
                        name: "general",
                        membership: "join",
                        space: false,
                        children: [],
                        unreadTotal: 0,
                        unreadHighlight: 0,
                    },
                ],
                null,
            ),
        );
        assert.equal(rooms[0]?.topic, null);
        assert.equal(rooms[0]?.avatarUrl, null);
    });

    it("ignores m.space.child events emptied by removal (no via)", () => {
        const rooms = snapshotRooms(
            stubClient([
                { roomId: GUILD, name: "Guild", membership: "join", space: true, children: [], removedChildren: [GENERAL], unreadTotal: 0, unreadHighlight: 0 },
                { roomId: GENERAL, name: "general", membership: "join", space: false, children: [], unreadTotal: 0, unreadHighlight: 0 },
            ]),
        );
        assert.deepEqual(rooms.find((r) => r.id === GENERAL)?.parentSpaceIds, []);
    });
});

describe("sameRoomSummaries", () => {
    const a = {
        id: "!r:x",
        name: "general",
        topic: null,
        avatarUrl: null,
        isSpace: false,
        parentSpaceIds: ["!g:x"],
        unreadCount: 1,
        highlightCount: 0,
        fullyReadEventId: null,
    };
    it("is true for identical snapshots", () => {
        assert.equal(sameRoomSummaries([a], [{ ...a }]), true);
        assert.equal(sameRoomSummaries([], []), true);
    });
    it("is false on length, unread, parent, name or marker change", () => {
        assert.equal(sameRoomSummaries([a], []), false);
        assert.equal(sameRoomSummaries([a], [{ ...a, unreadCount: 2 }]), false);
        assert.equal(sameRoomSummaries([a], [{ ...a, parentSpaceIds: [] }]), false);
        assert.equal(sameRoomSummaries([a], [{ ...a, name: "random" }]), false);
        // The divider anchor is account data: republish when it moves.
        assert.equal(sameRoomSummaries([a], [{ ...a, fullyReadEventId: "$x:x" }]), false);
    });
});

describe("sendTextMessage", () => {
    it("sends an m.text event to the room", async () => {
        const calls: unknown[][] = [];
        const matrix = {
            sendMessage: async (...args: unknown[]) => {
                calls.push(args);
                return { event_id: "$sent:x" };
            },
        } as unknown as MatrixClient;
        await sendTextMessage(matrix, "!r:x", "hello there");
        assert.deepEqual(calls, [["!r:x", { msgtype: "m.text", body: "hello there" }]]);
    });

    it("propagates server failures", async () => {
        const matrix = {
            sendMessage: async () => {
                throw new Error("M_FORBIDDEN");
            },
        } as unknown as MatrixClient;
        await assert.rejects(() => sendTextMessage(matrix, "!r:x", "nope"), /M_FORBIDDEN/);
    });
});

describe("retryTextMessage", () => {
    it("re-sends the pending echo via resendEvent(event, room)", async () => {
        const event = { getId: () => "$failed:x" };
        const room = { getPendingEvents: () => [event] };
        const resends: unknown[][] = [];
        const matrix = {
            getRoom: (id: string) => (id === "!r:x" ? room : null),
            resendEvent: (...args: unknown[]) => {
                resends.push(args);
            },
        } as unknown as MatrixClient;
        await retryTextMessage(matrix, "!r:x", "$failed:x");
        assert.equal(resends.length, 1, "resendEvent called exactly once");
        assert.equal(resends[0]?.[0], event, "the failed event is re-sent");
        assert.equal(resends[0]?.[1], room, "the room is passed through");
    });

    it("rejects when the room is unknown", async () => {
        const matrix = { getRoom: () => null } as unknown as MatrixClient;
        await assert.rejects(() => retryTextMessage(matrix, "!gone:x", "$e:x"), /No such room/);
    });

    it("rejects when the event is not a pending echo", async () => {
        const matrix = {
            getRoom: () => ({ getPendingEvents: () => [] }),
        } as unknown as MatrixClient;
        await assert.rejects(() => retryTextMessage(matrix, "!r:x", "$e:x"), /No failed event/);
    });
});

describe("fake client retry", () => {
    it("flips a failed fixture message back to sending → sent", async () => {
        const client = createFakeChatClient();
        const room = client.rooms.get().find((r) => {
            const timeline = client.timeline(r.id).get();
            return timeline.some((m) => m.status === "failed");
        });
        assert.ok(room, "fixture must ship at least one failed message");
        const failed = client.timeline(room.id).get().find((m) => m.status === "failed");
        assert.ok(failed, "the failed message is found");
        await client.retry(room.id, failed.id);
        const inFlight = client.timeline(room.id).get().find((m) => m.id === failed.id);
        assert.equal(inFlight?.status, "sending", "retry republishes SENDING immediately");
        await new Promise((resolve) => setTimeout(resolve, 400));
        const settled = client.timeline(room.id).get().find((m) => m.id === failed.id);
        assert.equal(settled?.status, "sent", "the fixture settles SENT on retry");
    });

    it("is a no-op for messages that are not failed", async () => {
        const client = createFakeChatClient();
        // Spaces have no timeline; pick a real room.
        const room = client.rooms.get().find((r) => !r.isSpace);
        assert.ok(room, "fixture has a non-space room");
        const sent = client.timeline(room.id).get().find((m) => m.status === "sent");
        assert.ok(sent, "fixture has a sent message");
        await client.retry(room.id, sent.id);
        assert.equal(client.timeline(room.id).get().find((m) => m.id === sent.id)?.status, "sent");
    });
});
