/**
 * The native activity CLIENT: the reference producer a native app links against.
 *
 * It is the sending half of the same wire as the server (`native-activity.ts`),
 * so we exercise it with a REAL loopback client-and-server pair — the only way
 * to prove the producer and the relay agree over the socket. No Electron: it is
 * `node:net` talking to `native-activity.ts`'s `startNativeActivityServer`.
 */
import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { startNativeActivityServer } from "../src/native-activity.ts";
import {
    NativeActivityClient,
    type NativeActivityClientEvent,
} from "../src/native-client.ts";
import type { NativeActivity } from "../src/native-wire.ts";

/** Run the microtask/event queue for `ms` so an async socket write can land. */
const tick = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until `predicate` holds or the timeout elapses. Used to time the
 * exponential-backoff test without racing a fixed delay.
 */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() > deadline) {
                clearInterval(timer);
                reject(new Error("waitFor timed out"));
            }
        }, 5);
        timer.unref?.();
    });
}

/**
 * A free port the OS will not hand out before we use it: bind `0`, take the
 * assigned port, then close it so the caller can re-listen on it. Loopback
 * re-listen after a close is reliable, so "client up before server" tests can
 * race on this same port.
 */
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const port = (server.address() as AddressInfo).port;
            server.close(() => resolve(port));
        });
    });
}

describe("NativeActivityClient over a real loopback connection", () => {
    it("reports the server-bound port on 127.0.0.1", async () => {
        const seen: Array<NativeActivity | null> = [];
        const server = await startNativeActivityServer({
            port: 0,
            onActivity: (activity) => seen.push(activity),
        });
        const client = new NativeActivityClient({ port: server.port, backoffMs: 5 });
        await client.start();
        assert.ok(client.isConnected(), "connected on connect");
        assert.ok(client.set({ type: "playing", name: "Demo" }));
        await tick(20);
        await client.stop();
        await tick(20);
        await server.close();

        assert.deepEqual(
            seen,
            [{ type: "playing", name: "Demo" }, null],
            "a set then the producer quitting (stop clears the feed)",
        );
        assert.ok(!client.isConnected());
    });

    it("supersedes the last value with a new set (last-writer-wins)", async () => {
        const seen: Array<NativeActivity | null> = [];
        const server = await startNativeActivityServer({
            port: 0,
            onActivity: (activity) => seen.push(activity),
        });
        const client = new NativeActivityClient({ port: server.port, backoffMs: 5 });
        await client.start();
        client.set({ type: "playing", name: "First" });
        await tick(15);
        client.set({ type: "listening", name: "Spotify", details: "Lo-fi" });
        await tick(20);
        await client.stop();
        await tick(20);
        await server.close();

        assert.deepEqual(seen, [
            { type: "playing", name: "First" },
            { type: "listening", name: "Spotify", details: "Lo-fi" },
            null,
        ]);
    });

    it("rejects a malformed set without touching the feed", async () => {
        const seen: Array<NativeActivity | null> = [];
        const server = await startNativeActivityServer({
            port: 0,
            onActivity: (activity) => seen.push(activity),
        });
        const client = new NativeActivityClient({ port: server.port, backoffMs: 5 });
        await client.start();
        // A valid set establishes the intended value.
        client.set({ type: "playing", name: "Kept" });
        await tick(15);
        // An unknown type is not an activity: it is refused, the feed unchanged.
        const refused = client.set({ type: "streaming", name: "x" } as unknown as NativeActivity);
        await tick(15);
        assert.equal(refused, false, "an invalid activity is not framed");
        // clear the value we own.
        await client.stop();
        await tick(15);
        await server.close();

        assert.deepEqual(
            seen,
            [{ type: "playing", name: "Kept" }, null],
            "the last valid value survived the malformed one",
        );
    });

    it("holds a set made before the server is up, and asserts it on connect", async () => {
        // A client may start before the app (the RPC server) exists: it retries
        // with backoff, and a value set in the meantime is asserted on the first
        // real connection — so a producer that pushes before the app is running
        // still shows its activity.
        const seen: Array<NativeActivity | null> = [];
        const port = await freePort();
        const client = new NativeActivityClient({ port, backoffMs: 5 });

        // Begin connecting immediately (it is refused now) and keep retrying.
        const starting = client.start();
        // Not connected yet: the frame is held, but the intent is recorded.
        assert.ok(client.set({ type: "watching", name: "YouTube" }), "a held set is recorded");
        assert.ok(!client.isConnected());

        try {
            // Now the server appears on the very port the client was retrying.
            const server = await startNativeActivityServer({
                port,
                onActivity: (activity) => seen.push(activity),
            });

            const connected = await new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => resolve(false), 2000);
                const stop = setInterval(() => {
                    if (client.isConnected()) {
                        clearInterval(stop);
                        clearTimeout(timer);
                        resolve(true);
                    }
                }, 5);
                timer.unref?.();
                stop.unref?.();
            });
            assertTrue(connected, "the client connects to a server that appears on its port");
            assertTrue(client.isConnected());
            assert.deepEqual(seen, [{ type: "watching", name: "YouTube" }]);

            await client.stop();
            await server.close();
            await assert.doesNotReject(starting, "a stop lets the retrying start resolve");
        } finally {
            await client.stop(); // a failed assertion must not leave a retrying client
        }
    });

    it("does not frame a clear before ever sending a set (no clobber)", async () => {
        // A producer that only goes idle — never having reported an activity —
        // must not clear the feed, because some OTHER producer may own it. The
        // intent is "no set", so a reconnect sends nothing.
        const seen: Array<NativeActivity | null> = [];
        const port = await freePort();
        const client = new NativeActivityClient({ port, backoffMs: 5 });
        const starting = client.start(); // retry through the gap before the server
        client.clear(); // no set ever: nothing to clobber

        try {
            const server = await startNativeActivityServer({
                port,
                onActivity: (activity) => seen.push(activity),
            });
            const connected = await new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => resolve(false), 2000);
                const stop = setInterval(() => {
                    if (client.isConnected()) {
                        clearInterval(stop);
                        clearTimeout(timer);
                        resolve(true);
                    }
                }, 5);
                timer.unref?.();
                stop.unref?.();
            });
            assertTrue(connected, "the client connects even with no value to send");
            assertTrue(client.isConnected());
            await tick(30);
            // The feed was never ours, so nothing was written — not even a clear.
            assert.deepEqual(seen, []);

            await client.stop();
            await server.close();
            await assert.doesNotReject(starting, "a stop lets the retrying start resolve");
        } finally {
            await client.stop(); // a failed assertion must not leave a retrying client
        }
    });
});

