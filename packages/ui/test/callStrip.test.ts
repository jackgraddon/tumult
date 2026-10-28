import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { MemberView, VoiceView } from "@tumult/core";

import { buildCallStrip } from "../src/calls/callStrip.ts";

const ROOM = "!room:example.com";
const SELF = "@me:example.com";

function member(userId: string, displayName: string, avatarUrl: string | null = null): MemberView {
    return {
        userId,
        displayName,
        avatarUrl,
        membership: "join",
        powerLevel: 0,
        isSelf: userId === SELF,
        presence: "unknown",
    } as MemberView;
}

function voice(overrides: Partial<VoiceView> = {}): VoiceView {
    return {
        roomId: ROOM,
        state: "connected",
        error: null,
        muted: false,
        deafened: false,
        participants: [],
        ...overrides,
    };
}

describe("buildCallStrip", () => {
    it("shows no strip for a room with no call", () => {
        assert.equal(buildCallStrip(ROOM, null, {}, [], SELF), null);
        // A session elsewhere does not light up this room.
        assert.equal(buildCallStrip(ROOM, voice({ roomId: "!other:example.com" }), {}, [], SELF), null);
    });

    it("lists the room's call memberships when we are not in it, with names from the roster", () => {
        const strip = buildCallStrip(
            ROOM,
            null,
            { [ROOM]: ["@alice:example.com", "@bob:example.com"] },
            [member("@alice:example.com", "Alice", "mxc://a")],
            SELF,
        );
        assert.deepEqual(strip, {
            joined: false,
            state: null,
            people: [
                { userId: "@alice:example.com", name: "Alice", avatarUrl: "mxc://a", speaking: false, muted: false, isSelf: false },
                // Not in the (lazy) roster yet: the localpart stands in.
                { userId: "@bob:example.com", name: "bob", avatarUrl: null, speaking: false, muted: false, isSelf: false },
            ],
        });
    });

    it("uses the SFU's view while joined, so speaking and mute are live", () => {
        const strip = buildCallStrip(
            ROOM,
            voice({
                participants: [
                    { userId: SELF, deviceId: "A", speaking: false, muted: true },
                    { userId: "@alice:example.com", deviceId: "B", speaking: true, muted: false },
                ],
            }),
            // The membership feed may lag; the session wins.
            { [ROOM]: ["@stale:example.com"] },
            [member(SELF, "Me"), member("@alice:example.com", "Alice")],
            SELF,
        );
        assert.equal(strip?.joined, true);
        assert.equal(strip?.state, "connected");
        assert.deepEqual(
            strip?.people.map((p) => [p.name, p.speaking, p.muted, p.isSelf]),
            [
                ["Me", false, true, true],
                ["Alice", true, false, false],
            ],
        );
    });

    it("shows the strip while joining, before any participant is known", () => {
        const strip = buildCallStrip(
            ROOM,
            voice({ state: "connecting" }),
            { [ROOM]: ["@alice:example.com"] },
            [],
            SELF,
        );
        assert.equal(strip?.joined, true);
        assert.equal(strip?.state, "connecting");
        // Falls back to the memberships rather than an empty row.
        assert.deepEqual(strip?.people.map((p) => p.userId), ["@alice:example.com"]);
    });

    it("folds a user's devices into one person", () => {
        const strip = buildCallStrip(
            ROOM,
            voice({
                participants: [
                    { userId: "@alice:example.com", deviceId: "A", speaking: false, muted: true },
                    { userId: "@alice:example.com", deviceId: "B", speaking: true, muted: false },
                ],
            }),
            {},
            [],
            SELF,
        );
        assert.equal(strip?.people.length, 1);
        // Speaking on any device counts; muted only if every device is.
        assert.equal(strip?.people[0]?.speaking, true);
        assert.equal(strip?.people[0]?.muted, false);
    });
});
