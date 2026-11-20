/**
 * Discord IPC's listening half, exercised with real Unix sockets / Windows named
 * pipes: the handshake reply, an activity push, a clear, stale-socket recovery
 * and the "last writer owns the feed" rule. No Electron, no renderer.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
    commandReply,
    DISCORD_OP,
    DiscordFrameFramer,
    encodeDiscordFrame,
} from "../src/discord-ipc.ts";
import type { DiscordFrame } from "../src/discord-ipc.ts";
import { discordIpcSocketPaths, startDiscordIpcServer } from "../src/discord-ipc-server.ts";
import type { NativeActivity } from "../src/native-wire.ts";

function testPath(): string {
    if (process.platform === "win32") return `\\\\.\\pipe\\tumult-discord-ipc-test-${randomUUID()}`;
    return join(tmpdir(), `tumult-discord-ipc-${randomUUID()}.sock`);
}

function connectIpc(path: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket = connect(path);
        socket.once("error", reject);
        socket.once("connect", () => {
            socket.off("error", reject);
            resolve(socket);
        });
    });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Collect frames from one producer socket and wait for a matching reply. */
class Client {
    private readonly framer = new DiscordFrameFramer();
    private readonly received: DiscordFrame[] = [];
    readonly socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
        socket.on("data", (chunk) => this.received.push(...this.framer.push(chunk)));
    }

    write(frame: Buffer): void {
        this.socket.write(frame);
    }

    handshake(): void {
        this.write(encodeDiscordFrame(DISCORD_OP.HANDSHAKE, { v: 1, client_id: "test" }));
    }

    setActivity(activity: Record<string, unknown> | null, nonce: string = randomUUID()): void {
        this.write(
            encodeDiscordFrame(DISCORD_OP.FRAME, {
                cmd: "SET_ACTIVITY",
                nonce,
                args: { pid: 1, activity },
            }),
        );
    }

    async until(predicate: (frame: DiscordFrame) => boolean): Promise<DiscordFrame> {
        const deadline = Date.now() + 5000;
        for (;;) {
            const found = this.received.find(predicate);
            if (found) return found;
            if (Date.now() >= deadline) throw new Error("timed out waiting for an IPC frame");
            await wait(10);
        }
    }

    async replyTo(nonce: string): Promise<void> {
        const frame = await this.until((candidate) => candidate.payload?.nonce === nonce);
        assert.deepEqual(frame.payload, { cmd: "SET_ACTIVITY", data: null, evt: null, nonce });
    }
}

async function until(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for an activity change");
        await wait(10);
    }
}

async function startAt(
    path: string,
    onActivity: (activity: NativeActivity | null) => void,
) {
    return startDiscordIpcServer({ onActivity, env: { TUMULT_DISCORD_IPC_PATH: path } });
}

