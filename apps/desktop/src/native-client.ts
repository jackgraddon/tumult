/**
 * The native activity CLIENT — the reference producer a real native app links
 * against (and the demo in `demo/` runs). It is the sending half of the same
 * wire as the server (`native-activity.ts`): it opens a loopback connection to
 * the RPC the desktop app serves and pushes one newline-terminated frame per
 * change. Pure `node:net`, no Electron — this is the "template real apps copy",
 * so it shares `native-wire.ts` and knows nothing of the main process.
 *
 * Contract the client enforces:
 *   - it is the app's authoritative intent: `set`/`clear` hold the last value
 *     the producer wants the feed to show, and every (re)connect re-asserts it,
 *     so a restart of the app does not leave a stale activity;
 *   - a producer that quits must clear: `stop()` writes a `clear` before it
 *     destroys the socket, so a closed/crashed app never leaves a ghost on the
 *     feed (the CLI wires that to SIGINT/SIGTERM/exit — the library stays free
 *     of process signals, so it is portable as a linked library);
 *   - it never frames a malformed `set`: an invalid push is rejected, so the
 *     last good value — not a cleared feed — survives.
 */

import { connect, type Socket } from "node:net";

import { encodeNativeActivity, encodeNativeClear, resolveNativeActivityPort, type NativeActivity } from "./native-wire.ts";

/** What {@link NativeActivityClient.onEvent} can surface to a producer. */
export type NativeActivityClientEvent =
    | { type: "connected" }
    | { type: "disconnected" }
    | { type: "retry"; attempt: number; delayMs: number };

export interface NativeActivityClientOptions {
    /** Host to connect to. Defaults to `127.0.0.1` — loopback only, never `0.0.0.0`. */
    host?: string;
    /** Port to connect to. Defaults to {@link resolveNativeActivityPort}. */
    port?: number;
    /** Base delay (ms) between reconnect attempts; doubled per failure, then capped. Default 250. */
    backoffMs?: number;
    /** The cap on the backoff delay. Default 5000. */
    backoffMaxMs?: number;
    /** Optional hook for a producer that wants to log/observe the connection. */
    onEvent?: (event: NativeActivityClientEvent) => void;
}

export class NativeActivityClient {
    private socket: Socket | null = null;
    /** The `set` frame we intend the feed to hold, pre-encoded, or `null` for "clear". */
    private desired: string | null = null;
    /** Whether we have put a `set` on the wire at any point — a clear on reconnect is only worth it then. */
    private haveSetSent = false;
    private stopped = false;
    private attempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /** A connection we are waiting to establish; destroyed by {@link stop} so it cannot outlive the client. */
    private pendingSocket: Socket | null = null;
    private readonly host: string;
    private readonly port: number;
    private readonly backoffMs: number;
    private readonly backoffMaxMs: number;
    private readonly onEvent: ((event: NativeActivityClientEvent) => void) | undefined;
    private readonly clearFrame = encodeNativeClear();

    constructor(options: NativeActivityClientOptions = {}) {
        this.host = options.host ?? "127.0.0.1";
        this.port = options.port ?? resolveNativeActivityPort();
        this.backoffMs = options.backoffMs ?? 250;
        this.backoffMaxMs = options.backoffMaxMs ?? 5000;
        this.onEvent = options.onEvent;
    }

    /** Whether a socket is currently connected and can carry a frame the moment it is written. */
    isConnected(): boolean {
        // `readyState` is "open" on a connected socket; the public `.connected`
        // flag is unreliable on recent Node (it can read `undefined` on a
        // socket that is in fact open), so judge on `readyState` instead.
        return this.socket?.readyState === "open";
    }

    /** Whether the client has been stopped and will no longer connect. */
    isStopped(): boolean {
        return this.stopped;
    }

    /**
     * Begin connecting, and keep reconnecting until {@link stop}. Resolves on the
     * first successful connection; an app that is not up yet is retried (with
     * backoff), not treated as an error, so a producer may start before the app.
     */
    start(): Promise<void> {
        if (this.stopped) return Promise.reject(new Error("native activity client was stopped before it could connect"));
        return this.connectWithBackoff();
    }

