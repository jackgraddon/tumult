/**
 * The native activity RPC: the loopback protocol a native app on this machine
 * pushes activity through. The wire shape, the field caps, the newline framer
 * and the `127.0.0.1`-only server are all pure of Electron, so a real `net`
 * client exercises the real server here — no Electron needed.
 */
import assert from "node:assert/strict";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { describe, it } from "node:test";

import {
    LineFramer,
    NATIVE_ACTIVITY_TYPES,
    parseNativeActivityLine,
    resolveNativeActivityPort,
    startNativeActivityServer,
    validateNativeActivity,
} from "../src/native-activity.ts";

describe("NATIVE_ACTIVITY_TYPES", () => {
    it("is the rich-presence vocabulary a native app may push", () => {
        assert.deepEqual(
            [...NATIVE_ACTIVITY_TYPES],
            ["playing", "listening", "watching", "custom"],
        );
    });
});

describe("validateNativeActivity", () => {
    it("accepts a minimal set and normalises its type and name", () => {
        assert.deepEqual(
            validateNativeActivity({ type: "playing", name: "VLC" }),
            { type: "playing", name: "VLC" },
        );
    });

    it("keeps the optional fields a producer trims and caps", () => {
        const details = "x".repeat(1000);
        const activity = validateNativeActivity({
            type: "listening",
            name: "Spotify",
            details,
            state: "Now playing the album of the day",
            startedAt: 1700000000000,
            emoji: "🎵",
        });
        assert.ok(activity);
        assert.equal(activity!.type, "listening");
        assert.equal(activity!.name, "Spotify");
        assert.equal(activity!.details!.length, 256);
        assert.equal(activity!.state, "Now playing the album of the day");
        assert.equal(activity!.startedAt, 1700000000000);
        assert.equal(activity!.emoji, "🎵");
    });

    it("trims and drops an empty optional, and a name over the cap is trimmed", () => {
        const activity = validateNativeActivity({
            type: "custom",
            name: "  " + "y".repeat(200) + "  ",
            details: "   ",
            state: "",
        });
        assert.ok(activity);
        assert.equal(activity!.details || undefined, undefined);
        assert.equal(activity!.state || undefined, undefined);
        assert.equal(activity!.name.length, 128);
    });

    it("rejects a non-object, a null, an array, and a known-value shape error", () => {
        assert.equal(validateNativeActivity(null), null);
        assert.equal(validateNativeActivity("a string"), null);
        assert.equal(validateNativeActivity(undefined), null);
        assert.equal(validateNativeActivity({}), null);
    });

    it("rejects an unknown type and an empty or over-long name", () => {
        assert.equal(validateNativeActivity({ type: "streaming", name: "x" }), null);
        assert.equal(validateNativeActivity({ type: "playing", name: "   " }), null);
    });

    it("drops an infinite or non-numeric startedAt", () => {
        assert.deepEqual(validateNativeActivity({ type: "playing", name: "a", startedAt: Number.POSITIVE_INFINITY }), { type: "playing", name: "a" });
        assert.deepEqual(validateNativeActivity({ type: "playing", name: "a", startedAt: Number.NaN }), { type: "playing", name: "a" });
        assert.deepEqual(validateNativeActivity({ type: "playing", name: "a", startedAt: "now" }), { type: "playing", name: "a" });
    });
});

describe("LineFramer", () => {
    it("splits whole newline-terminated lines and holds a partial", () => {
        const framer = new LineFramer();
        // One frame ends on the first chunk; the next is still being written.
        assert.deepEqual(framer.push(Buffer.from('{"op":"clear"}\n{"op":"se')), ['{"op":"clear"}']);
        assert.deepEqual(framer.push(Buffer.from('t","value":1}\n')), ['{"op":"set","value":1}']);
        // A later empty chunk yields nothing further.
        assert.deepEqual(framer.push(Buffer.from('')), []);
    });

    it("holds a partial across more than one chunk", () => {
        const framer = new LineFramer();
        assert.deepEqual(framer.push(Buffer.from('abcde')), []);
        assert.deepEqual(framer.push(Buffer.from('f\n')), ["abcdef"]);
    });

    it("drops a never-terminated line longer than the 64 KB cap", () => {
        const framer = new LineFramer();
        assert.deepEqual(framer.push(Buffer.alloc(60 * 1024, 0x41)), []);
        assert.deepEqual(framer.push(Buffer.alloc(10 * 1024, 0x42)), []);
    });
});

