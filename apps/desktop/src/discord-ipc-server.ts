/**
 * Discord-compatible IPC: the **listening** half that plugs Discord-style
 * producers into Tumult's native activity feed.
 *
 * Many apps (Cider, games, editors) already publish rich presence over Discord
 * IPC, so asking each one for a second, Tumult-specific integration is needless.
 * This server speaks the same local socket protocol Discord does — handshake,
 * framed commands, `SET_ACTIVITY` — but it is a *sink*: it receives presence and
 * forwards it through the same `onActivity` callback the loopback TCP RPC uses.
 * The main process therefore has one feed and one bridge; the Rich Presence
 * plugin and the UI need no changes.
 *
 * A dedicated endpoint is deliberate. Discord IPC has no "watch another app's
 * presence" command: a producer pushes to whichever socket it connects to. So
 * Tumult listens on its own `discord-ipc-N` index (or an explicit path) instead
 * of impersonating or proxying Discord. When Discord is not running, Tumult
 * takes index 0 and producers find it with their usual scan; when Discord is
 * already running, Tumult takes the next free index and Discord keeps working.
 * A producer can always be pointed at a chosen path with `DISCORD_IPC_PATH` /
 * `DISCORD_IPC_SOCKET` (or the Tumult-specific `TUMULT_DISCORD_IPC_PATH`).
 *
 * Electron-free on purpose: `net`/`fs` only, so unit tests drive it with a real
 * socket. `main.ts` wires its callback to `BrowserWindow`s.
 */

import { lstat, unlink } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { posix } from "node:path";

import {
    activityFromSetActivity,
    commandReply,
    DISCORD_OP,
    DiscordFrameFramer,
    encodeDiscordFrame,
    handshakeReply,
} from "./discord-ipc.ts";
import type { NativeActivity } from "./native-wire.ts";

/** Discord tries ten IPC indices (0–9); so do we. */
const IPC_INDEXES = 10;

/** How long to wait for a claimed Unix socket to answer before treating it as stale. */
const LIVENESS_MS = 250;

/**
 * The socket paths to try, in Discord's own precedence order. An explicit
 * override is authoritative — a producer and a sink must agree on one path, so
 * we never silently fall back to a different one. Otherwise candidates are
 * generated for every platform-appropriate prefix and index.
 */
export function discordIpcSocketPaths(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): string[] {
    const explicit = env.TUMULT_DISCORD_IPC_PATH || env.DISCORD_IPC_PATH || env.DISCORD_IPC_SOCKET;
    if (explicit?.trim()) return [explicit.trim()];

    if (platform === "win32") {
        // Node's named-pipe namespace; Discord's docs spell it `\\?\pipe`, the
        // SDK and node.net use `\\.\pipe` — both name the same pipe.
        return Array.from({ length: IPC_INDEXES }, (_, index) => `\\\\.\\pipe\\discord-ipc-${index}`);
    }

    const prefixes = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, tmpdir(), "/tmp"]
        .filter((prefix): prefix is string => typeof prefix === "string" && prefix.trim().length > 0)
        .filter((prefix, index, all) => all.indexOf(prefix) === index);
    // POSIX joining even when this module is imported on Windows: the platform
    // argument describes the socket namespace being generated (and is how the
    // unit test checks the Unix order on any host), not the host's path spelling.
    return prefixes.flatMap((prefix) =>
        Array.from({ length: IPC_INDEXES }, (_, index) => posix.join(prefix, `discord-ipc-${index}`)),
    );
}

interface SocketIdentity {
    dev: number;
    ino: number;
}

async function socketIdentity(path: string): Promise<SocketIdentity | null> {
    try {
        const stat = await lstat(path);
        if (!stat.isSocket()) return null;
        return { dev: stat.dev, ino: stat.ino };
    } catch {
        return null;
    }
}

/** Whether something is actually accepting connections on a Unix socket path. */
function socketIsLive(path: string): Promise<boolean> {
    if (process.platform === "win32") return Promise.resolve(false);
    return new Promise((resolve) => {
        const socket = connect(path);
        let finished = false;
        const finish = (live: boolean) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            socket.removeAllListeners();
            socket.destroy();
            resolve(live);
        };
        const timer = setTimeout(() => finish(false), LIVENESS_MS);
        timer.unref?.();
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
    });
}

/** Bind one candidate, reclaiming a stale Unix socket but never a live one. */
async function bindCandidate(path: string): Promise<{ server: Server; identity: SocketIdentity | null } | null> {
    const previous = await socketIdentity(path);
    if (previous) {
        if (await socketIsLive(path)) return null;
        await unlink(path).catch(() => undefined);
    }

    const server = createServer();
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(path, () => {
                server.off("error", reject);
                resolve();
            });
        });
    } catch (error) {
        server.close();
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return null;
        throw error;
    }
    return { server, identity: await socketIdentity(path) };
}

export interface DiscordIpcServer {
    /** The socket path this server bound. */
    readonly path: string;
    /** Stop accepting, drop producers, remove our socket path, and resolve when done. */
    close(): Promise<void>;
}

