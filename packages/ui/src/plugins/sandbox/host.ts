/**
 * The host half of the sandbox bridge: turn a verified bundle into a `Plugin`.
 *
 * A sandbox-lane plugin is, from `PluginRegistry`'s point of view, an ordinary
 * `Plugin` — same interface, same lifecycle, same permission gate. What makes it
 * sandboxed is where the plugin's CODE runs: not here. `sandboxPlugin()` returns
 * a facade whose `install(ctx)` boots a Worker, ships it the bundle plus a
 * serialized manifest, and then answers the Worker's requests against the real
 * `ctx` the shell handed over.
 *
 * The double enforcement the lane rule promises is preserved by construction:
 *
 *   - **Where it loads** is decided before this function is called (`deriveLane`),
 *     by the installer; nothing here can be talked out of it.
 *   - **What the bridge answers** is the real `ctx` — the SAME permission-checked
 *     `PluginApi` `install()` produces for an in-page plugin. A sandbox plugin
 *     that asks for `addRenderer` gets the registry's permission refusal, because
 *     the contribution is applied through `ctx.addRenderer`, not a parallel path.
 *     There is no second gate to keep in step.
 *
 * **Failure is asynchronous and honest.** `install()` is synchronous by contract,
 * but a Worker handshake is not, so the facade registers immediately and
 * contributes as messages arrive. Anything that goes wrong later (a Worker crash,
 * a throwing `install()`, a bad bundle) routes through `onFailed`, which the
 * caller maps to "uninstall and disable the record". Nothing is faked as loaded.
 */

import type { Subscribable, Subscription } from "@tumult/core/contract";

import type { Plugin, PluginContext, PluginManifest } from "../types.ts";
import {
    CLIENT_FEED_METHODS,
    CLIENT_FEEDS,
    CLIENT_METHODS,
    CONTEXT_METHODS,
    INVOKE_FN,
    SANDBOX_PROTOCOL_VERSION,
    wireError,
    type ContextMethod,
    type HostMessage,
    type SandboxCapabilities,
    type WorkerMessage,
} from "./protocol.ts";
import { checkCall, invocationRoom } from "./policy.ts";

/** A `Worker`-shaped handle, so `@tumult/ui` never names the DOM type itself. */
export interface SandboxWorker {
    postMessage(message: HostMessage): void;
    terminate(): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
}

/** What the app must supply to open a Worker — the only DOM coupling. */
export interface SandboxHost {
    /** Start a module Worker that imports `sandbox/shim.ts` and runs the bundle. */
    createWorker(): SandboxWorker;
    /**
     * Called when the plugin dies after a successful `install()` (Worker crash, a
     * throwing `install()`, a bundle that would not import). The caller uninstalls
     * the id and disables the record; a dead plugin is never left registered.
     */
    onFailed?(id: string, error: Error): void;
}

/**
 * Hard ceilings on what one sandboxed plugin may hold on the host. Generous
 * against any real plugin (the shipped ones make 1–2 contributions and open
 * one feed at a time) and small against a flood: crossing one fails the plugin.
 */
export const SANDBOX_LIMITS = {
    /** addCommand / addComposerAction / injectStylesheet, over the plugin's life. */
    contributions: 64,
    /** Feeds open at once (only invoked-room timelines are allowed at all). */
    feeds: 16,
    /** Bridge calls awaiting an answer at once. */
    callsInFlight: 64,
} as const;

/** A verified bundle ready to run in a Worker. */
export interface SandboxEntry {
    manifest: PluginManifest;
    /** The hash-verified plugin source text. */
    bundle: string;
}

/**
 * Wrap a verified bundle in a `Plugin` that runs it in a Worker.
 *
 * Lane routing happens at the call site (`apps/web`'s `loadPlugin`): a
 * `sandbox`-lane install passes the result of this factory to the registry; a
 * `trusted`-lane one passes the imported module as before.
 */
