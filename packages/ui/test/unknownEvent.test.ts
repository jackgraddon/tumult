import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { MessageView } from "@tumult/core";

import { describeUnknownEvent } from "../src/timeline/unknownEvent.ts";

function message(type: string, body = ""): MessageView {
    return { type, body } as unknown as MessageView;
}

describe("describeUnknownEvent", () => {
    it("names a recognized vendor type without leaking the raw slug into the headline", () => {
        const description = describeUnknownEvent(message("com.beeper.message_send_status", "[com.beeper.message_send_status]"));
        assert.equal(description.label, "Can't display this bridge send status yet");
        assert.equal(description.detail, null);
    });

    it("shows a useful body when the event has one", () => {
        const description = describeUnknownEvent(message("cc.example.future", "a future event"));
        assert.equal(description.detail, "a future event");
    });

    it("falls back to a plain label for a completely unknown type", () => {
        const description = describeUnknownEvent(message("cc.example.future", "[cc.example.future]"));
        assert.equal(description.label, "Can't display this event yet");
    });
});
