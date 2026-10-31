/**
 * Tests the sandbox lane's transport (`sandbox/frame.ts`): the host half that
 * looks like a Worker to `host.ts`, and the frame bootstrap that accepts the
 * port and relays to the inner Worker. Every browser object is a fake, so the
 * properties the security story rests on are pinned without a browser:
 *
 *   - posts before the frame boots are buffered and flushed in order;
 *   - no boot within the deadline is an `error` → `fail()` (fails closed);
 *   - the bootstrap takes only the FIRST port, only from its parent;
 *   - `terminate()` stops the Worker, closes the port and removes the frame;
 *   - an inner Worker error becomes an `error` on the host → `fail()`.
 *
 * The browser half (opaque origin, real frame, real Worker) is the smoke test's.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    FRAME_BOOT_TIMEOUT_MS,
    FRAME_MESSAGE,
    createFrameTransport,
    startSandboxFrame,
} from "../src/plugins/sandbox/frame.ts";
import type { FrameTransportDeps, InnerWorker, PortLike } from "../src/plugins/sandbox/frame.ts";
import { sandboxPlugin } from "../src/plugins/sandbox/host.ts";
import type { HostMessage } from "../src/plugins/sandbox/protocol.ts";
import type { PluginContext, PluginManifest } from "../src/plugins/types.ts";

// ── Fakes ───────────────────────────────────────────────────────────────────

interface FakePort extends PortLike {
    other: FakePort | null;
    started: boolean;
    closed: boolean;
    queue: unknown[];
    listeners: ((event: { data: unknown }) => void)[];
}

/** An entangled port pair; delivery is synchronous once the receiver is started. */
function makeChannel(): { port1: FakePort; port2: FakePort } {
    const make = (): FakePort => {
        const port: FakePort = {
            other: null,
            started: false,
            closed: false,
            queue: [],
            listeners: [],
            postMessage(message) {
                if (port.closed || !port.other || port.other.closed) return;
                const data = structuredClone(message);
                if (port.other.started) for (const listener of [...port.other.listeners]) listener({ data });
                else port.other.queue.push(data);
            },
            addEventListener(_type, listener) {
                port.listeners.push(listener);
            },
            start() {
                if (port.started) return;
                port.started = true;
                for (const data of port.queue.splice(0)) for (const listener of [...port.listeners]) listener({ data });
            },
            close() {
                port.closed = true;
            },
        };
        return port;
    };
    const port1 = make();
    const port2 = make();
    port1.other = port2;
    port2.other = port1;
    return { port1, port2 };
}

/** Fake timers: `fire()` runs every pending callback. */
function makeTimers(): Pick<FrameTransportDeps, "setTimeout" | "clearTimeout"> & { fire(): void; pending(): number; lastMs: number } {
    const pending = new Map<number, () => void>();
    let next = 1;
    const timers = {
        lastMs: 0,
        setTimeout(callback: () => void, ms: number) {
            timers.lastMs = ms;
            const id = next++;
            pending.set(id, callback);
            return id;
        },
        clearTimeout(handle: unknown) {
            pending.delete(handle as number);
        },
        fire() {
            for (const [id, callback] of [...pending]) {
                pending.delete(id);
                callback();
            }
        },
        pending: () => pending.size,
    };
    return timers;
}

/** A fake inner Worker that records what it is sent and can speak/fail. */
function makeInnerWorker(): InnerWorker & {
    received: unknown[];
    terminated: boolean;
    emit(data: unknown): void;
    crash(message: string): { prevented: boolean };
} {
    const messageListeners: ((event: { data: unknown }) => void)[] = [];
    const errorListeners: ((event: { message?: string; preventDefault?(): void }) => void)[] = [];
    const worker = {
        received: [] as unknown[],
        terminated: false,
        postMessage(message: unknown) {
            worker.received.push(message);
        },
        terminate() {
            worker.terminated = true;
        },
        addEventListener(type: "message" | "error", listener: never) {
            if (type === "message") messageListeners.push(listener);
            else errorListeners.push(listener);
        },
        emit(data: unknown) {
            for (const listener of messageListeners) listener({ data });
        },
        crash(message: string) {
            const outcome = { prevented: false };
            for (const listener of errorListeners) listener({ message, preventDefault: () => (outcome.prevented = true) });
            return outcome;
        },
    };
    return worker;
}

/**
 * The whole lane wired together: a host transport whose mounted "frame" runs
 * the real bootstrap. `load()` fires the frame's load event (the host then
 * posts the port); nothing boots before it.
 */