describe("NativeActivityClient control", () => {
    it("stop is a no-op when never started, idempotent, and forbids a later start", async () => {
        const client = new NativeActivityClient({ port: 1, host: "127.0.0.1", backoffMs: 1 });
        await assert.doesNotReject(client.stop(), "a never-started stop resolves");
        await assert.doesNotReject(client.stop(), "a second stop is a no-op");
        assert.ok(client.isStopped());
        await assert.rejects(client.start(), /stopped/, "a stopped client will not connect");
    });

    it("retries a refused connection with exponential backoff, capped, until stopped", async () => {
        const events: NativeActivityClientEvent[] = [];
        // Port 1 is loopback but closed/privileged: every connect is refused, so
        // this exercises the retry/backoff path without a live server.
        const client = new NativeActivityClient({
            host: "127.0.0.1",
            port: 1,
            backoffMs: 1,
            backoffMaxMs: 8,
            onEvent: (event) => events.push(event),
        });
        const starting = client.start(); // keeps retrying

        const retries = () => events.filter((e) => e.type === "retry");
        await waitFor(() => retries().length >= 4, 3000);
        await client.stop(); // stop unblocks the retry loop
        await assert.doesNotReject(starting, "a stop while retrying lets start resolve");

        const delays = retries().slice(0, 4).map((e) => (e as Extract<NativeActivityClientEvent, { type: "retry" }>).delayMs);
        // backoff = 1 * 2^attempt, capped at 8: 2, 4, 8, 8.
        assert.deepEqual(delays, [2, 4, 8, 8], "exponential, capped");
    });
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** `assertTrue` for a connected client that a test waits on (a failed assert is a real failure, not a hang). */
function assertTrue(value: unknown, message?: string): asserts value is true {
    assert.ok(value, message);
}
