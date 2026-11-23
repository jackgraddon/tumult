import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    beeperSummary,
    BEEPER_SEND_STATUS,
    capOrphans,
    collectRelatedEvents,
    MAX_ORPHAN_RELATED,
    MAX_RELATED_PER_TARGET,
    mergeRelatedEvents,
} from "../src/timeline/relatedEvents.ts";
import type { RelatedEventSource } from "../src/timeline/relatedEvents.ts";
import type { RelatedEventView } from "../src/contract.ts";

function event(over: Partial<RelatedEventSource> = {}): RelatedEventSource {
    return {
        getId: () => "$e",
        getType: () => "org.example.status",
        getSender: () => "@bridge:example.com",
        getTs: () => 100,
        getContent: () => ({
            "m.relates_to": { rel_type: "m.reference", event_id: "$target" },
            state: "done",
        }),
        getRelation: () => ({ rel_type: "m.reference", event_id: "$target" }),
        isRedacted: () => false,
        getStateKey: () => null,
        ...over,
    };
}

function related(over: Partial<RelatedEventView> = {}): RelatedEventView {
    return {
        id: "$status",
        type: BEEPER_SEND_STATUS,
        relationType: "m.reference",
        targetId: "$target",
        senderId: "@bridge:example.com",
        timestamp: 100,
        kind: "delivery",
        summary: "Sent via iMessage",
        content: {},
        ...over,
    };
}

describe("beeperSummary", () => {
    it("uses the human message, never the diagnostic error fields", () => {
        const summary = beeperSummary({
            network: "imessage",
            status: "FAIL_RETRIABLE",
            message: "recipient failed to decrypt",
            error: "raw SDK diagnostic",
            internal_error: "stack trace",
        });
        assert.equal(summary, "Couldn't send via iMessage: recipient failed to decrypt");
        assert.ok(!summary.includes("raw SDK diagnostic"));
        assert.ok(!summary.includes("stack trace"));
    });

    it("distinguishes sent from delivered", () => {
        assert.match(
            beeperSummary({ network: "imessage", status: "SUCCESS" }),
            /^Sent via iMessage$/,
        );
        assert.match(
            beeperSummary({
                network: "imessage",
                status: "SUCCESS",
                delivered_to_users: ["@a:x", "@b:x"],
            }),
            /^Delivered via iMessage to 2 people$/,
        );
    });

    it("accepts the historical PENDNIG typo", () => {
        assert.equal(beeperSummary({ status: "PENDNIG" }), "Sending via the bridge…");
    });
});

describe("collectRelatedEvents", () => {
    it("folds a valid Beeper status onto its target", () => {
        const target = event({ getId: () => "$target", getType: () => "m.room.message" });
        const status = event({
            getId: () => "$status",
            getType: () => BEEPER_SEND_STATUS,
            getContent: () => ({
                "m.relates_to": { rel_type: "m.reference", event_id: "$target" },
                network: "imessage",
                status: "SUCCESS",
            }),
        });
        const result = collectRelatedEvents([target, status]);
        assert.equal(result.recognized.has(status), true);
        assert.equal(result.recognized.has(target), false);
        assert.deepEqual(
            result.byTarget.get("$target")?.map((entry) => ({
                id: entry.id,
                kind: entry.kind,
                summary: entry.summary,
            })),
            [{ id: "$status", kind: "delivery", summary: "Sent via iMessage" }],
        );
    });

    it("auto-folds a future metadata family named in the event type", () => {
        const update = event();
        const result = collectRelatedEvents([update]);
        assert.equal(result.recognized.has(update), true);
        assert.equal(result.byTarget.get("$target")?.[0]?.kind, "metadata");
        assert.equal(result.byTarget.get("$target")?.[0]?.summary, "Related update: done");
    });

    it("does not hide an arbitrary custom event just because it is small and referenced", () => {
        const move = event({
            getType: () => "cc.example.chess.move",
            getContent: () => ({
                "m.relates_to": { rel_type: "m.reference", event_id: "$target" },
                move: "e2e4",
            }),
        });
        const result = collectRelatedEvents([move]);
        assert.equal(result.recognized.has(move), false);
        assert.equal(result.byTarget.size, 0);
    });

    it("keeps a normal referenced message as its own row", () => {
        const message = event({
            getType: () => "cc.example.card",
            getContent: () => ({
                body: "look at this",
                msgtype: "m.text",
                "m.relates_to": { rel_type: "m.reference", event_id: "$target" },
            }),
        });
        const result = collectRelatedEvents([message]);
        assert.equal(result.recognized.has(message), false);
        assert.equal(result.byTarget.size, 0);
    });

    it("never folds verification handshakes or still-encrypted events", () => {
        const verification = event({ getType: () => "m.key.verification.ready" });
        const encrypted = event({ getType: () => "m.room.encrypted" });
        const result = collectRelatedEvents([verification, encrypted]);
        assert.equal(result.recognized.size, 0);
    });

    it("ignores malformed known metadata without a reference", () => {
        const malformed = event({
            getType: () => BEEPER_SEND_STATUS,
            getRelation: () => null,
            getContent: () => ({ status: "SUCCESS" }),
        });
        const result = collectRelatedEvents([malformed]);
        assert.equal(result.recognized.has(malformed), false);
    });
});

describe("orphan related events", () => {
    it("merges by id, newest first, without duplicating a buffered event", () => {
        const primary = new Map<string, RelatedEventView[]>([
            ["$target", [related({ id: "$old", timestamp: 1 }), related({ id: "$new", timestamp: 3 })]],
        ]);
        const buffered = new Map<string, RelatedEventView[]>([
            ["$target", [related({ id: "$new", timestamp: 3 }), related({ id: "$mid", timestamp: 2 })]],
        ]);
        const merged = mergeRelatedEvents(primary, buffered);
        assert.deepEqual(
            merged.get("$target")?.map((entry) => entry.id),
            ["$new", "$mid", "$old"],
        );
    });

    it("caps a busy target and the whole orphan buffer", () => {
        const many = Array.from({ length: MAX_RELATED_PER_TARGET + 4 }, (_, index) =>
            related({ id: `$status${index}`, timestamp: index }),
        );
        const merged = mergeRelatedEvents(new Map([["$target", many]]), new Map());
        assert.equal(merged.get("$target")?.length, MAX_RELATED_PER_TARGET);

        const flood = Array.from({ length: MAX_ORPHAN_RELATED + 20 }, (_, index) =>
            related({ id: `$orphan${index}`, timestamp: index }),
        );
        const capped = capOrphans(new Map([["$target", flood]]));
        assert.equal(
            [...capped.values()].reduce((total, entries) => total + entries.length, 0),
            MAX_ORPHAN_RELATED,
        );
    });
});