export function sandboxPlugin(entry: SandboxEntry, host: SandboxHost): Plugin {
    const id = entry.manifest.id;

    let worker: SandboxWorker | null = null;
    let ctx: PluginContext | null = null;
    let dead = false;

    /** Host→worker callback invocations awaiting an `invoke-result`. */
    const pendingInvokes = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    /** Live feed subscriptions the plugin opened, so `uninstall` can drop them. */
    const feedSubscriptions = new Map<number, Subscription>();

    // `invoke` ids are allocated here; `feed` ids travel host→worker. Worker→host
    // `call` ids are allocated on the other side, so the two directions are
    // independent spaces and can never collide.
    let nextInvokeId = 1;
    let nextFeedId = 1;

    // What the plugin may touch right now (see policy.ts): the rooms of the
    // invocations the user triggered that are still running, counted because
    // two can overlap in one room, and the feeds opened for each so they close
    // when the room's last invocation settles.
    const activeRooms = new Map<string, number>();
    const roomFeeds = new Map<string, Set<number>>();
    /** Host functions passed into each running invocation (INVOKE_FN). */
    const invokeFns = new Map<number, ((...a: unknown[]) => unknown)[]>();

    function enterRoom(roomId: string): void {
        activeRooms.set(roomId, (activeRooms.get(roomId) ?? 0) + 1);
    }

    function leaveRoom(roomId: string): void {
        const left = (activeRooms.get(roomId) ?? 1) - 1;
        if (left > 0) {
            activeRooms.set(roomId, left);
            return;
        }
        activeRooms.delete(roomId);
        for (const feedId of roomFeeds.get(roomId) ?? []) closeFeed(feedId);
        roomFeeds.delete(roomId);
    }

    function closeFeed(feedId: number): void {
        try {
            feedSubscriptions.get(feedId)?.unsubscribe();
        } catch (error) {
            console.error(`[tumult] sandbox "${id}" feed unsubscribe failed`, error);
        }
        feedSubscriptions.delete(feedId);
    }

    /** Read the two synchronous members off the real client (never guess). */
    function readCapabilities(): SandboxCapabilities {
        const client = ctx?.client;
        return {
            supportsThreads: typeof client?.supportsThreads === "function" && client.supportsThreads(),
            hasMoreRooms: typeof client?.hasMoreRooms === "function" && client.hasMoreRooms(),
        };
    }

    /** Open a subscription to a feed and push its value to the Worker on change. */
    function subscribeFeed(source: Subscribable<unknown>): number {
        const feedId = nextFeedId++;
        const subscription = source.subscribe((value) => {
            worker?.postMessage({ kind: "feed", id: feedId, value });
        });
        feedSubscriptions.set(feedId, subscription);
        return feedId;
    }

    /**
     * Answer one `ctx.selection` / `ctx.actions` call. These are fire-and-forget
     * on the shipping side (`select` navigates, `requestLeave` opens a dialog),
     * so their results are `undefined` and a plugin is not left waiting on a
     * promise the shell never settles.
     */
    function handleContextCall(method: ContextMethod, args: unknown[]): unknown {
        const shell = ctx;
        if (!shell) throw new Error("the sandbox plugin is not installed yet");
        switch (method) {
            case "selection:select":
                shell.selection.select(args[0] as Parameters<typeof shell.selection.select>[0]);
                return undefined;
            case "actions:requestLeave":
                shell.actions.requestLeave(args[0] as Parameters<typeof shell.actions.requestLeave>[0]);
                return undefined;
            case "actions:requestModeration":
                shell.actions.requestModeration(
                    args[0] as Parameters<typeof shell.actions.requestModeration>[0],
                );
                return undefined;
            case "actions:requestMarkRead":
                shell.actions.requestMarkRead(args[0] as string);
                return undefined;
            case "actions:requestPinRoom":
                shell.actions.requestPinRoom(args[0] as string, args[1] as boolean);
                return undefined;
            case "actions:requestMuteRoom":
                shell.actions.requestMuteRoom(args[0] as string, args[1] as boolean);
                return undefined;
            case "actions:requestMarkSpaceRead":
                shell.actions.requestMarkSpaceRead(args[0] as string);
                return undefined;
            case "actions:requestSpaceSettings":
                shell.actions.requestSpaceSettings(args[0] as string);
                return undefined;
            case "actions:requestSpaceInvite":
                shell.actions.requestSpaceInvite(args[0] as string);
                return undefined;
            case "actions:requestSpaceCreateChannel":
                shell.actions.requestSpaceCreateChannel(args[0] as string);
                return undefined;
        }
    }

    /** Reflect one `ChatClient` call — a plain method, a feed, or a context call. */
    async function handleCall(method: string, args: unknown[]): Promise<unknown> {
        const shell = ctx;
        if (!shell) throw new Error("the sandbox plugin is not installed yet");

        // A function the host itself passed into a running invocation.
        if (method === INVOKE_FN) {
            const [invokeId, fnId, ...rest] = args;
            const fn = typeof invokeId === "number" && typeof fnId === "number" ? invokeFns.get(invokeId)?.[fnId] : undefined;
            if (!fn) throw new Error("that callback is no longer available (its invocation has finished)");
            return await fn(...rest);
        }

        // The policy, before anything is dispatched (security finding F1).
        const refusal = checkCall(method, args, new Set(activeRooms.keys()));
        if (refusal) throw new Error(refusal);

        // `ctx.selection` / `ctx.actions` are the shell's live objects, not part
        // of `ChatClient`, so they are answered here rather than through the
        // client reflection below.
        if ((CONTEXT_METHODS as readonly string[]).includes(method)) {
            return handleContextCall(method as ContextMethod, args);
        }

        const client = shell.client as unknown as Record<string, unknown>;

        // Parameterised feeds (`timeline(roomId)`, `members(roomId)`, …) return a
        // Subscribable: subscribing is a call, values arrive as `feed` pushes.
        if ((CLIENT_FEED_METHODS as readonly string[]).includes(method)) {
            const accessor = client[method];
            if (typeof accessor !== "function") throw new Error(`client.${method} is not available`);
            const source = (accessor as (...a: unknown[]) => Subscribable<unknown>).apply(shell.client, args);
            const feedId = subscribeFeed(source);
            // Allowed only for an invoked room (checkCall), so it lives only as
            // long as that room's invocations do.
            const roomId = args[0] as string;
            const feeds = roomFeeds.get(roomId) ?? new Set<number>();
            feeds.add(feedId);
            roomFeeds.set(roomId, feeds);
            return feedId;
        }

        // Plain subscribable properties (`rooms`, `connection`, …) are "called"
        // with no args by the shim's accessor, so treat them as feed opens.
        if ((CLIENT_FEEDS as readonly string[]).includes(method)) {
            const source = client[method] as Subscribable<unknown> | undefined;
            if (!source || typeof source.subscribe !== "function") {
                throw new Error(`client.${method} is not available`);
            }
            return subscribeFeed(source);
        }

        if (!(CLIENT_METHODS as readonly string[]).includes(method)) {
            throw new Error(`client.${method} is not part of the sandbox bridge`);
        }
        const fn = client[method];
        if (typeof fn !== "function") throw new Error(`client.${method} is not available`);
        // `this` stays the real client: some methods read `this` state.
        return await (fn as (...a: unknown[]) => unknown).apply(shell.client, args);
    }

    /** Ask the Worker to run a callback the plugin registered (`run`, `match`). */
    function invoke(callbackId: number, args: unknown[]): Promise<unknown> {
        const invokeId = nextInvokeId++;
        // The user ran this command / clicked this action in a room: that room
        // is open to the plugin until the invocation settles (policy.ts).
        const roomId = invocationRoom(args);
        if (roomId) enterRoom(roomId);
        const fns: ((...a: unknown[]) => unknown)[] = [];
        invokeFns.set(invokeId, fns);
        const result = new Promise<unknown>((resolve, reject) => {
            pendingInvokes.set(invokeId, { resolve, reject });
            // The callback id leads the args envelope; the shim resolves it
            // against its own table, so one wire id serves both sides.
            worker?.postMessage({ kind: "invoke", id: invokeId, args: [callbackId, ...args.map((arg) => toWire(arg, invokeId, fns))] });
        }).finally(() => invokeFns.delete(invokeId));
        return roomId ? result.finally(() => leaveRoom(roomId)) : result;
    }

    /**
     * An invocation's arguments as plain data. The composer hands a command
     * `{ roomId, client, args, raw }` and an action `{ …, setDraft }`: the live
     * client and functions cannot be structured-cloned (DataCloneError — every
     * sandboxed command failed when run), so the client becomes a
     * `{ kind: "client" }` marker the Worker swaps for its own bridged client,
     * and each function a `{ kind: "hostfn" }` reference held only for this
     * invocation (see INVOKE_FN).
     */
    function toWire(value: unknown, invokeId: number, fns: ((...a: unknown[]) => unknown)[]): unknown {
        if (value === ctx?.client) return { kind: "client" };
        if (typeof value === "function") {
            fns.push(value as (...a: unknown[]) => unknown);
            return { kind: "hostfn", invoke: invokeId, fn: fns.length - 1 };
        }
        if (Array.isArray(value)) return value.map((entry) => toWire(entry, invokeId, fns));
        if (typeof value !== "object" || value === null) return value;
        // Only plain data objects are walked; anything else (a class instance,
        // a feed) has no business crossing and is dropped rather than cloned.
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) return undefined;
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) out[key] = toWire(entry, invokeId, fns);
        return out;
    }

    /**
     * Register one contribution the plugin made. Callback placeholders (the
     * plugin's own `run`/`match`, which stayed in the Worker as ids) are revived
     * into functions that RPC back, so the host never holds plugin code.
     */
    function applyContribution(message: Extract<WorkerMessage, { kind: "contribution" }>): void {
        const shell = ctx;
        if (!shell) throw new Error("the sandbox plugin is not installed yet");
        const payload = message.payload as Record<string, unknown>;

        const revive = <T>(value: T): T => {
            if (typeof value !== "object" || value === null) return value;
            if (Array.isArray(value)) return value.map(revive) as unknown as T;
            const source = value as Record<string, unknown>;
            if (source["kind"] === "callback" && typeof source["id"] === "number") {
                const callbackId = source["id"];
                return ((...args: unknown[]) => invoke(callbackId, args)) as unknown as T;
            }
            const out: Record<string, unknown> = {};
            for (const [key, entryValue] of Object.entries(source)) out[key] = revive(entryValue);
            return out as T;
        };

        switch (message.api) {
            case "addCommand":
                shell.addCommand(revive(payload) as unknown as Parameters<typeof shell.addCommand>[0]);
                break;
            case "addComposerAction":
                shell.addComposerAction(
                    revive(payload) as unknown as Parameters<typeof shell.addComposerAction>[0],
                );
                break;
            case "injectStylesheet": {
                const css = payload["css"];
                if (typeof css !== "string") throw new Error("injectStylesheet needs a string");
                shell.injectStylesheet(css);
                break;
            }
            default:
                // An unimplemented contribution kind is a protocol bug, not a
                // plugin one: fail loudly rather than ignore it.
                throw new Error(`unsupported sandbox contribution "${message.api}"`);
        }
    }

    /** Drop everything bridge-owned: subscriptions, pending invokes, the Worker. */
    function teardown(): void {
        const error = new Error("the plugin was uninstalled");
        for (const pending of pendingInvokes.values()) pending.reject(error);
        pendingInvokes.clear();
        for (const subscription of feedSubscriptions.values()) {
            try {
                subscription.unsubscribe();
            } catch (subscriptionError) {
                console.error(`[tumult] sandbox "${id}" feed unsubscribe failed`, subscriptionError);
            }
        }
        feedSubscriptions.clear();
        activeRooms.clear();
        roomFeeds.clear();
        invokeFns.clear();
        worker?.terminate();
        worker = null;
        ctx = null;
    }

    return {
        manifest: entry.manifest,
        install(shellContext): void {
            ctx = shellContext;
            dead = false;
            const active = host.createWorker();
            worker = active;
            let callsInFlight = 0;
            let contributions = 0;

            const fail = (error: Error): void => {
                if (dead) return;
                dead = true;
                teardown();
                host.onFailed?.(id, error);
            };

            active.addEventListener("error", (event) => {
                fail(wireError(event.message));
            });

            active.addEventListener("message", (event) => {
                const message = event.data as WorkerMessage;
                if (!message || typeof message !== "object") return;
                switch (message.kind) {
                    case "call": {
                        // Caps, not queues (security review F4): the plugin's
                        // code shares the Worker realm with the runtime, so it
                        // can post raw protocol messages and skip any restraint
                        // there. A Worker past a cap is hostile or broken, and
                        // is failed — uninstalled and disabled — before it can
                        // stall the app (and again on every boot).
                        if (callsInFlight >= SANDBOX_LIMITS.callsInFlight) {
                            fail(new Error(`made more than ${SANDBOX_LIMITS.callsInFlight} concurrent calls`));
                            break;
                        }
                        if (feedSubscriptions.size >= SANDBOX_LIMITS.feeds) {
                            fail(new Error(`opened more than ${SANDBOX_LIMITS.feeds} feeds`));
                            break;
                        }
                        callsInFlight += 1;
                        void handleCall(message.method, message.args)
                            .then(
                                (value) => {
                                    active.postMessage({ kind: "result", id: message.id, ok: true, value });
                                },
                                (error: unknown) => {
                                    active.postMessage({
                                        kind: "result",
                                        id: message.id,
                                        ok: false,
                                        error: error instanceof Error ? error.message : String(error),
                                    });
                                },
                            )
                            .finally(() => {
                                callsInFlight -= 1;
                            });
                        break;
                    }
                    case "contribution":
                        contributions += 1;
                        if (contributions > SANDBOX_LIMITS.contributions) {
                            fail(new Error(`made more than ${SANDBOX_LIMITS.contributions} contributions`));
                            break;
                        }
                        try {
                            applyContribution(message);
                        } catch (error) {
                            fail(error instanceof Error ? error : new Error(String(error)));
                        }
                        break;
                    case "invoke-result": {
                        const pending = pendingInvokes.get(message.id);
                        if (!pending) break;
                        pendingInvokes.delete(message.id);
                        if (message.ok) pending.resolve(message.value);
                        else pending.reject(wireError(message.error));
                        break;
                    }
                    case "ready":
                        if (!message.ok) fail(wireError(message.error));
                        break;
                    default:
                        break;
                }
            });

            active.postMessage({
                kind: "init",
                protocol: SANDBOX_PROTOCOL_VERSION,
                bundle: entry.bundle,
                manifest: entry.manifest,
                // The two synchronous `ChatClient` members cannot be called back
                // across the boundary, so their current values ride along and are
                // refreshed below whenever the plugin could have changed them.
                capabilities: readCapabilities(),
            });
        },
        uninstall(): void {
            worker?.postMessage({ kind: "dispose" });
            teardown();
            dead = true;
        },
    };
}
