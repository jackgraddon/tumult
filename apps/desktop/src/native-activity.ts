/**
 * The native activity RPC: how a desktop app pushes "what I'm doing" into Tumult.
 *
 * On desktop the shell breaks its bridge-less stance — deliberately, as the one
 * narrow, declared exception (see `plugins/native-activity.ts`) — by running a
 * loopback RPC server the native app connects to. A native client (a game, a
 * media player, an editor) opens a connection and sends one newline-terminated
 * JSON object per change:
 *
 *   {"op":"set","value":{"type":"playing","name":"VLC","details":"…"}}
 *   {"op":"clear"}
 *
 * The server broadcasts the result to every window over `NATIVE_ACTIVITY_IPC`,
 * and the preload surfaces it as `window.tumultNative` (the bridge the shell's
 * `createNativeActivityFeed` reads). On the web there is no such bridge, so the
 * native feed is empty and a consumer degrades to the plain status line.
 *
 * This module is the producer-agnostic middle: it validates the wire shape the
 * SAME way the rich-presence plugin validates its own `NativeActivity` (the host
 * stays a relay, not a producer, so no `source`/`assets` discriminator) and the
 * loopback-only server, so a native app on this machine is the only thing that
 * can push. Pure of Electron — the `net` server and the hub logic are unit
 * tested in isolation (`test/native-activity.test.ts`); `main.ts` wires them to
 * `BrowserWindow`s.
 */

import { createServer, type Server, type Socket } from "node:net";

import { NATIVE_ACTIVITY_IPC } from "../../web/src/desktop.ts";

export { NATIVE_ACTIVITY_IPC };

/**
 * One native/RPC activity, the rich-presence vocabulary on the wire. Mirrors the
 * plugin's `NativeActivity` (and the feed's same-named type): the host has no
 * notion of a `source` or `assets`, because producers coordinate client-side
 * (last-writer-wins), the way a manual `/activity` and a native one do. Field
 * caps below are enforced by the producer before it reaches the host, and
 * {@link validateNativeActivity} re-checks them so a malformed push never lands
 * on the feed.
 */
export interface NativeActivity {
    /** What the app is doing — the rich-presence vocabulary. */
    type: "playing" | "listening" | "watching" | "custom";
    /** The headline, e.g. "Visual Studio Code", "VLC", "Spotify". */
    name: string;
    /** A second line of context, e.g. a file or track name. */
    details?: string;
    /** A third line, e.g. a progress or current state. */
    state?: string;
    /** Epoch milliseconds the activity started, when the caller knows it. */
    startedAt?: number;
    /** A short emoji to show by the headline. */
    emoji?: string;
}

/** The rich-presence types a native app may push. */
export const NATIVE_ACTIVITY_TYPES = ["playing", "listening", "watching", "custom"] as const;

/** Field caps, kept in sync with the rich-presence plugin's `LIMITS`. */
const NAME_MAX = 128;
const LINE_MAX = 256;
const EMOJI_MAX = 32;

/** A single wire message: a `set` with a `value`, or a bare `clear`. */
export interface NativeActivityMessage {
    op: "set" | "clear";
    value?: unknown;
}

/**
 * Whether `raw` is the `value` of a `set` message, and if so the normalized
 * activity. Trims each string, drops empty optionals, caps lengths, and requires
 * a known `type` and a non-empty `name` (1–{@link NAME_MAX}). Any other shape is
 * not an activity, so a caller leaves the field as it was rather than clearing
 * it on garbage.
 */
export function validateNativeActivity(raw: unknown): NativeActivity | null {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const any = raw as Record<string, unknown>;

    const type = any.type;
    if (typeof type !== "string" || !(NATIVE_ACTIVITY_TYPES as readonly string[]).includes(type)) return null;

    const name = trimLen(any.name, NAME_MAX);
    if (!name) return null;

    const activity: NativeActivity = { type: type as NativeActivity["type"], name };
    const details = trimLen(any.details, LINE_MAX);
    const state = trimLen(any.state, LINE_MAX);
    const emoji = trimLen(any.emoji, EMOJI_MAX);
    // `exactOptionalPropertyTypes`: only ever set when non-empty.
    if (details) activity.details = details;
    if (state) activity.state = state;
    if (emoji) activity.emoji = emoji;
    if (typeof any.startedAt === "number" && Number.isFinite(any.startedAt)) activity.startedAt = any.startedAt as number;
    return activity;
}

