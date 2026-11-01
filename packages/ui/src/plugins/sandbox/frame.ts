/**
 * The sandbox lane's transport: an opaque-origin frame with a Worker inside it.
 *
 * Both halves live here, DOM-free (every browser object is injected), so the
 * handshake can be tested in-process:
 *
 *   - `createFrameTransport` is the HOST half. It looks like a Worker to
 *     `host.ts` (`SandboxTransport`), but behind it is a hidden
 *     `<iframe sandbox="allow-scripts">` the app mounts, a `MessageChannel`
 *     whose second port is handed to that frame, and a boot deadline.
 *   - `startSandboxFrame` is the FRAME half: the classic bootstrap script that
 *     runs inside the frame, accepts exactly one port from its parent, spawns
 *     the inner Worker that runs the plugin, and relays between the two.
 *
 * Why a frame and not a Worker of the app's own: a Worker shares the creating
 * document's ORIGIN, so a same-origin Worker could reach the app's IndexedDB
 * (the crypto store, the plugin store), its caches and its service worker
 * unless every such global was found and deleted first. A sandboxed frame
 * without `allow-same-origin` has an opaque origin, so the browser itself
 * refuses all of that — nothing to enumerate. The plugin still runs in a
 * Worker (made INSIDE the frame), because a cross-origin frame may share the
 * app's main thread: a busy loop in the frame itself could freeze the shell.
 *
 * Trust rests on the port, not on origins. The host must post to the opaque
 * frame with `targetOrigin: "*"` (an opaque origin has no name to target), and
 * the frame cannot check `event.origin` meaningfully either — so the frame
 * takes only the FIRST port, only from `event.source === parent`, and after
 * that every message travels over the private channel whose other end only
 * the host holds.
 */

import type { HostMessage } from "./protocol.ts";

/** Envelope kinds the frame bootstrap and the host transport exchange on the port. */
export const FRAME_MESSAGE = {
    /** frame → host: the port is accepted and the inner Worker exists. */
    booted: "tumult-sandbox:booted",
    /** frame → host: the inner Worker raised an error (it failed to load, or threw). */
    error: "tumult-sandbox:error",
    /** host → frame: stop the inner Worker now (the frame is removed right after). */
    terminate: "tumult-sandbox:terminate",
} as const;

/**
 * How long the frame has to load, take the port and spawn its Worker before
 * the plugin is failed. Generous: it is one static page and one script from
 * our own server, and a slow first boot must not disable a working plugin.
 */
export const FRAME_BOOT_TIMEOUT_MS = 15_000;

/** The `MessagePort` subset both halves use. */
export interface PortLike {
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    start(): void;
    close(): void;
}

/** What the host needs from the mounted frame element. */
export interface MountedFrame {
    /** Hand the port to the frame's window (`targetOrigin: "*"`, transferring `port`). */
    postPort(port: unknown): void;
    /** Detach the frame from the document, which ends everything inside it. */
    remove(): void;
}

/** The DOM the host transport is given (see `apps/web/src/plugins/installer.ts`). */
export interface FrameTransportDeps {
    /** Mount the hidden sandbox frame; `onLoad` fires once its document has loaded. */
    mountFrame(onLoad: () => void): MountedFrame;
    /** A fresh `MessageChannel`. */
    createChannel(): { port1: PortLike; port2: unknown };
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    bootTimeoutMs?: number;
}

type MessageListener = (event: { data: unknown }) => void;
type ErrorListener = (event: { message?: string }) => void;

/** The transport handle `host.ts` drives — the same shape as `SandboxTransport`. */
export interface FrameTransport {
    postMessage(message: HostMessage): void;
    terminate(): void;
    addEventListener(type: "message", listener: MessageListener): void;
    addEventListener(type: "error", listener: ErrorListener): void;
}

function envelopeKind(data: unknown): unknown {
    return typeof data === "object" && data !== null ? (data as { kind?: unknown }).kind : undefined;
}

/**
 * Open the frame and return a Worker-shaped handle over its port.
 *
 * Posts made before the frame reports `booted` are BUFFERED and flushed in
 * order (`host.ts` posts `init` synchronously after creating the transport).
 * No `booted` within the deadline is reported as an `error`, which the host
 * turns into `fail()` — a frame that never comes up fails the plugin closed
 * instead of leaving it registered and silent.
 */