    /**
     * Report an activity. Returns `false` (without touching the feed) when it is
     * not a valid one — a malformed push never reaches the feed. When connected
     * it is written at once; otherwise it is held and asserted on the next connect.
     */
    set(activity: NativeActivity): boolean {
        if (this.stopped) return false;
        const frame = encodeNativeActivity(activity);
        if (!frame) return false;
        this.desired = frame;
        this.write(frame);
        this.haveSetSent = true;
        return true;
    }

    /** Clear the feed the moment the producer is idle. Held on a disconnect, asserted on reconnect. */
    clear(): void {
        if (this.stopped) return;
        this.desired = null;
        this.write(this.clearFrame);
    }

    /**
     * Stop the client. Writes a `clear` (so the feed drops our activity) and
     * closes the connection gracefully — the clear is flushed over the socket
     * before it is closed — and cancels any pending reconnect. Idempotent.
     */
    stop(): Promise<void> {
        if (this.stopped) return Promise.resolve();
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const socket = this.socket;
        this.socket = null;
        // Abort a connection still establishing: a producer that quits must not
        // leave a half-open socket waiting on a port that may never answer.
        this.pendingSocket?.destroy();
        this.pendingSocket = null;
        // Judge "can carry the clear" on readyState, not the unreliable `.connected`.
        if (!socket || socket.readyState !== "open") return Promise.resolve();
        // A clear reaches the feed only if it is held somewhere; skip the write
        // when the feed already holds nothing, so a no-op stop sends no bytes.
        if (this.haveSetSent || this.desired) void socket.write(this.clearFrame);
        return new Promise<void>((resolve) => {
            socket.once("close", () => resolve());
            // `end` (not `destroy`) flushes the pending write, so the clear lands.
            socket.end();
        });
    }

    // ── Connection machinery ──────────────────────────────────────────────

    private async connectWithBackoff(): Promise<void> {
        for (;;) {
            if (this.stopped) {
                if (this.attempt === 0) throw new Error("native activity client was stopped before it could connect");
                return;
            }
            let socket: Socket;
            try {
                socket = await this.connectOnce();
            } catch {
                this.attempt++;
                const delayMs = this.backoff();
                this.onEvent?.({ type: "retry", attempt: this.attempt, delayMs });
                await this.delay(delayMs);
                continue;
            }
            this.attempt = 0;
            this.socket = socket;
            this.attach(socket);
            this.assertDesired();
            this.onEvent?.({ type: "connected" });
            return;
        }
    }

    private connectOnce(): Promise<Socket> {
        return new Promise<Socket>((resolve, reject) => {
            const socket = connect(this.port, this.host);
            this.pendingSocket = socket;
            // The reconnect delay is unref'd so a test that stops it cannot keep
            // the process alive; a LIVE connection is not, because staying up is
            // the point of a producer that watches an app.
            socket.setTimeout(0);
            socket.once("connect", () => {
                this.pendingSocket = null;
                resolve(socket);
            });
            socket.once("error", (error) => {
                this.pendingSocket = null;
                socket.destroy();
                reject(error);
            });
        });
    }

    private attach(socket: Socket): void {
        socket.on("close", () => {
            if (this.socket !== socket) return; // a newer connection superseded it.
            this.socket = null;
            this.onEvent?.({ type: "disconnected" });
            if (this.stopped) return;
            void this.scheduleReconnect();
        });
        socket.on("error", () => {
            // An errored socket is finished; `close` will fire and drive reconnect.
            socket.destroy();
        });
    }

    private async scheduleReconnect(): Promise<void> {
        this.attempt++;
        const delayMs = this.backoff();
        this.onEvent?.({ type: "retry", attempt: this.attempt, delayMs });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connectWithBackoff().catch(() => undefined);
        }, delayMs);
        this.reconnectTimer.unref?.();
    }

    /** On any (re)connect, re-assert the value we intend the feed to hold. */
    private assertDesired(): void {
        if (this.desired) {
            this.write(this.desired);
        } else if (this.haveSetSent) {
            // We put a `set` on the wire before this connection; a clear is the
            // value we now want, so send it (a first connect with nothing sent
            // sends nothing, so it never clobbers another producer's feed).
            this.write(this.clearFrame);
        }
    }

    private write(frame: string): boolean {
        if (!this.isConnected() || this.stopped) return false;
        this.socket?.write(frame);
        return true;
    }

    private backoff(): number {
        const delay = this.backoffMs * 2 ** this.attempt;
        return Math.min(delay, this.backoffMaxMs);
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, ms);
            timer.unref?.();
        });
    }
}