function makeLane(options: { bootTimeoutMs?: number; createWorker?: () => InnerWorker } = {}) {
    const timers = makeTimers();
    const parent = { name: "parent window" };
    const inner = makeInnerWorker();
    let frameListener: ((event: { source: unknown; ports: readonly PortLike[] }) => void) | null = null;
    let onLoad: (() => void) | null = null;
    let removed = 0;
    let channel: { port1: FakePort; port2: FakePort } | null = null;

    startSandboxFrame({
        parent,
        listen: (listener) => {
            frameListener = listener;
        },
        createWorker: options.createWorker ?? (() => inner),
    });

    const transport = createFrameTransport({
        mountFrame(load) {
            onLoad = load;
            return {
                postPort(port) {
                    frameListener?.({ source: parent, ports: [port as PortLike] });
                },
                remove() {
                    removed += 1;
                },
            };
        },
        createChannel: () => {
            channel = makeChannel();
            return channel;
        },
        ...timers,
        ...(options.bootTimeoutMs === undefined ? {} : { bootTimeoutMs: options.bootTimeoutMs }),
    });

    const messages: unknown[] = [];
    const errors: (string | undefined)[] = [];
    transport.addEventListener("message", (event) => messages.push(event.data));
    transport.addEventListener("error", (event) => errors.push(event.message));

    return {
        transport,
        timers,
        inner,
        parent,
        messages,
        errors,
        load: () => onLoad?.(),
        removed: () => removed,
        channel: () => channel!,
        deliver: (event: { source: unknown; ports: readonly PortLike[] }) => frameListener?.(event),
    };
}

const INIT: HostMessage = { kind: "dispose" };
const OTHER: HostMessage = { kind: "invoke", id: 1, args: ["c1"] };

// ── Host transport ──────────────────────────────────────────────────────────

describe("createFrameTransport", () => {
    it("buffers posts until the frame boots, then flushes them in order", () => {
        const lane = makeLane();
        lane.transport.postMessage(INIT);
        lane.transport.postMessage(OTHER);
        assert.deepEqual(lane.inner.received, [], "nothing may reach the worker before the port is handed over");
        lane.load();
        assert.deepEqual(lane.inner.received, [INIT, OTHER]);
        lane.transport.postMessage(INIT);
        assert.deepEqual(lane.inner.received, [INIT, OTHER, INIT], "after boot, posts go straight through");
        assert.equal(lane.timers.pending(), 0, "the boot deadline is cleared once booted");
        assert.deepEqual(lane.errors, []);
    });

    it("relays the worker's messages to the host's message listeners", () => {
        const lane = makeLane();
        lane.load();
        lane.inner.emit({ kind: "ready", ok: true });
        assert.deepEqual(lane.messages, [{ kind: "ready", ok: true }]);
    });

    it("fails closed when the frame never boots within the deadline", () => {
        const lane = makeLane({ bootTimeoutMs: 1234 });
        assert.equal(lane.timers.lastMs, 1234);
        lane.transport.postMessage(INIT);
        lane.timers.fire();
        assert.equal(lane.errors.length, 1);
        assert.match(lane.errors[0] ?? "", /did not start within 1234 ms/);
        assert.deepEqual(lane.inner.received, [], "a frame that never booted was never sent the bundle");
    });

    it("uses the default deadline when none is given", () => {
        const lane = makeLane();
        assert.equal(lane.timers.lastMs, FRAME_BOOT_TIMEOUT_MS);
    });

    it("ignores frame chatter that arrives before `booted`", () => {
        const timers = makeTimers();
        let channel: ReturnType<typeof makeChannel> | null = null;
        const transport = createFrameTransport({
            mountFrame: () => ({ postPort: () => undefined, remove: () => undefined }),
            createChannel: () => (channel = makeChannel()),
            ...timers,
        });
        const seen: unknown[] = [];
        transport.addEventListener("message", (event) => seen.push(event.data));
        channel!.port2.start();
        channel!.port2.postMessage({ kind: "ready", ok: true });
        assert.deepEqual(seen, []);
        channel!.port2.postMessage({ kind: FRAME_MESSAGE.booted });
        channel!.port2.postMessage({ kind: "ready", ok: true });
        assert.deepEqual(seen, [{ kind: "ready", ok: true }]);
    });

    it("terminate stops the worker, closes the port, removes the frame, and goes quiet", () => {
        const lane = makeLane();
        lane.load();
        lane.transport.terminate();
        assert.equal(lane.inner.terminated, true, "the inner worker was told to stop");
        assert.equal(lane.channel().port1.closed, true, "the host's port is closed");
        assert.equal(lane.removed(), 1, "the frame was removed");
        lane.transport.postMessage(INIT);
        lane.inner.emit({ kind: "ready", ok: true });
        lane.timers.fire();
        assert.deepEqual(lane.messages, []);
        assert.deepEqual(lane.errors, [], "a terminated transport raises nothing, not even its deadline");
        lane.transport.terminate();
        assert.equal(lane.removed(), 1, "terminate is idempotent");
    });

    it("terminate before boot never hands the port over and clears the deadline", () => {
        const lane = makeLane();
        lane.transport.postMessage(INIT);
        lane.transport.terminate();
        lane.load();
        assert.deepEqual(lane.inner.received, []);
        assert.equal(lane.timers.pending(), 0);
        assert.equal(lane.removed(), 1);
    });

    it("turns an inner worker error into an `error` event", () => {
        const lane = makeLane();
        lane.load();
        const outcome = lane.inner.crash("SyntaxError: bad bundle");
        assert.deepEqual(lane.errors, ["SyntaxError: bad bundle"]);
        assert.equal(outcome.prevented, true, "the bootstrap handles the error rather than letting it surface in the frame");
    });

    it("reports a worker that could not even be constructed", () => {
        const lane = makeLane({
            createWorker: () => {
                throw new Error("worker-src refused");
            },
        });
        lane.load();
        assert.deepEqual(lane.errors, ["worker-src refused"]);
    });
});

