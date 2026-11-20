/**
 * Discord IPC's pure wire: framing, replies and the translation from a Discord
 * `SET_ACTIVITY` into the same `NativeActivity` the Tumult RPC carries. This is
 * where a producer's payload shape is pinned without opening a socket.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    activityFromSetActivity,
    commandReply,
    DISCORD_OP,
    DiscordFrameFramer,
    encodeDiscordFrame,
    handshakeReply,
} from "../src/discord-ipc.ts";
import type { DiscordFrame } from "../src/discord-ipc.ts";

/** Decode a single whole frame (or assert there is none). */
function frames(buffer: Buffer): DiscordFrame[] {
    return new DiscordFrameFramer().push(buffer);
}

describe("DiscordFrameFramer", () => {
    it("reassembles a frame split across the header and the JSON body", () => {
        const wire = encodeDiscordFrame(DISCORD_OP.HANDSHAKE, { v: 1, client_id: "123" });
        const framer = new DiscordFrameFramer();
        assert.deepEqual(framer.push(wire.subarray(0, 3)), []);
        assert.deepEqual(framer.push(wire.subarray(3, 12)), []);
        assert.deepEqual(framer.push(wire.subarray(12)), [
            { opcode: DISCORD_OP.HANDSHAKE, payload: { v: 1, client_id: "123" } },
        ]);
    });

    it("reads two frames in one chunk and ignores invalid JSON", () => {
        const bad = Buffer.concat([
            Buffer.from([DISCORD_OP.FRAME, 0, 0, 0, 5, 0, 0, 0]),
            Buffer.from("nope!"),
        ]);
        const wire = Buffer.concat([
            bad,
            encodeDiscordFrame(DISCORD_OP.PING, { nonce: "p" }),
            encodeDiscordFrame(DISCORD_OP.FRAME, { cmd: "SET_ACTIVITY" }),
        ]);
        assert.deepEqual(frames(wire), [
            { opcode: DISCORD_OP.PING, payload: { nonce: "p" } },
            { opcode: DISCORD_OP.FRAME, payload: { cmd: "SET_ACTIVITY" } },
        ]);
    });

    it("skips an oversized payload and resynchronises on the next frame", () => {
        const header = Buffer.alloc(8);
        header.writeUInt32LE(DISCORD_OP.FRAME, 0);
        header.writeUInt32LE(2 * 1024 * 1024, 4);
        const next = encodeDiscordFrame(DISCORD_OP.PING, {});
        const framer = new DiscordFrameFramer();
        assert.deepEqual(framer.push(Buffer.concat([header, Buffer.alloc(64)])), []);
        assert.deepEqual(framer.push(next), [{ opcode: DISCORD_OP.PING, payload: {} }]);
    });

    it("drops an endless stream that never supplies a header", () => {
        const framer = new DiscordFrameFramer();
        assert.deepEqual(framer.push(Buffer.alloc(2 * 1024 * 1024 + 16, 0x41)), []);
        assert.deepEqual(framer.push(encodeDiscordFrame(DISCORD_OP.PING, {})), [
            { opcode: DISCORD_OP.PING, payload: {} },
        ]);
    });
});

describe("Discord IPC replies", () => {
    it("sends a READY dispatch after a handshake", () => {
        assert.deepEqual(frames(handshakeReply()), [
            {
                opcode: DISCORD_OP.FRAME,
                payload: {
                    cmd: "DISPATCH",
                    data: {
                        v: 1,
                        config: { cdn_host: "cdn.discordapp.com", api_endpoint: "//discord.com/api", environment: "production" },
                        user: { id: "0", username: "Tumult", discriminator: "0", avatar: null },
                    },
                    evt: "READY",
                },
            },
        ]);
    });

    it("echoes the nonce on a command reply so a producer believes it worked", () => {
        assert.deepEqual(frames(commandReply({ cmd: "SET_ACTIVITY", nonce: "abc", args: {} })!), [
            { opcode: DISCORD_OP.FRAME, payload: { cmd: "SET_ACTIVITY", data: null, evt: null, nonce: "abc" } },
        ]);
        assert.equal(commandReply(null), null);
        assert.equal(commandReply({ nonce: "abc" }), null);
    });
});