export function createFrameTransport(deps: FrameTransportDeps): FrameTransport {
    const messageListeners: MessageListener[] = [];
    const errorListeners: ErrorListener[] = [];
    const buffer: HostMessage[] = [];
    const channel = deps.createChannel();
    const port = channel.port1;
    let booted = false;
    let closed = false;

    const raise = (message: string): void => {
        if (closed) return;
        for (const listener of [...errorListeners]) listener({ message });
    };

    const deadline = deps.setTimeout(() => {
        if (!booted) raise(`the sandbox frame did not start within ${deps.bootTimeoutMs ?? FRAME_BOOT_TIMEOUT_MS} ms`);
    }, deps.bootTimeoutMs ?? FRAME_BOOT_TIMEOUT_MS);

    port.addEventListener("message", (event) => {
        if (closed) return;
        const kind = envelopeKind(event.data);
        if (kind === FRAME_MESSAGE.booted) {
            if (booted) return;
            booted = true;
            deps.clearTimeout(deadline);
            for (const message of buffer.splice(0)) port.postMessage(message);
            return;
        }
        if (kind === FRAME_MESSAGE.error) {
            const message = (event.data as { message?: unknown }).message;
            raise(typeof message === "string" ? message : "the sandbox worker failed");
            return;
        }
        // Nothing the frame says counts before it has booted: only the
        // bootstrap speaks first, and it says `booted`.
        if (!booted) return;
        for (const listener of [...messageListeners]) listener({ data: event.data });
    });
    port.start();

    const frame = deps.mountFrame(() => {
        if (!closed) frame.postPort(channel.port2);
    });

    return {
        postMessage(message) {
            if (closed) return;
            if (booted) port.postMessage(message);
            else buffer.push(message);
        },
        terminate() {
            if (closed) return;
            closed = true;
            deps.clearTimeout(deadline);
            buffer.length = 0;
            // Best effort: the frame's removal below ends the Worker anyway,
            // but asking first stops it even if the removal is deferred.
            if (booted) port.postMessage({ kind: FRAME_MESSAGE.terminate });
            port.close();
            frame.remove();
        },
        addEventListener(type: "message" | "error", listener: MessageListener | ErrorListener) {
            if (type === "message") messageListeners.push(listener as MessageListener);
            else errorListeners.push(listener as ErrorListener);
        },
    };
}

/** The inner Worker, as the bootstrap sees it. */
export interface InnerWorker {
    postMessage(message: unknown): void;
    terminate(): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    addEventListener(type: "error", listener: (event: { message?: string; preventDefault?(): void }) => void): void;
}

/** What the frame bootstrap is given (see `apps/web/src/plugins/sandbox.frame.ts`). */
export interface SandboxFrameDeps {
    /** `window.parent` — the only window whose port is accepted. */
    parent: unknown;
    /** `window.addEventListener("message", …)`. */
    listen(listener: (event: { source: unknown; ports: readonly PortLike[] }) => void): void;
    /** Start the inner Worker that runs the sandbox runtime (`worker/shim.ts`). */
    createWorker(): InnerWorker;
}

/**
 * The frame bootstrap. Takes the FIRST port posted by the parent window and
 * ignores everything else (a second port, a message from any other source),
 * then relays: port → Worker, Worker → port, and a Worker `error` becomes a
 * `FRAME_MESSAGE.error` envelope so the host can fail the plugin.
 *
 * Returns whether a port has been accepted (for tests).
 */
export function startSandboxFrame(deps: SandboxFrameDeps): { accepted(): boolean } {
    let port: PortLike | null = null;

    deps.listen((event) => {
        if (port !== null) return;
        if (event.source !== deps.parent) return;
        const offered = event.ports[0];
        if (!offered) return;
        port = offered;
        const accepted = offered;

        let worker: InnerWorker;
        try {
            worker = deps.createWorker();
        } catch (error) {
            accepted.start();
            accepted.postMessage({ kind: FRAME_MESSAGE.error, message: error instanceof Error ? error.message : String(error) });
            return;
        }
        worker.addEventListener("message", (message) => accepted.postMessage(message.data));
        worker.addEventListener("error", (error) => {
            error.preventDefault?.();
            accepted.postMessage({ kind: FRAME_MESSAGE.error, message: error.message || "the sandbox worker failed" });
        });
        accepted.addEventListener("message", (message) => {
            if (envelopeKind(message.data) === FRAME_MESSAGE.terminate) {
                worker.terminate();
                accepted.close();
                return;
            }
            worker.postMessage(message.data);
        });
        accepted.start();
        accepted.postMessage({ kind: FRAME_MESSAGE.booted });
    });

    return { accepted: () => port !== null };
}