// ── Frame bootstrap ─────────────────────────────────────────────────────────

describe("startSandboxFrame", () => {
    it("accepts only the FIRST port, and only from its parent", () => {
        const parent = {};
        const workers: ReturnType<typeof makeInnerWorker>[] = [];
        let listener: ((event: { source: unknown; ports: readonly PortLike[] }) => void) | null = null;
        const frame = startSandboxFrame({
            parent,
            listen: (l) => (listener = l),
            createWorker: () => {
                const worker = makeInnerWorker();
                workers.push(worker);
                return worker;
            },
        });

        const stranger = makeChannel();
        listener!({ source: { not: "the parent" }, ports: [stranger.port2] });
        assert.equal(frame.accepted(), false, "a port from any other window is ignored");
        listener!({ source: parent, ports: [] });
        assert.equal(frame.accepted(), false, "a message with no port is ignored");

        const first = makeChannel();
        const firstSeen: unknown[] = [];
        first.port1.addEventListener("message", (event) => firstSeen.push(event.data));
        first.port1.start();
        listener!({ source: parent, ports: [first.port2] });
        assert.equal(frame.accepted(), true);
        assert.deepEqual(firstSeen, [{ kind: FRAME_MESSAGE.booted }]);

        const second = makeChannel();
        const secondSeen: unknown[] = [];
        second.port1.addEventListener("message", (event) => secondSeen.push(event.data));
        second.port1.start();
        listener!({ source: parent, ports: [second.port2] });
        assert.equal(workers.length, 1, "a second port never starts a second worker");
        assert.deepEqual(secondSeen, [], "a second port is never answered");
        second.port1.postMessage(INIT);
        assert.deepEqual(workers[0]?.received, [], "a second port cannot reach the worker");
        first.port1.postMessage(INIT);
        assert.deepEqual(workers[0]?.received, [INIT], "the first port still can");
    });
});

// ── Through host.ts ─────────────────────────────────────────────────────────

describe("sandboxPlugin over the frame transport", () => {
    const MANIFEST: PluginManifest = { id: "cc.example.frame", name: "Frame", version: "1.0.0", permissions: ["styles"] };

    it("a frame that never boots fails the plugin", () => {
        const lane = makeLane();
        const failures: string[] = [];
        const facade = sandboxPlugin(
            { manifest: MANIFEST, bundle: "// x" },
            { createTransport: () => lane.transport, onFailed: (_id, error) => failures.push(error.message) },
        );
        facade.install({} as PluginContext);
        lane.timers.fire();
        assert.equal(failures.length, 1);
        assert.match(failures[0] ?? "", /did not start/);
        assert.equal(lane.removed(), 1, "fail() tears the frame down");
    });

    it("an inner worker error fails the plugin and tears the frame down", () => {
        const lane = makeLane();
        const failures: string[] = [];
        const facade = sandboxPlugin(
            { manifest: MANIFEST, bundle: "// x" },
            { createTransport: () => lane.transport, onFailed: (_id, error) => failures.push(error.message) },
        );
        facade.install({} as PluginContext);
        lane.load();
        assert.equal((lane.inner.received[0] as { kind?: string }).kind, "init", "init was buffered and delivered after boot");
        lane.inner.crash("boom");
        assert.deepEqual(failures, ["boom"]);
        assert.equal(lane.inner.terminated, true);
        assert.equal(lane.removed(), 1);
    });
});
