import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventType, type MatrixClient } from "matrix-js-sdk";

import { readSettingsFields, updateRoomSettings } from "../src/rooms/settings.ts";
import { createFakeChatClient } from "../src/fake/index.ts";
import { sameRoomSummaries, snapshotRooms } from "../src/rooms/snapshot.ts";

interface SettingsCalls {
    names: string[];
    topics: string[];
    uploads: Blob[];
    state: Array<{ type: string; content: Record<string, unknown> }>;
}

function stubMatrix(): MatrixClient & SettingsCalls {
    const calls: SettingsCalls = { names: [], topics: [], uploads: [], state: [] };
    const matrix = {
        setRoomName: async (roomId: string, name: string) => {
            calls.names.push(name);
            return { event_id: `e-${calls.names.length}` };
        },
        setRoomTopic: async (roomId: string, topic: string) => {
            calls.topics.push(topic);
            return { event_id: `e-${calls.topics.length}` };
        },
        uploadContent: async (file: Blob) => {
            calls.uploads.push(file);
            return { content_uri: "mxc://up/x" };
        },
        sendStateEvent: async (roomId: string, type: string, content: Record<string, unknown>) => {
            calls.state.push({ type, content });
            return { event_id: `e-${calls.state.length}` };
        },
    };
    return Object.assign(matrix, calls) as unknown as MatrixClient & SettingsCalls;
}

describe("readSettingsFields", () => {
    it("defaults to invite-only shared history with no alias", () => {
        assert.deepEqual(readSettingsFields({}), {
            joinRule: "invite",
            historyVisibility: "shared",
            canonicalAlias: null,
        });
    });

    it("reads live values off the room, mapping SDK enums to contract strings", () => {
        assert.deepEqual(
            readSettingsFields({
                getJoinRule: () => "public",
                getHistoryVisibility: () => "world_readable",
                getCanonicalAlias: () => "#general:example.com",
            }),
            {
                joinRule: "public",
                historyVisibility: "world_readable",
                canonicalAlias: "#general:example.com",
            },
        );
    });

    it("defaults a field whose accessor throws", () => {
        assert.deepEqual(
            readSettingsFields({
                getJoinRule: () => {
                    throw new Error("no state");
                },
                getHistoryVisibility: () => "joined",
            }),
            { joinRule: "invite", historyVisibility: "joined", canonicalAlias: null },
        );
    });
});

describe("updateRoomSettings", () => {
    it("sends only the changed fields", async () => {
        const matrix = stubMatrix();
        await updateRoomSettings(matrix, "!r:x", { name: " renamed " });
        assert.deepEqual(matrix.names, ["renamed"]);
        assert.deepEqual(matrix.topics, []);
        assert.deepEqual(matrix.state, []);
    });

    it("trims the topic and clears it with null", async () => {
        const matrix = stubMatrix();
        await updateRoomSettings(matrix, "!r:x", { topic: "  hello world  " });
        await updateRoomSettings(matrix, "!r:x", { topic: null });
        assert.deepEqual(matrix.topics, ["hello world", ""]);
    });

    it("uploads an avatar before setting the state event, and clears with null", async () => {
        const matrix = stubMatrix();
        const blob = new Blob(["img"], { type: "image/png" });
        await updateRoomSettings(matrix, "!r:x", { avatar: blob });
        assert.equal(matrix.uploads.length, 1);
        assert.deepEqual(matrix.state, [
            { type: EventType.RoomAvatar, content: { url: "mxc://up/x" } },
        ]);

        const cleared = stubMatrix();
        await updateRoomSettings(cleared, "!r:x", { avatar: null });
        assert.equal(cleared.uploads.length, 0);
        assert.deepEqual(cleared.state, [{ type: EventType.RoomAvatar, content: { url: "" } }]);
    });

    it("writes join rule and history visibility as state events", async () => {
        const matrix = stubMatrix();
        await updateRoomSettings(matrix, "!r:x", {
            joinRule: "public",
            historyVisibility: "joined",
        });
        assert.deepEqual(matrix.state, [
            { type: EventType.RoomJoinRules, content: { join_rule: "public" } },
            { type: EventType.RoomHistoryVisibility, content: { history_visibility: "joined" } },
        ]);
    });

    it("sets the canonical alias, and removes it with null or empty", async () => {
        const matrix = stubMatrix();
        await updateRoomSettings(matrix, "!r:x", { canonicalAlias: "  #room:example.com " });
        assert.deepEqual(matrix.state, [
            { type: EventType.RoomCanonicalAlias, content: { alias: "#room:example.com" } },
        ]);

        const removed = stubMatrix();
        await updateRoomSettings(removed, "!r:x", { canonicalAlias: null });
        await updateRoomSettings(removed, "!r:x", { canonicalAlias: "  " });
        assert.deepEqual(removed.state, [
            { type: EventType.RoomCanonicalAlias, content: {} },
            { type: EventType.RoomCanonicalAlias, content: {} },
        ]);
    });

    it("applies earlier fields when a later send fails", async () => {
        const matrix = stubMatrix();
        matrix.sendStateEvent = async (
            _roomId: string,
            _type: string,
            _content: Record<string, unknown>,
        ) => {
            throw new Error("no permission");
        };
        await assert.rejects(
            updateRoomSettings(matrix, "!r:x", { name: "kept", joinRule: "public" }),
            /no permission/,
        );
        assert.deepEqual(matrix.names, ["kept"], "the name was still applied");
    });
});