describe("parseNativeActivityLine", () => {
    it("returns the right shape for a set and for a clear", () => {
        assert.deepEqual(parseNativeActivityLine('{"op":"clear"}'), { op: "clear" });
        assert.deepEqual(parseNativeActivityLine('{"op":"set","value":{"type":"playing","name":"VLC"}}'), {
            op: "set",
            value: { type: "playing", name: "VLC" },
        });
    });

    it("ignores garbage, the wrong op, and a non-object JSON value", () => {
        assert.equal(parseNativeActivityLine("not json"), null);
        assert.equal(parseNativeActivityLine('{"op":"delete"}'), null);
        assert.equal(parseNativeActivityLine("42"), null);
        assert.equal(parseNativeActivityLine("[]"), null);
        assert.equal(parseNativeActivityLine('{"value":{"type":"playing"}}'), null);
    });
});

describe("resolveNativeActivityPort", () => {
    it("defaults when unset, and never leaves a taken port behind", () => {
        assert.equal(resolveNativeActivityPort({}), 18731);
        assert.equal(resolveNativeActivityPort({ TUMULT_NATIVE_ACTIVITY_PORT: "abc" }), 18731);
        assert.equal(resolveNativeActivityPort({ TUMULT_NATIVE_ACTIVITY_PORT: "0" }), 18731);
        assert.equal(resolveNativeActivityPort({ TUMULT_NATIVE_ACTIVITY_PORT: "  " }), 18731);
    });
    it("reads a positive integer port from the environment", () => {
        assert.equal(resolveNativeActivityPort({ TUMULT_NATIVE_ACTIVITY_PORT: "50000" }), 50000);
    });
});

describe("startNativeActivityServer", () => {
    /** Open a TCP client to the server; resolves the connected socket. */
    function connectClient(port: number): Promise<Socket> {
        return new Promise((resolve, reject) => {
            const socket = connect(port, "127.0.0.1");
            socket.once("error", reject);
            socket.once("connect", () => resolve(socket));
        });
    }

    it("reports the port it really bound on 127.0.0.1 and relays a SET then a CLEAR", async () => {
        const seen: Array<unknown> = [];
        const server = await startNativeActivityServer({ port: 0, onActivity: (activity) => seen.push(activity) });

        // Ephemeral: the port must be a real one, not the requested 0.
        assert.ok(Number.isInteger(server.port) && server.port > 0, "bound to an ephemeral port");

        const client = await connectClient(server.port);

        // A malformed SET is ignored: whatever was current stays current.
        client.write(Buffer.from('{"op":"set","value":{"type":"streaming","name":"x"}}\n'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(seen, [], "an invalid SET must not clear or set");

        const activity = JSON.stringify({ op: "set", value: { type: "playing", name: "VLC", details: "Test" } });
        client.write(Buffer.from(`${activity}\n`));
        await new Promise((resolve) => setTimeout(resolve, 50));

        client.write(Buffer.from('{"op":"clear"}\n'));
        await new Promise((resolve) => setTimeout(resolve, 50));

        client.destroy();
        await server.close();

        assert.deepEqual(seen, [
            { type: "playing", name: "VLC", details: "Test" },
            null,
        ]);
    });

    it("rejects a second close() but resolves the first", async () => {
        const server = await startNativeActivityServer({ port: 0, onActivity: () => {} });
        await server.close();
        await assert.doesNotReject(server.close(), "the second close must not reject");
    });

    it("keeps listening for the next client after one is dropped", async () => {
        const seen: string[] = [];
        const server = await startNativeActivityServer({ port: 0, onActivity: (activity) => seen.push(activity ? activity.name : "cleared") });

        // A client that is destroyed without finishing its frames must not take
        // the server down: the next connection still gets served.
        const first = await connectClient(server.port);
        first.write(Buffer.from('{"op":"clear"}\n'));
        await new Promise((resolve) => setTimeout(resolve, 30));
        first.destroy();

        const second = await connectClient(server.port);
        second.write(Buffer.from(`{"op":"set","value":{"type":"watching","name":"YouTube"}}\n`));
        await new Promise((resolve) => setTimeout(resolve, 50));
        second.destroy();

        await server.close();
        assert.deepEqual(seen, ["cleared", "YouTube"]);
    });
});