describe("activityFromSetActivity", () => {
    it("maps a music producer's track/artist/album into our listening vocabulary", () => {
        assert.deepEqual(
            activityFromSetActivity({
                cmd: "SET_ACTIVITY",
                nonce: "n",
                args: {
                    pid: 123,
                    activity: {
                        type: 2,
                        name: "Cider",
                        details: "Song",
                        state: "Artist",
                        emoji: { name: "🎵" },
                        assets: { large_text: "Album" },
                        timestamps: { start: 1_700_000_000, end: 1_700_000_223 },
                    },
                },
            }),
            {
                kind: "set",
                activity: {
                    type: "listening",
                    name: "Song",
                    details: "Artist",
                    state: "Album",
                    emoji: "🎵",
                    startedAt: 1_700_000_000_000,
                    endsAt: 1_700_000_223_000,
                },
            },
        );
    });

    it("leaves millisecond timestamps alone (Cider sends ms)", () => {
        const change = activityFromSetActivity({
            cmd: "SET_ACTIVITY",
            args: { activity: { type: 2, name: "Cider", details: "Song", timestamps: { start: 1_795_204_516_255 } } },
        });
        assert.equal(change.kind, "set");
        if (change.kind === "set") {
            assert.equal(change.activity.startedAt, 1_795_204_516_255);
            assert.equal(change.activity.endsAt, undefined);
        }
    });

    it("maps Discord artwork keys into two bounded images", () => {
        const change = activityFromSetActivity({
            cmd: "SET_ACTIVITY",
            args: {
                activity: {
                    type: 2,
                    details: "Song",
                    assets: {
                        large_image: "mp:external/abc/https%3A%2F%2Fexample.com%2Fart.png",
                        large_text: "Album art",
                        small_image: "spotify:abc123",
                        small_text: "Spotify",
                    },
                },
            },
        });
        assert.equal(change.kind, "set");
        if (change.kind === "set") {
            assert.deepEqual(change.activity.media, [
                { url: "https://media.discordapp.net/external/abc/https%3A%2F%2Fexample.com%2Fart.png", label: "Album art" },
                { url: "https://i.scdn.co/image/abc123", label: "Spotify" },
            ]);
        }
    });

    it("resolves an application asset id through its application and keeps the end time", () => {
        const change = activityFromSetActivity({
            cmd: "SET_ACTIVITY",
            args: {
                activity: {
                    type: 0,
                    name: "VLC",
                    application_id: "123456",
                    assets: { large_image: "abc123", large_text: "Cover" },
                    timestamps: { start: 1_700_000_000, end: 1_700_000_100 },
                },
            },
        });
        assert.equal(change.kind, "set");
        if (change.kind === "set") {
            assert.deepEqual(change.activity.media, [{ url: "https://cdn.discordapp.com/app-assets/123456/abc123.png", label: "Cover" }]);
            assert.equal(change.activity.endsAt, 1_700_000_100_000);
        }
    });

    it("keeps the application name as the headline for games and shows details below", () => {
        assert.deepEqual(
            activityFromSetActivity({
                cmd: "SET_ACTIVITY",
                args: { activity: { type: 0, name: "VLC", details: "Film.mp4" } },
            }),
            { kind: "set", activity: { type: "playing", name: "VLC", details: "Film.mp4" } },
        );
    });

    it("accepts string activity types and maps streaming to watching", () => {
        assert.deepEqual(
            activityFromSetActivity({
                cmd: "SET_ACTIVITY",
                args: { activity: { type: "streaming", name: "Player", details: "Match" } },
            }),
            { kind: "set", activity: { type: "watching", name: "Player", details: "Match" } },
        );
    });

    it("treats a null activity as an explicit clear", () => {
        assert.deepEqual(activityFromSetActivity({ cmd: "SET_ACTIVITY", args: { pid: 1, activity: null } }), {
            kind: "clear",
        });
    });

    it("treats a SET_ACTIVITY with no activity as Cider's pause clear", () => {
        assert.deepEqual(activityFromSetActivity({ cmd: "SET_ACTIVITY", args: { pid: 12 } }), { kind: "clear" });
        assert.deepEqual(activityFromSetActivity({ cmd: "SET_ACTIVITY", args: {} }), { kind: "clear" });
    });

    it("ignores other commands and activities with no usable headline", () => {
        assert.deepEqual(activityFromSetActivity({ cmd: "GET_GUILDS", args: {} }), { kind: "ignore" });
        assert.deepEqual(activityFromSetActivity({ cmd: "SET_ACTIVITY", args: { activity: { type: 2 } } }), {
            kind: "ignore",
        });
        assert.deepEqual(activityFromSetActivity(null), { kind: "ignore" });
    });

    it("caps long fields through the shared native validator", () => {
        const change = activityFromSetActivity({
            cmd: "SET_ACTIVITY",
            args: { activity: { type: 2, details: "x".repeat(300), state: "y".repeat(300) } },
        });
        assert.equal(change.kind, "set");
        if (change.kind === "set") {
            assert.equal(change.activity.name.length, 128);
            assert.equal(change.activity.details?.length, 256);
        }
    });
});