describe("discordIpcSocketPaths", () => {
    it("treats an explicit path as authoritative", () => {
        assert.deepEqual(
            discordIpcSocketPaths({ TUMULT_DISCORD_IPC_PATH: "/tmp/tumult-discord.sock" }, "linux"),
            ["/tmp/tumult-discord.sock"],
        );
        assert.deepEqual(discordIpcSocketPaths({ DISCORD_IPC_SOCKET: "/tmp/cider.sock" }, "linux"), ["/tmp/cider.sock"]);
    });

    it("uses Discord's ten Windows named pipes", () => {
        const paths = discordIpcSocketPaths({}, "win32");
        assert.equal(paths.length, 10);
        assert.equal(paths[0], "\\\\.\\pipe\\discord-ipc-0");
        assert.equal(paths[9], "\\\\.\\pipe\\discord-ipc-9");
    });

    it("walks the Unix prefixes in Discord's order, indexes within each", () => {
        const paths = discordIpcSocketPaths(
            { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp/somewhere" },
            "linux",
        );
        assert.equal(paths[0], "/run/user/1000/discord-ipc-0");
        assert.equal(paths[9], "/run/user/1000/discord-ipc-9");
        assert.equal(paths[10], "/tmp/somewhere/discord-ipc-0");
        assert.ok(paths.includes("/tmp/discord-ipc-9"));
    });
});

describe("startDiscordIpcServer", () => {
    it("handshakes, mirrors SET_ACTIVITY and CLEAR, and replies with their nonces", async () => {
        const path = testPath();
        const seen: Array<NativeActivity | null> = [];
        const server = await startAt(path, (activity) => seen.push(activity));
        const client = new Client(await connectIpc(server.path));

        client.handshake();
        const ready = await client.until((frame) => frame.payload?.evt === "READY");
        assert.equal(ready.opcode, DISCORD_OP.FRAME);
        assert.equal(ready.payload?.cmd, "DISPATCH");

        client.setActivity({ type: 2, name: "Cider", details: "Song", state: "Artist" }, "set-1");
        await client.replyTo("set-1");
        await until(() => seen.length === 1);
        assert.deepEqual(seen[0], { type: "listening", name: "Song", details: "Artist" });

        client.setActivity(null, "clear-1");
        await client.replyTo("clear-1");
        await until(() => seen.length === 2);
        assert.equal(seen[1], null);

        client.socket.destroy();
        await server.close();
        if (process.platform !== "win32") await assert.rejects(lstat(path), "the socket path is removed on close");
    });

    it("reclaims a stale socket left by a crashed producer", async function () {
        if (process.platform === "win32") return; // named pipes vanish with their owner
        const path = testPath();
        // A graceful server.close() unlinks its own path; a crashed process does
        // not. Exit from the listen callback to leave the real stale-socket shape.
        const result = spawnSync(
            process.execPath,
            [
                "-e",
                'const net = require("node:net"); const s = net.createServer(); s.listen(process.argv[1], () => process.exit(0));',
                path,
            ],
            { timeout: 5000 },
        );
        assert.equal(result.status, 0, `could not create a stale socket: ${result.stderr?.toString() ?? ""}`);
        assert.ok((await lstat(path)).isSocket(), "the stale socket is still on disk");

        const server = await startAt(path, () => {});
        assert.equal(server.path, path);
        const client = new Client(await connectIpc(path));
        client.handshake();
        await client.until((frame) => frame.payload?.evt === "READY");
        client.socket.destroy();
        await server.close();
    });

    it("does not clear when an older producer disconnects after a newer one took over", async () => {
        const seen: Array<NativeActivity | null> = [];
        const server = await startAt(testPath(), (activity) => seen.push(activity));
        const first = new Client(await connectIpc(server.path));
        const latest = new Client(await connectIpc(server.path));

        first.setActivity({ type: 0, name: "Old", details: "first" }, "old");
        await first.replyTo("old");
        await until(() => seen.length === 1);
        latest.setActivity({ type: 0, name: "New", details: "second" }, "new");
        await latest.replyTo("new");
        await until(() => seen.length === 2);

        first.socket.destroy();
        await wait(100);
        assert.deepEqual(
            seen.map((activity) => (activity ? activity.name : "cleared")),
            ["Old", "New"],
            "the old connection must not erase the new producer's activity",
        );

        latest.socket.destroy();
        await server.close();
    });

    it("answers PING with PONG and ignores a frame that is not a command", async () => {
        const server = await startAt(testPath(), () => {});
        const client = new Client(await connectIpc(server.path));
        client.write(encodeDiscordFrame(DISCORD_OP.PING, { nonce: "ping-1" }));
        const pong = await client.until((frame) => frame.opcode === DISCORD_OP.PONG);
        assert.deepEqual(pong.payload, { nonce: "ping-1" });

        client.write(encodeDiscordFrame(DISCORD_OP.FRAME, { evt: "SOMETHING" }));
        await wait(30); // no reply expected; the server must simply stay up
        client.socket.destroy();
        await server.close();
    });

    it("refuses an occupied dedicated path instead of silently binding elsewhere", async () => {
        const path = testPath();
        const other = createServer();
        await new Promise<void>((resolve) => other.listen(path, resolve));
        try {
            await assert.rejects(startAt(path, () => {}), /TUMULT_DISCORD_IPC_PATH/);
        } finally {
            await new Promise<void>((resolve, reject) => other.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it("commandReply is the shape producers expect for unrelated commands too", () => {
        // Kept here (next to the socket) as a reminder that the reply is pure and
        // reused for every acknowledged command, not only SET_ACTIVITY.
        const reply = commandReply({ cmd: "AUTHORIZE", nonce: "a" })!;
        assert.deepEqual(new DiscordFrameFramer().push(reply)[0]?.payload, {
            cmd: "AUTHORIZE",
            data: null,
            evt: null,
            nonce: "a",
        });
    });
});
