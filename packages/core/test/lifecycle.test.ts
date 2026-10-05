import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { createFakeChatClient } from "../src/fake/index.ts";
import {
    createChannel,
    createDm,
    createSpace,
    inviteToRoom,
    joinRoom,
    leaveRoom,
    searchUserDirectory,
} from "../src/rooms/lifecycle.ts";
import { selectSpaceTree } from "../src/selectors/spaceTree.ts";

interface CreateRoomOpts {
    name?: string;
    topic?: string;
    preset?: string;
    room_alias_name?: string;
    visibility?: string;
    is_direct?: boolean;
    invite?: string[];
    creation_content?: Record<string, unknown>;
    initial_state?: { type: string; content: Record<string, unknown> }[];
}

interface StateCall {
    roomId: string;
    eventType: string;
    content: Record<string, unknown>;
    stateKey: string | undefined;
}

/** Stub MatrixClient recording createRoom + state-event + account-data calls. */
function lifecycleStub(opts: {
    domain?: string | null;
    direct?: Record<string, string[]>;
    joinReturns?: string;
} = {}): {
    matrix: MatrixClient;
    created: CreateRoomOpts[];
    state: StateCall[];
    accountData: { type: string; content: Record<string, unknown> }[];
    invites: [string, string][];
    leaves: string[];
    joins: string[];
} {
    const created: CreateRoomOpts[] = [];
    const state: StateCall[] = [];
    const accountData: { type: string; content: Record<string, unknown> }[] = [];
    const invites: [string, string][] = [];
    const leaves: string[] = [];
    const joins: string[] = [];
    const matrix = {
        getDomain: () => (opts.domain === undefined ? "localhost" : opts.domain),
        createRoom: async (o: CreateRoomOpts) => {
            created.push(o);
            return { room_id: `!new${created.length}:localhost` };
        },
        sendStateEvent: async (roomId: string, eventType: string, content: Record<string, unknown>, stateKey?: string) => {
            state.push({ roomId, eventType, content, stateKey });
            return { event_id: "$s:localhost" };
        },
        getAccountData: (type: string) =>
            type === "m.direct" && opts.direct !== undefined
                ? { getContent: () => opts.direct }
                : undefined,
        setAccountData: async (type: string, content: Record<string, unknown>) => {
            accountData.push({ type, content });
            return {};
        },
        joinRoom: async (idOrAlias: string) => {
            joins.push(idOrAlias);
            return { roomId: opts.joinReturns ?? "!joined:localhost" };
        },
        leave: async (roomId: string) => {
            leaves.push(roomId);
            return {};
        },
        invite: async (roomId: string, userId: string) => {
            invites.push([roomId, userId]);
            return {};
        },
    } as unknown as MatrixClient;
    return { matrix, created, state, accountData, invites, leaves, joins };
}

describe("createSpace", () => {
    it("creates a room typed as a space", async () => {
        const { matrix, created } = lifecycleStub();
        const roomId = await createSpace(matrix, { name: "Guild", topic: "hello" });
        assert.equal(roomId, "!new1:localhost");
        assert.equal(created.length, 1);
        const opts = created[0]!;
        assert.equal(opts.name, "Guild");
        assert.equal(opts.topic, "hello");
        assert.deepEqual(opts.creation_content, { type: "m.space" });
    });
});

describe("createChannel", () => {
    it("defaults to private with no alias and no encryption state", async () => {
        const { matrix, created, state } = lifecycleStub();
        const roomId = await createChannel(matrix, "!guild:localhost", { name: "general" });
        assert.equal(roomId, "!new1:localhost");
        assert.equal(created[0]!.preset, "private_chat");
        assert.equal(created[0]!.room_alias_name, undefined);
        assert.equal(created[0]!.initial_state, undefined);
        // Only the two link events — no m.room.encryption anywhere.
        assert.deepEqual(
            state.map((s) => s.eventType),
            ["m.space.child", "m.space.parent"],
        );
    });

    it("links child and parent with a non-empty via (snapshot drops empty via)", async () => {
        const { matrix, state } = lifecycleStub();
        await createChannel(matrix, "!guild:localhost", { name: "general" });
        assert.equal(state.length, 2, "both m.space.child and m.space.parent are written");
        const [child, parent] = state;
        assert.equal(child!.roomId, "!guild:localhost");
        assert.equal(child!.eventType, "m.space.child");
        assert.equal(child!.stateKey, "!new1:localhost");
        assert.deepEqual(child!.content, { via: ["localhost"] });
        assert.equal(parent!.roomId, "!new1:localhost");
        assert.equal(parent!.eventType, "m.space.parent");
        assert.equal(parent!.stateKey, "!guild:localhost");
        assert.deepEqual(parent!.content, { via: ["localhost"] });
    });

    it("public visibility sets the preset and the alias localpart", async () => {
        const { matrix, created } = lifecycleStub();
        await createChannel(matrix, "!guild:localhost", {
            name: "town",
            visibility: "public",
            aliasLocalpart: "town-hall",
        });
        assert.equal(created[0]!.preset, "public_chat");
        assert.equal(created[0]!.room_alias_name, "town-hall");
    });

    it("public without an alias omits room_alias_name entirely", async () => {
        const { matrix, created } = lifecycleStub();
        await createChannel(matrix, "!guild:localhost", { name: "town", visibility: "public" });
        assert.equal(created[0]!.room_alias_name, undefined);
        assert.equal(created[0]!.preset, "public_chat");
    });

    it("encrypted puts m.room.encryption in initial_state", async () => {
        const { matrix, created } = lifecycleStub();
        await createChannel(matrix, "!guild:localhost", { name: "secret", encrypted: true });
        assert.deepEqual(created[0]!.initial_state, [
            { type: "m.room.encryption", content: { algorithm: "m.megolm.v1.aes-sha2" } },
        ]);
    });

    it("rejects without a homeserver domain rather than writing a dead link", async () => {
        const { matrix } = lifecycleStub({ domain: null });
        await assert.rejects(() => createChannel(matrix, "!guild:localhost", { name: "x" }), /domain/);
    });
});

