import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventStatus } from "matrix-js-sdk";

import { mapEvent, type MappableEvent } from "../src/timeline/map.ts";

function stub(over: Partial<MappableEvent> = {}): MappableEvent {
    return {
        getId: () => "$abc:localhost",
        getType: () => "m.room.message",
        getSender: () => "@alice:localhost",
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

describe("mapEvent", () => {
    it("maps a plain text event", () => {
        const m = mapEvent(stub());
        assert.deepEqual(m, {
            id: "$abc:localhost",
            type: "m.room.message",
            senderId: "@alice:localhost",
            body: "hello",
            timestamp: 1700000000000,
            status: "sent",
            decryption: "ok",
            content: { msgtype: "m.text", body: "hello" },
            reactions: [],
            readBy: [],
            edited: false,
        });
    });

    it("labels non-text events honestly", () => {
        const m = mapEvent(
            stub({ getType: () => "m.sticker", getContent: () => ({ url: "mxc://x/y" }) }),
        );
        assert.equal(m.body, "[m.sticker]");
    });

    it("marks redacted events", () => {
        const m = mapEvent(stub({ isRedacted: () => true, getContent: () => ({}) }));
        assert.equal(m.body, "Message deleted.");
    });

    it("crosses the status axis", () => {
        assert.equal(mapEvent(stub({ status: EventStatus.QUEUED })).status, "sending");
        assert.equal(mapEvent(stub({ status: EventStatus.ENCRYPTING })).status, "sending");
        assert.equal(mapEvent(stub({ status: EventStatus.SENDING })).status, "sending");
        assert.equal(mapEvent(stub({ status: EventStatus.SENT })).status, "sending");
        assert.equal(mapEvent(stub({ status: EventStatus.NOT_SENT })).status, "failed");
        assert.equal(mapEvent(stub({ status: EventStatus.CANCELLED })).status, "failed");
        assert.equal(mapEvent(stub({ status: null })).status, "sent");
    });

    it("crosses the decryption axis", () => {
        // Encrypted, keys not yet arrived.
        const pending = mapEvent(
            stub({ isEncrypted: () => true, clearEvent: undefined, getContent: () => ({}) }),
        );
        assert.equal(pending.decryption, "pending");
        // Encrypted but successfully decrypted: isEncrypted() stays true on
        // the wire type, clearEvent separates ok from pending.
        const ok = mapEvent(stub({ isEncrypted: () => true, clearEvent: {} }));
        assert.equal(ok.decryption, "ok");
        // Permanent failure.
        const failed = mapEvent(
            stub({ isEncrypted: () => true, isDecryptionFailure: () => true }),
        );
        assert.equal(failed.decryption, "failed");
    });
});
