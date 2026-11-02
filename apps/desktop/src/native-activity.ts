/**
 * The native activity RPC, its *receiving* side: a loopback `net` server the
 * native app connects to, wired to the main process's windows.
 *
 * The pure wire — the message shape, the validation, the newline framing and the
 * port choice — lives in `native-wire.ts`, so this half and a native producer
 * (`native-client.ts`, or the reference demo in `demo/`) speak the same format
 * and cannot drift. When a native client (a game, a media player, an editor)
 * opens a connection it sends one newline-terminated JSON object per change
 * (see `native-wire.ts`); each frame is broadcast to every window over
 * `NATIVE_ACTIVITY_IPC`, and the preload surfaces it as `window.tumultNative`
 * (the bridge the shell's `createNativeActivityFeed` reads). On the web there is
 * no such bridge, so the native feed is empty and a consumer degrades to the
 * plain status line.
 *
 * Loopback only (`127.0.0.1`): the only clients are native processes on this
 * machine, which is the whole point of the narrow exception. The server and its
 * hub logic are pure of Electron and unit tested in isolation
 * (`test/native-activity.test.ts`); `main.ts` wires the hub callback to
 * `BrowserWindow`s.
 */

import { createServer, type Server, type Socket } from "node:net";

import { NATIVE_ACTIVITY_IPC } from "../../web/src/desktop.ts";

// The pure wire, re-exported so callers of this module keep one import point;
// the server below reuses the names it needs (a local import, since `export *`
// only passes names on to consumers, it does not bring them into this scope).
import { LineFramer, parseNativeActivityLine, type NativeActivity, validateNativeActivity } from "./native-wire.ts";
export * from "./native-wire.ts";

export { NATIVE_ACTIVITY_IPC };

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