describe("createDm", () => {
    it("creates a direct private room inviting the user", async () => {
        const { matrix, created } = lifecycleStub();
        const roomId = await createDm(matrix, { userId: "@bob:localhost" });
        assert.equal(roomId, "!new1:localhost");
        const opts = created[0]!;
        assert.equal(opts.preset, "private_chat");
        assert.equal(opts.is_direct, true);
        assert.deepEqual(opts.invite, ["@bob:localhost"]);
        assert.equal(opts.initial_state, undefined, "unencrypted unless asked");
    });

    it("merges m.direct without dropping other users' entries", async () => {
        const { matrix, accountData } = lifecycleStub({
            direct: { "@carol:localhost": ["!old-c:localhost"] },
        });
        await createDm(matrix, { userId: "@bob:localhost" });
        assert.equal(accountData.length, 1);
        assert.equal(accountData[0]!.type, "m.direct");
        assert.deepEqual(accountData[0]!.content, {
            "@carol:localhost": ["!old-c:localhost"],
            "@bob:localhost": ["!new1:localhost"],
        });
    });

    it("never duplicates an existing room id for the same user", async () => {
        const { matrix, accountData } = lifecycleStub({
            direct: { "@bob:localhost": ["!new1:localhost"] },
        });
        await createDm(matrix, { userId: "@bob:localhost" });
        assert.deepEqual(accountData[0]!.content["@bob:localhost"], ["!new1:localhost"]);
    });

    it("starts m.direct from scratch when the account data is absent", async () => {
        const { matrix, accountData } = lifecycleStub();
        await createDm(matrix, { userId: "@bob:localhost" });
        assert.deepEqual(accountData[0]!.content, { "@bob:localhost": ["!new1:localhost"] });
    });
});

describe("joinRoom / leave / invite", () => {
    it("joinRoom passes id-or-alias through and returns the room id", async () => {
        const { matrix, joins } = lifecycleStub({ joinReturns: "!made:localhost" });
        const roomId = await joinRoom(matrix, "#town:localhost");
        assert.equal(roomId, "!made:localhost");
        assert.deepEqual(joins, ["#town:localhost"]);
    });

    it("leave and invite call the SDK with the exact arguments", async () => {
        const { matrix, leaves, invites } = lifecycleStub();
        await leaveRoom(matrix, "!r:localhost");
        await inviteToRoom(matrix, "!r:localhost", "@bob:localhost");
        assert.deepEqual(leaves, ["!r:localhost"]);
        assert.deepEqual(invites, [["!r:localhost", "@bob:localhost"]]);
    });

    it("propagates homeserver failures", async () => {
        const matrix = {
            leave: async () => {
                throw new Error("M_FORBIDDEN");
            },
        } as unknown as MatrixClient;
        await assert.rejects(() => leaveRoom(matrix, "!r:localhost"), /M_FORBIDDEN/);
    });
});

