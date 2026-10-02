import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { sameRoomSummaries, snapshotRooms } from "../src/rooms/snapshot.ts";
import { sendTextMessage } from "../src/rooms/send.ts";

interface StubEvent {
    getStateKey(): string | undefined;
}

interface StubRoom {
    roomId: string;
    name: string;
    membership: string;
    space: boolean;
    children: string[];
    topic?: string;
    avatarMxc?: string;
    unreadTotal: number;
    unreadHighlight: number;
}

function stubRoom(r: StubRoom): Record<string, unknown> {
    const childEvents: StubEvent[] = r.children.map((id) => ({ getStateKey: () => id }));
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
                },
            ]),
        );
        assert.equal(rooms.length, 1);
        assert.deepEqual(rooms[0], {
            id: GENERAL,
            name: "general",
            topic: "hello",
            avatarUrl: "https://cdn.example/x.png",
            isSpace: false,
            parentSpaceIds: [],
            unreadCount: 5,
            highlightCount: 1,
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
    };
    it("is true for identical snapshots", () => {
        assert.equal(sameRoomSummaries([a], [{ ...a }]), true);
        assert.equal(sameRoomSummaries([], []), true);
    });
    it("is false on length, unread, parent or name change", () => {
        assert.equal(sameRoomSummaries([a], []), false);
        assert.equal(sameRoomSummaries([a], [{ ...a, unreadCount: 2 }]), false);
        assert.equal(sameRoomSummaries([a], [{ ...a, parentSpaceIds: [] }]), false);
        assert.equal(sameRoomSummaries([a], [{ ...a, name: "random" }]), false);
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