export interface DiscordIpcServerOptions {
    /** Called with each validated activity, and with `null` on a producer's clear/quit. */
    onActivity: (activity: NativeActivity | null) => void;
    /** Override the environment/path search (tests and embedders). */
    env?: NodeJS.ProcessEnv;
    /** Override the platform's socket naming (tests). */
    platform?: NodeJS.Platform;
}

interface Producer {
    setSomething: boolean;
}

/**
 * Start a Discord-compatible IPC sink. If every candidate is occupied the
 * promise rejects and the caller degrades the bridge to empty, the same way a
 * taken native-activity port does — the app itself still runs.
 */
export async function startDiscordIpcServer(options: DiscordIpcServerOptions): Promise<DiscordIpcServer> {
    const paths = discordIpcSocketPaths(options.env ?? process.env, options.platform ?? process.platform);
    let lastOccupied = false;

    for (const path of paths) {
        const bound = await bindCandidate(path);
        if (!bound) {
            lastOccupied = true;
            continue;
        }
        return attach({ ...bound, path, onActivity: options.onActivity });
    }

    throw new Error(
        lastOccupied
            ? `every Discord IPC socket is occupied (tried ${paths.length}); set TUMULT_DISCORD_IPC_PATH to a free path`
            : "no Discord IPC socket path is available",
    );
}

function attach(options: {
    server: Server;
    path: string;
    identity: SocketIdentity | null;
    onActivity: (activity: NativeActivity | null) => void;
}): DiscordIpcServer {
    const { server, path, identity } = options;
    const sockets = new Set<Socket>();
    // Only the most recent producer owns the feed: an older connection closing
    // must not clear a newer producer's activity.
    let owner: Producer | null = null;
    let closed = false;

    // A late server-level error (the endpoint disappearing underneath us) must
    // not take down the main process; the bridge just stops receiving.
    server.on("error", (error: Error) => console.warn("[tumult] Discord IPC server error:", error.message));

    const publish = (activity: NativeActivity | null) => {
        try {
            options.onActivity(activity);
        } catch (error) {
            console.error("[tumult] Discord IPC activity callback failed", error);
        }
    };
    const send = (socket: Socket, frame: Buffer) => {
        if (!socket.destroyed) socket.write(frame);
    };

    server.on("connection", (socket: Socket) => {
        const producer: Producer = { setSomething: false };
        const framer = new DiscordFrameFramer();
        sockets.add(socket);

        socket.on("data", (chunk) => {
            for (const frame of framer.push(chunk)) {
                switch (frame.opcode) {
                    case DISCORD_OP.HANDSHAKE:
                        send(socket, handshakeReply());
                        break;
                    case DISCORD_OP.FRAME: {
                        const payload = frame.payload;
                        const cmd = typeof payload?.cmd === "string" ? payload.cmd : "";
                        const reply = commandReply(payload);
                        if (reply) send(socket, reply);
                        if (cmd === "SET_ACTIVITY") {
                            const change = activityFromSetActivity(payload);
                            if (change.kind === "set") {
                                owner = producer;
                                producer.setSomething = true;
                                publish(change.activity);
                            } else if (change.kind === "clear") {
                                if (owner === producer) {
                                    owner = null;
                                    producer.setSomething = false;
                                }
                                publish(null);
                            }
                        } else if (cmd === "CLEAR_ACTIVITY") {
                            // Not a Discord command, but some older RPC libraries
                            // use it to clear; accept it as the same intent.
                            if (owner === producer) {
                                owner = null;
                                producer.setSomething = false;
                            }
                            publish(null);
                        }
                        break;
                    }
                    case DISCORD_OP.PING: {
                        const nonce = frame.payload?.nonce;
                        send(socket, encodeDiscordFrame(DISCORD_OP.PONG, typeof nonce === "string" ? { nonce } : {}));
                        break;
                    }
                    case DISCORD_OP.CLOSE:
                        socket.destroy();
                        break;
                    default:
                        break;
                }
            }
        });

        socket.on("error", () => void socket.destroy());
        socket.on("close", () => {
            sockets.delete(socket);
            if (owner === producer && producer.setSomething) {
                owner = null;
                publish(null);
            }
        });
    });

    return {
        path,
        close() {
            if (closed) return Promise.resolve();
            closed = true;
            for (const socket of sockets) socket.destroy();
            const cleanup = async () => {
                if (identity && process.platform !== "win32") {
                    // Do not unlink a path another process has replaced with its
                    // own socket after we bound ours.
                    const current = await socketIdentity(path);
                    if (current && current.dev === identity.dev && current.ino === identity.ino) {
                        await unlink(path).catch(() => undefined);
                    }
                }
            };
            if (!server.listening) return cleanup();
            return new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    void cleanup().then(
                        () => (error ? reject(error) : resolve()),
                        (cleanupError: unknown) => reject(cleanupError),
                    );
                });
            });
        },
    };
}