describe("searchUserDirectory", () => {
    it("maps results and keeps mxc avatars only", async () => {
        const calls: { term: string; limit: number }[] = [];
        const matrix = {
            searchUserDirectory: async (params: { term: string; limit: number }) => {
                calls.push(params);
                return {
                    results: [
                        { user_id: "@bob:localhost", display_name: "Bob", avatar_url: "mxc://localhost/x" },
                        { user_id: "@carol:localhost", display_name: "Carol", avatar_url: "https://evil/leak" },
                        { user_id: "@dave:localhost" },
                    ],
                    limited: false,
                };
            },
        } as unknown as MatrixClient;
        const results = await searchUserDirectory(matrix, "  bo ");
        assert.deepEqual(calls, [{ term: "bo", limit: 10 }]);
        assert.deepEqual(results, [
            { userId: "@bob:localhost", displayName: "Bob", avatarUrl: "mxc://localhost/x" },
            { userId: "@carol:localhost", displayName: "Carol", avatarUrl: null },
            { userId: "@dave:localhost", displayName: "@dave:localhost", avatarUrl: null },
        ]);
    });

    it("short-circuits an empty term without a roundtrip", async () => {
        let called = false;
        const matrix = {
            searchUserDirectory: async () => {
                called = true;
                return { results: [], limited: false };
            },
        } as unknown as MatrixClient;
        assert.deepEqual(await searchUserDirectory(matrix, "   "), []);
        assert.equal(called, false);
    });

    it("passes a custom limit through", async () => {
        const calls: { term: string; limit: number }[] = [];
        const matrix = {
            searchUserDirectory: async (params: { term: string; limit: number }) => {
                calls.push(params);
                return { results: [], limited: false };
            },
        } as unknown as MatrixClient;
        await searchUserDirectory(matrix, "a", 3);
        assert.deepEqual(calls, [{ term: "a", limit: 3 }]);
    });
});

describe("fake lifecycle parity", () => {
    it("createSpace lands a parent-less guild on the rail", async () => {
        const fake = createFakeChatClient();
        const roomId = await fake.createSpace({ name: "New Guild" });
        const tree = selectSpaceTree(fake.rooms.get());
        assert.ok(
            tree.guilds.some((g) => g.room.id === roomId && g.room.name === "New Guild"),
            "new space is a guild",
        );
        assert.deepEqual(fake.rooms.get().find((r) => r.id === roomId)?.parentSpaceIds, []);
    });

    it("createChannel lands under its guild immediately", async () => {
        const fake = createFakeChatClient();
        const roomId = await fake.createChannel("!guild-a:fake", { name: "lifecycle" });
        const tree = selectSpaceTree(fake.rooms.get());
        const guild = tree.guilds.find((g) => g.room.id === "!guild-a:fake");
        assert.ok(guild, "guild A still exists");
        assert.ok(
            guild.rooms.some((r) => r.id === roomId),
            "new channel appears among Guild A's rooms",
        );
    });

    it("createDm lands as an orphan (DMs tab)", async () => {
        const fake = createFakeChatClient();
        const roomId = await fake.createDm({ userId: "@bob:example.com" });
        const tree = selectSpaceTree(fake.rooms.get());
        assert.ok(tree.orphans.some((r) => r.id === roomId));
        assert.ok(tree.guilds.every((g) => g.rooms.every((r) => r.id !== roomId)));
    });

    it("joinRoom returns a known room's id as-is and adopts unknown ones", async () => {
        const fake = createFakeChatClient();
        assert.equal(await fake.joinRoom("!a-general:fake"), "!a-general:fake");
        const fresh = await fake.joinRoom("#somewhere:example.com");
        assert.ok(fake.rooms.get().some((r) => r.id === fresh));
        assert.deepEqual(selectSpaceTree(fake.rooms.get()).orphans.some((r) => r.id === fresh), true);
    });

    it("leave removes the room from the feed and drops its timeline", async () => {
        const fake = createFakeChatClient();
        const before = fake.rooms.get().length;
        await fake.leave("!a-general:fake");
        assert.equal(fake.rooms.get().length, before - 1);
        assert.ok(!fake.rooms.get().some((r) => r.id === "!a-general:fake"));
        assert.deepEqual(fake.timeline("!a-general:fake").get(), [], "timeline cleared for reuse");
    });

    it("leave of an unknown room is a no-op, not a throw", async () => {
        const fake = createFakeChatClient();
        const before = fake.rooms.get().length;
        await fake.leave("!nope:fake");
        assert.equal(fake.rooms.get().length, before);
    });

    it("searchUsers filters the fixture senders by id or name", async () => {
        const fake = createFakeChatClient();
        const byName = await fake.searchUsers("ali");
        assert.ok(byName.some((u) => u.userId === "@alice:example.com"));
        const byId = await fake.searchUsers("@bob:");
        assert.deepEqual(byId.map((u) => u.userId), ["@bob:example.com"]);
        assert.deepEqual(await fake.searchUsers("  "), []);
    });

    it("invite resolves without changing the feed (member list is timeline-derived)", async () => {
        const fake = createFakeChatClient();
        const before = fake.rooms.get().length;
        await fake.invite("!a-general:fake", "@new:example.com");
        assert.equal(fake.rooms.get().length, before);
    });
});
