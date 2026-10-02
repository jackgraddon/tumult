import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";

import { collectEdits, sendEditMessage } from "../src/rooms/edits.ts";

function editEvent(over: Record<string, unknown> = {}): MatrixEvent {
    return {
        getType: () => "m.room.message",
        isRedacted: () => false,
        getRelation: () => ({ rel_type: "m.replace", event_id: "$target:x" }),
        getContent: () => ({ "m.new_content": { msgtype: "m.text", body: "edited body" } }),
        getSender: () => "@alice:localhost",
        getId: () => "$edit:localhost",
        getStateKey: () => undefined,
        ...over,
    } as unknown as MatrixEvent;
}

describe("collectEdits", () => {
    it("collects the replacement body by target", () => {
        const edits = collectEdits([editEvent()]);
        assert.deepEqual(edits.get("$target:x"), { body: "edited body", senderId: "@alice:localhost" });
    });

    it("latest edit wins", () => {
        const edits = collectEdits([
            editEvent({ getId: () => "$e1" }),
            editEvent({
                getId: () => "$e2",
                getContent: () => ({ "m.new_content": { msgtype: "m.text", body: "second" } }),
            }),
        ]);
        assert.equal(edits.get("$target:x")?.body, "second");
    });

    it("skips redacted, malformed and non-replace events", () => {
        const edits = collectEdits([
            editEvent({ isRedacted: () => true }),
            editEvent({ getRelation: () => ({ rel_type: "m.annotation", event_id: "$target:x", key: "👍" }) }),
            editEvent({ getRelation: () => null }),
            editEvent({ getContent: () => ({}) }),
            editEvent({ getContent: () => ({ "m.new_content": { msgtype: "m.text" } }) }),
            editEvent({ getSender: () => undefined }),
            editEvent({ getType: () => "m.reaction" }),
        ]);
        assert.equal(edits.size, 0);
    });
});

describe("sendEditMessage", () => {
    it("sends an m.replace with fallback body", async () => {
        const calls: unknown[][] = [];
        const matrix = {
            sendMessage: async (...args: unknown[]) => {
                calls.push(args);
                return { event_id: "$sent:x" };
            },
        } as unknown as MatrixClient;
        await sendEditMessage(matrix, "!r:x", "$target:x", "new text");
        assert.deepEqual(calls, [
            [
                "!r:x",
                {
                    msgtype: "m.text",
                    body: "* new text",
                    "m.new_content": { msgtype: "m.text", body: "new text" },
                    "m.relates_to": { rel_type: "m.replace", event_id: "$target:x" },
                },
            ],
        ]);
    });

    it("propagates server failures", async () => {
        const matrix = {
            sendMessage: async () => {
                throw new Error("M_FORBIDDEN");
            },
        } as unknown as MatrixClient;
        await assert.rejects(() => sendEditMessage(matrix, "!r:x", "$t", "nope"), /M_FORBIDDEN/);
    });
});
