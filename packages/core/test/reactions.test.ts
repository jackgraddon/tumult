import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";

import { assignLatestReaders, collectReactions, sameTimeline } from "../src/timeline/feed.ts";
import { toggleReaction } from "../src/rooms/reactions.ts";
import type { MessageView } from "../src/contract.ts";

function reactionEvent(over: Record<string, unknown> = {}): MatrixEvent {
    return {
        getStateKey: () => undefined,
        getType: () => "m.reaction",
        isRedacted: () => false,
        getRelation: () => ({ rel_type: "m.annotation", event_id: "$target:x", key: "👍" }),
        getSender: () => "@alice:localhost",
        getId: () => "$reaction:localhost",
        ...over,
    } as unknown as MatrixEvent;
}

function messageEvent(id = "$target:x"): MatrixEvent {
    return {
        getStateKey: () => undefined,
        getType: () => "m.room.message",
        isRedacted: () => false,
        getRelation: () => null,
        getSender: () => "@alice:localhost",
        getId: () => id,
    } as unknown as MatrixEvent;
}

describe("collectReactions", () => {
    it("groups by target and emoji with sender sets", () => {
        const grouped = collectReactions([
            messageEvent(),
            reactionEvent(),
            reactionEvent({ getSender: () => "@bob:localhost", getId: () => "$r2" }),
            reactionEvent({
                getRelation: () => ({ rel_type: "m.annotation", event_id: "$target:x", key: "❤️" }),
                getId: () => "$r3",
            }),
        ]);
        const target = grouped.get("$target:x");
        assert.ok(target);
        assert.deepEqual([...(target.get("👍") ?? [])].sort(), ["@alice:localhost", "@bob:localhost"]);
        assert.deepEqual([...(target.get("❤️") ?? [])], ["@alice:localhost"]);
    });

    it("skips redacted, state, non-annotation and malformed relations", () => {
        const grouped = collectReactions([
            reactionEvent({ isRedacted: () => true }),
            reactionEvent({ getStateKey: () => "" }),
            reactionEvent({ getType: () => "m.room.message" }),
            reactionEvent({ getRelation: () => ({ rel_type: "m.reference", event_id: "$t", key: "👍" }) }),
            reactionEvent({ getRelation: () => null }),
            reactionEvent({ getRelation: () => ({ rel_type: "m.annotation", key: "👍" }) }),
            reactionEvent({ getSender: () => undefined }),
        ]);
        assert.equal(grouped.size, 0);
    });

    it("dedupes repeat reactions from one sender", () => {
        const grouped = collectReactions([reactionEvent(), reactionEvent({ getId: () => "$r2" })]);
        assert.deepEqual([...(grouped.get("$target:x")?.get("👍") ?? [])], ["@alice:localhost"]);
    });
});

function stubMatrix(events: MatrixEvent[], ownUserId: string | null = "@me:localhost"): {
    matrix: MatrixClient;
    calls: unknown[][];
} {
    const calls: unknown[][] = [];
    const matrix = {
        getUserId: () => ownUserId,
        getRoom: () => ({
            getLiveTimeline: () => ({ getEvents: () => events }),
        }),
        sendEvent: async (...args: unknown[]) => {
            calls.push(["send", ...args]);
            return { event_id: "$sent:x" };
        },
        redactEvent: async (...args: unknown[]) => {
            calls.push(["redact", ...args]);
            return { event_id: "$redacted:x" };
        },
    } as unknown as MatrixClient;
    return { matrix, calls };
}

describe("toggleReaction", () => {
    it("sends when we have not reacted", async () => {
        const { matrix, calls } = stubMatrix([messageEvent()]);
        await toggleReaction(matrix, "!r:x", "$target:x", "👍");
        assert.deepEqual(calls, [
            ["send", "!r:x", "m.reaction", { "m.relates_to": { rel_type: "m.annotation", event_id: "$target:x", key: "👍" } }],
        ]);
    });

    it("redacts our existing reaction", async () => {
        const { matrix, calls } = stubMatrix([
            messageEvent(),
            reactionEvent({ getSender: () => "@me:localhost", getId: () => "$mine" }),
        ]);
        await toggleReaction(matrix, "!r:x", "$target:x", "👍");
        assert.deepEqual(calls, [["redact", "!r:x", "$mine"]]);
    });

    it("ignores other senders, redacted and other-emoji reactions", async () => {
        const { matrix, calls } = stubMatrix([
            reactionEvent({ getSender: () => "@bob:localhost" }),
            reactionEvent({ isRedacted: () => true, getSender: () => "@me:localhost" }),
            reactionEvent({
                getSender: () => "@me:localhost",
                getRelation: () => ({ rel_type: "m.annotation", event_id: "$target:x", key: "❤️" }),
            }),
        ]);
        await toggleReaction(matrix, "!r:x", "$target:x", "👍");
        assert.equal(calls[0]?.[0], "send");
    });

    it("throws for unknown rooms", async () => {
        const matrix = { getRoom: () => null } as unknown as MatrixClient;
        await assert.rejects(() => toggleReaction(matrix, "!nope:x", "$t", "👍"), /Unknown room/);
    });
});

describe("sameTimeline", () => {
    function view(over: Partial<MessageView> = {}): MessageView {
        return {
            id: "$m:x",
            type: "m.room.message",
            senderId: "@alice:localhost",
            body: "hello",
            timestamp: 1,
            status: "sent",
            decryption: "ok",
            content: {},
            reactions: [],
            readBy: [],
            edited: false,
            ...over,
        };
    }

    it("treats body-only changes as different (redaction tombstones)", () => {
        assert.equal(sameTimeline([view()], [view()]), true);
        assert.equal(sameTimeline([view()], [view({ body: "Message deleted." })]), false);
        assert.equal(sameTimeline([view()], [view({ type: "m.sticker" })]), false);
    });

    it("treats reader changes as different", () => {
        assert.equal(sameTimeline([view()], [view({ readBy: ["@bob:localhost"] })]), false);
    });
});

describe("assignLatestReaders", () => {
    const ids = ["$1", "$2", "$3"];
    it("pins each reader to their deepest held message", () => {
        const out = assignLatestReaders(
            ids,
            (id) => (id === "$1" ? ["@a", "@b"] : id === "$3" ? ["@a", "@c"] : []),
        );
        assert.deepEqual(out.get("$3"), ["@a", "@c"]);
        assert.deepEqual(out.get("$2"), []);
        assert.deepEqual(out.get("$1"), ["@b"]);
    });

    it("includes ourselves and sorts", () => {
        const out = assignLatestReaders(ids, () => ["@me", "@z", "@a"]);
        assert.deepEqual(out.get("$3"), ["@a", "@me", "@z"]);
        assert.deepEqual(out.get("$2"), []);
        assert.deepEqual(out.get("$1"), []);
    });

    it("ignores unknown ids", () => {
        const out = assignLatestReaders(ids, () => [], "@me");
        assert.deepEqual(out.get("$1"), []);
    });
});