describe("snapshot settings fields", () => {
    function stubRoom(settings: Record<string, unknown>): Record<string, unknown> {
        return {
            roomId: "!r:x",
            name: "general",
            getMyMembership: () => "join",
            isSpaceRoom: () => false,
            currentState: { getStateEvents: () => null },
            getMxcAvatarUrl: () => null,
            getUnreadNotificationCount: () => 0,
            getAccountData: () => undefined,
            ...settings,
        };
    }

    it("carries join rule, history visibility and canonical alias over the snapshot", () => {
        const [room] = snapshotRooms({
            getRooms: () => [
                stubRoom({
                    getJoinRule: () => "public",
                    getHistoryVisibility: () => "world_readable",
                    getCanonicalAlias: () => "#general:example.com",
                }),
            ],
        } as unknown as MatrixClient);
        assert.equal(room.joinRule, "public");
        assert.equal(room.historyVisibility, "world_readable");
        assert.equal(room.canonicalAlias, "#general:example.com");
    });

    it("republishes when settings change (sameRoomSummaries compares them)", () => {
        const base = {
            id: "!r:x",
            name: "general",
            topic: null,
            avatarUrl: null,
            isSpace: false,
            parentSpaceIds: [],
            unreadCount: 0,
            highlightCount: 0,
            fullyReadEventId: null,
            joinRule: "invite",
            historyVisibility: "shared",
            canonicalAlias: null,
        };
        assert.equal(
            sameRoomSummaries([base], [{ ...base, joinRule: "public" }]),
            false,
            "join rule change must republish",
        );
        assert.equal(
            sameRoomSummaries([base], [{ ...base, canonicalAlias: "#x:y" }]),
            false,
            "alias change must republish",
        );
        assert.equal(
            sameRoomSummaries([base], [{ ...base, historyVisibility: "joined" }]),
            false,
            "history change must republish",
        );
    });
});

describe("fake parity", () => {
    it("mutates the summary feed in place, leaving other rooms untouched", async () => {
        const fake = createFakeChatClient(1337);
        const before = fake.rooms.get().find((r) => r.id === "!a-general:fake");
        assert.equal(before?.joinRule, "public");
        assert.equal(before?.canonicalAlias, "#general:fake");

        await fake.updateRoomSettings("!a-general:fake", {
            name: " renamed-general ",
            joinRule: "invite",
            canonicalAlias: null,
            historyVisibility: "shared",
        });

        const general = fake.rooms.get().find((r) => r.id === "!a-general:fake");
        assert.equal(general?.name, "renamed-general");
        assert.equal(general?.joinRule, "invite");
        assert.equal(general?.canonicalAlias, null);
        assert.equal(general?.historyVisibility, "shared");

        // A different room is untouched, and every room keeps the new fields.
        const other = fake.rooms.get().find((r) => r.id !== "!a-general:fake");
        assert.equal(other?.joinRule, "invite");
        for (const room of fake.rooms.get()) {
            assert.ok(["public", "invite", "knock", "restricted"].includes(room.joinRule));
            assert.ok(
                ["shared", "invited", "joined", "world_readable"].includes(room.historyVisibility),
            );
            assert.ok(typeof room.canonicalAlias === "string" || room.canonicalAlias === null);
        }
    });
});