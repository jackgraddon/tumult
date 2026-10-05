import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import type { MessageView } from "../src/contract.ts";
import { createFakeChatClient } from "../src/fake/index.ts";
import { applyReplyQuotes, sameTimeline } from "../src/timeline/feed.ts";
import { mapEvent, replyTargetId, stripReplyFallback, type MappableEvent } from "../src/timeline/map.ts";
import { buildReplyBody, sendTextMessage } from "../src/rooms/send.ts";

function stub(over: Partial<MappableEvent> = {}): MappableEvent {
    return {
        getId: () => "$reply:localhost",
        getType: () => "m.room.message",
        getSender: () => "@bob:localhost",
        getTs: () => 1700000000000,
        getContent: () => ({ msgtype: "m.text", body: "hello" }),
        isEncrypted: () => false,
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        status: null,
        clearEvent: {},
        ...over,
    };
}

describe("stripReplyFallback", () => {
    it("strips the spec example: mention on the first line, blank separator dropped", () => {
        const body = [
            "> <@alice:example.org> This is the first line",
            "> This is the second line",
            "",
            "This is the reply",
        ].join("\n");
        const out = stripReplyFallback(body);
        assert.equal(out.senderId, "@alice:example.org");
        assert.equal(out.body, "This is the reply");
    });

    it("keeps a multi-line reply intact", () => {
        const out = stripReplyFallback("> <@a:x> quoted\n> more quoted\n\nreply line 1\nreply line 2");
        assert.equal(out.senderId, "@a:x");
        assert.equal(out.body, "reply line 1\nreply line 2");
    });

    it("returns a fallback-free body unchanged with an empty sender", () => {
        assert.deepEqual(stripReplyFallback("just text"), { senderId: "", body: "just text" });
    });

    it("handles an empty quoted first line", () => {
        const out = stripReplyFallback("> <@alice:x>\n\nhi");
        assert.equal(out.senderId, "@alice:x");
        assert.equal(out.body, "hi");
    });
});

describe("replyTargetId", () => {
    it("reads a bare m.in_reply_to relation (no rel_type)", () => {
        assert.equal(replyTargetId({ "m.relates_to": { "m.in_reply_to": { event_id: "$t" } } }), "$t");
    });

    it("ignores content with no relation", () => {
        assert.equal(replyTargetId({ msgtype: "m.text", body: "hi" }), null);
        assert.equal(replyTargetId({ "m.relates_to": {} }), null);
        assert.equal(replyTargetId({ "m.relates_to": { "m.in_reply_to": {} } }), null);
    });

    it("skips the SDK's automatic thread fallback (every thread message has one)", () => {
        assert.equal(
            replyTargetId({
                "m.relates_to": {
                    rel_type: "m.thread",
                    event_id: "$root",
                    is_falling_back: true,
                    "m.in_reply_to": { event_id: "$root" },
                },
            }),
            null,
        );
    });

    it("keeps an explicit reply inside a thread (is_falling_back false)", () => {
        assert.equal(
            replyTargetId({
                "m.relates_to": {
                    rel_type: "m.thread",
                    event_id: "$root",
                    is_falling_back: false,
                    "m.in_reply_to": { event_id: "$prev" },
                },
            }),
            "$prev",
        );
    });
});

describe("mapEvent replies", () => {
    it("extracts the quote, strips the fallback and renders the reply text", () => {
        const m = mapEvent(
            stub({
                getContent: () => ({
                    msgtype: "m.text",
                    body: "> <@alice:localhost> original line\n\nthe reply",
                    "m.relates_to": { "m.in_reply_to": { event_id: "$target:localhost" } },
                }),
            }),
        );
        assert.equal(m.body, "the reply");
        assert.deepEqual(m.reply, {
            eventId: "$target:localhost",
            senderId: "@alice:localhost",
            senderName: "@alice:localhost",
            body: "the reply",
        });
    });

    it("leaves a plain message that starts with '> ' verbatim", () => {
        const m = mapEvent(stub({ getContent: () => ({ msgtype: "m.text", body: "> quoted thought" }) }));
        assert.equal(m.body, "> quoted thought");
        assert.equal(m.reply, null);
    });

    it("keeps the relation when the sender omitted the fallback", () => {
        const m = mapEvent(
            stub({
                getContent: () => ({
                    msgtype: "m.text",
                    body: "no fallback here",
                    "m.relates_to": { "m.in_reply_to": { event_id: "$target" } },
                }),
            }),
        );
        assert.equal(m.body, "no fallback here");
        assert.equal(m.reply?.eventId, "$target");
        assert.equal(m.reply?.senderId, "");
        assert.equal(m.reply?.body, "no fallback here");
    });

    it("drops the reply on a redacted event", () => {
        const m = mapEvent(
            stub({
                isRedacted: () => true,
                getContent: () => ({
                    "m.relates_to": { "m.in_reply_to": { event_id: "$target" } },
                }),
            }),
        );
        assert.equal(m.reply, null);
        assert.equal(m.body, "Message deleted.");
    });
});

function view(over: Partial<MessageView> = {}): MessageView {
    return {
        id: "$m:x",
        type: "m.room.message",
        senderId: "@alice:localhost",
        senderName: "@alice:localhost",
        senderAvatarUrl: null,
        body: "hello",
        timestamp: 1,
        status: "sent",
        decryption: "ok",
        content: {},
        edited: false,
        redacted: false,
        reply: null,
        reactions: [],
        readBy: [],
        ...over,
    };
}