/** Trim and cap a string field; empty or non-string → `undefined` (dropped). */
function trimLen(value: unknown, max: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * A newline-framed reader: feed it `Socket`'s `data` chunks and it yields the
 * complete JSON text of every whole line received so far, holding back a partial
 * final line for the next chunk. A line longer than {@link MAX_LINE} (with no
 * newline) is dropped, so a producer that never terminates its frames cannot
 * grow the buffer without bound.
 */
const MAX_LINE = 64 * 1024;

export class LineFramer {
    private pending = Buffer.alloc(0);

    /** Push a read chunk; returns the complete line texts it now holds. */
    push(chunk: Buffer): string[] {
        this.pending = Buffer.concat([this.pending, chunk]);
        const out: string[] = [];
        let newline = this.pending.indexOf(0x0a);
        while (newline !== -1) {
            const line = this.pending.subarray(0, newline).toString("utf8");
            this.pending = this.pending.subarray(newline + 1);
            out.push(line);
            newline = this.pending.indexOf(0x0a);
        }
        // Guard a never-terminated, ever-growing final partial line.
        if (this.pending.length > MAX_LINE) this.pending = Buffer.alloc(0);
        return out;
    }
}

/** Parse and validate one whole wire line; `null` when it is not a message. */
export function parseNativeActivityLine(line: string): NativeActivityMessage | null {
    let message: unknown;
    try {
        message = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
    const any = message as Record<string, unknown>;
    if (any.op === "clear") return { op: "clear" };
    if (any.op === "set") return { op: "set", value: any.value };
    return null;
}

/**
 * A loopback RPC server a native app connects to. Loopback only (`127.0.0.1`,
 * never `0.0.0.0`): the only clients are native processes on this machine, which
 * is the whole point of the narrow exception. Each connection is a fresh framer,
 * so producers never interleave. A connection is dropped on error or on the
 * socket's end; the server keeps listening for the next one.
 */
export interface NativeActivityServer {
    /** The port actually bound (useful when {@link NativeActivityServerOptions.port} is `0`). */
    readonly port: number;
    /** Stop accepting and close open connections; resolves when done. */
    close(): Promise<void>;
}

export interface NativeActivityServerOptions {
    /** Bind port; `0` binds an ephemeral one and reports it via {@link NativeActivityServer.port}. */
    port: number;
    /** Called on every accepted `set` (with the validated activity) and `clear` (with `null`). */
    onActivity: (activity: NativeActivity | null) => void;
}

export function startNativeActivityServer(options: NativeActivityServerOptions): Promise<NativeActivityServer> {
    let settled = false;
    const server: Server = createServer((socket: Socket) => {
        const framer = new LineFramer();
        socket.on("data", (chunk) => {
            for (const line of framer.push(chunk)) {
                const message = parseNativeActivityLine(line);
                if (message?.op === "clear") {
                    options.onActivity(null);
                } else if (message?.op === "set") {
                    const activity = validateNativeActivity(message.value);
                    // A malformed `set` is ignored: leave whatever is current,
                    // never clear on garbage.
                    if (activity) options.onActivity(activity);
                }
            }
        });
        // Drop the connection quietly; the server stays up for the next client.
        socket.on("error", () => void socket.destroy());
        socket.on("close", () => void socket.destroy());
    });

    server.on("error", (error: Error) => {
        // The port can be taken (another instance or another process on it): the
        // native bridge then simply stays empty — the same degradation the web
        // sees — so the app still runs.
        console.warn("[tumult] native activity server error:", error.message);
    });

    // Listen only after we know the port the OS actually bound, so `port` is the
    // real address (a `0` request resolves to an ephemeral port) without a race.
    return new Promise<NativeActivityServer>((resolve, reject) => {
        server.once("error", (error) => reject(error));
        server.listen(options.port, "127.0.0.1", () => {
            const address = server.address();
            const boundPort = typeof address === "object" && address ? address.port : options.port;
            resolve({
                port: boundPort,
                close() {
                    if (settled) return Promise.resolve();
                    settled = true;
                    return new Promise<void>((resolveClose, rejectClose) =>
                        server.close((error) => (error ? rejectClose(error) : resolveClose())),
                    );
                },
            });
        });
    }).catch((error) => {
        server.close();
        throw error;
    });
}

/**
 * The port to bind, from the environment. A fixed loopback port lets a co-located
 * native app find the app; `TUMULT_NATIVE_ACTIVITY_PORT` overrides it (the smoke
 * test uses an ephemeral one so CI never collides with a running app). An
 * empty/invalid value keeps the default.
 */
const DEFAULT_PORT = 18731;

export function resolveNativeActivityPort(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.TUMULT_NATIVE_ACTIVITY_PORT;
    if (!raw) return DEFAULT_PORT;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}