describe("applyReplyQuotes", () => {
    it("upgrades a fallback quote with the target's authoritative values", () => {
        const target = view({ id: "$t", body: "edited body", senderName: "Alice" });
        const reply = view({
            id: "$r",
            reply: { eventId: "$t", senderId: "@alice:localhost", senderName: "@alice:localhost", body: "stale" },
        });
        applyReplyQuotes([target, reply]);
        assert.deepEqual(reply.reply, {
            eventId: "$t",
            senderId: "@alice:localhost",
            senderName: "Alice",
            body: "edited body",
        });
    });

    it("keeps the fallback quote when the target is outside the window", () => {
        const fallback = { eventId: "$unseen", senderId: "@a:x", senderName: "@a:x", body: "quoted" };
        const reply = view({ id: "$r", reply: { ...fallback } });
        applyReplyQuotes([reply]);
        assert.deepEqual(reply.reply, fallback);
    });

    it("keeps the fallback quote over an undecrypted target (the fallback predates encryption)", () => {
        const target = view({ id: "$t", decryption: "pending", body: "[m.room.encrypted]" });
        const reply = view({
            id: "$r",
            reply: { eventId: "$t", senderId: "@a:x", senderName: "@a:x", body: "plaintext from fallback" },
        });
        applyReplyQuotes([target, reply]);
        assert.equal(reply.reply?.body, "plaintext from fallback");
    });
});

describe("sameTimeline reply comparison", () => {
    it("treats quote enrichment as a change", () => {
        const quote = { eventId: "$t", senderId: "@a:x", senderName: "A", body: "old" };
        assert.equal(sameTimeline([view({ reply: { ...quote } })], [view({ reply: { ...quote } })]), true);
        assert.equal(sameTimeline([view()], [view({ reply: { ...quote } })]), false);
        assert.equal(
            sameTimeline([view({ reply: { ...quote } })], [view({ reply: { ...quote, body: "new" } })]),
            false,
        );
    });
});

describe("buildReplyBody", () => {
    it("quotes every line, mentioning the sender on the first", () => {
        assert.equal(
            buildReplyBody("line one\nline two", "the reply", "@alice:example.org"),
            "> <@alice:example.org> line one\n> line two\n\nthe reply",
        );
    });

    it("omits the mention when the sender is unknown", () => {
        assert.equal(buildReplyBody("orig", "reply", ""), "> orig\n\nreply");
    });
});

describe("sendTextMessage", () => {
    function stubSend(
        target?: { getSender(): string | undefined; getContent(): Record<string, unknown>; isRedacted(): boolean } | null,
    ) {
        const calls: Array<[string, Record<string, unknown>]> = [];
        const matrix = {
            sendMessage: async (roomId: string, content: Record<string, unknown>) => {
                calls.push([roomId, content]);
                return { event_id: "$sent:localhost" };
            },
            getRoom: () => (target ? { findEventById: () => target } : null),
        } as unknown as MatrixClient;
        return { matrix, calls };
    }

    it("sends a plain message untouched without a reply target", async () => {
        const { matrix, calls } = stubSend();
        await sendTextMessage(matrix, "!r:x", "hello");
        assert.deepEqual(calls, [["!r:x", { msgtype: "m.text", body: "hello" }]]);
    });

    it("sends a rich reply: fallback body, relation and mention", async () => {
        const { matrix, calls } = stubSend({
            getSender: () => "@alice:localhost",
            getContent: () => ({ msgtype: "m.text", body: "original line" }),
            isRedacted: () => false,
        });
        await sendTextMessage(matrix, "!r:x", "the reply", "$target:x");
        assert.deepEqual(calls, [
            [
                "!r:x",
                {
                    msgtype: "m.text",
                    body: "> <@alice:localhost> original line\n\nthe reply",
                    "m.relates_to": { "m.in_reply_to": { event_id: "$target:x" } },
                    "m.mentions": { user_ids: ["@alice:localhost"] },
                },
            ],
        ]);
    });

    it("still relates when the target isn't loaded (no fallback, no mention)", async () => {
        const { matrix, calls } = stubSend(null);
        await sendTextMessage(matrix, "!r:x", "the reply", "$unseen:x");
        assert.deepEqual(calls, [
            [
                "!r:x",
                {
                    msgtype: "m.text",
                    body: "the reply",
                    "m.relates_to": { "m.in_reply_to": { event_id: "$unseen:x" } },
                },
            ],
        ]);
    });

    it("skips the fallback for a redacted target", async () => {
        const { matrix, calls } = stubSend({
            getSender: () => "@alice:localhost",
            getContent: () => ({}),
            isRedacted: () => true,
        });
        await sendTextMessage(matrix, "!r:x", "the reply", "$gone:x");
        const content = calls[0]?.[1];
        assert.equal(content?.["body"], "the reply");
        assert.deepEqual(content?.["m.relates_to"], { "m.in_reply_to": { event_id: "$gone:x" } });
    });
});

describe("fake client replies", () => {
    it("ships a fixture quote and fills one in on send", async () => {
        const client = createFakeChatClient();
        const roomId = "!dm-0:fake";
        const timeline = client.timeline(roomId).get();
        const fixture = timeline.find((m) => m.reply !== null);
        assert.ok(fixture, "fake timeline must demo a quote");
        assert.equal(fixture.reply?.eventId, `${roomId}:e5`);
        assert.equal(fixture.reply?.body, timeline.find((m) => m.id === fixture.reply?.eventId)?.body);

        await client.send(roomId, "quoting back", fixture.id);
        const echo = client.timeline(roomId).get().at(-1);
        assert.equal(echo?.body, "quoting back");
        assert.deepEqual(echo?.reply, {
            eventId: fixture.id,
            senderId: fixture.senderId,
            senderName: fixture.senderName,
            body: fixture.body,
        });
    });
});
