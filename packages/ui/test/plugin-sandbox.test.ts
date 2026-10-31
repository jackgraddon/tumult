/**
 * Tests the host↔Worker bridge end to end, in-process.
 *
 * Both halves are factories with their coupling injected — `sandboxPlugin()` takes
 * a `SandboxHost` (whose `createWorker()` returns a `SandboxWorker`), and
 * `createSandboxRuntime()` takes a `SandboxScope`. So the real protocol can be
 * exercised by wiring a fake Worker straight to a fake scope, with no browser and
 * no `self`: every message one side posts is delivered to the other.
 *
 * What is asserted here is the behaviour the lane rule PROMISES: a sandbox plugin
 * still contributes commands and composer actions, still reads and writes through
 * `ctx.client`, still navigates through `ctx.selection`, and still hits the SAME
 * permission gate as an in-page plugin (because the host applies contributions
 * through the real `ctx`, not a parallel path). Also asserted: a plugin that dies
 * goes through `onFailed`, and an uninstall tears the bridge down.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ChatClient } from "@tumult/core/contract";

import { SANDBOX_LIMITS, sandboxPlugin, type SandboxWorker } from "../src/plugins/sandbox/host.ts";
import { createSandboxRuntime, type SandboxScope } from "../src/plugins/sandbox/worker/runtime.ts";
import type { HostMessage, WorkerMessage } from "../src/plugins/sandbox/protocol.ts";
import type { Plugin, PluginContext, PluginManifest } from "../src/plugins/types.ts";

// ── The fake Worker: two ends of one wire, delivered synchronously ──────────

/**
 * A fake Worker bound to one runtime. `postMessage` from the host is handed to
 * the runtime's `handleMessage`; the runtime's `postMessage` is handed back to
 * the host's `message` listener. Delivery is synchronous, so `await`ing a
 * microtask after an action is enough to observe its effect.
 */
function makeWorker(scopeOverrides: Partial<SandboxScope> = {}): {
    worker: SandboxWorker;
    scope: SandboxScope;
    closed: () => boolean;
} {
    const messageListeners: ((event: { data: unknown }) => void)[] = [];
    let closed = false;

    const runtimeListeners: ((event: { data: unknown }) => void)[] = [];

    // The runtime registers ITS message handler through the scope, so these
    // registrations are the Worker→host delivery target. Constructing the
    // runtime below is what populates this list.

    const scope: SandboxScope = {
        postMessage: (message: WorkerMessage) => {
            // Worker → host: hand it to the host's `message` listener. Cloned
            // as a real Worker clones: a function or live object in a message
            // must throw here (DataCloneError) exactly as it does in a browser.
            const data = structuredClone(message);
            for (const listener of messageListeners) listener({ data });
        },
        addEventListener: (type, listener) => {
            if (type === "message") runtimeListeners.push(listener);
        },
        close: () => {
            closed = true;
        },
        createObjectUrl: () => "blob:fake/1",
        revokeObjectUrl: () => undefined,
        importModule: () => Promise.reject(new Error("no importer configured")),
        ...scopeOverrides,
    };

    const worker: SandboxWorker = {
        postMessage: (message: HostMessage) => {
            // Host → worker: drive the runtime's registered handler(s), cloned
            // as a real Worker clones (this is what hid a DataCloneError: every
            // sandboxed command used to post the live ChatClient).
            const data = structuredClone(message);
            for (const listener of runtimeListeners) listener({ data });
        },
        terminate: () => {
            closed = true;
        },
        addEventListener: (type, listener) => {
            if (type === "message") {
                messageListeners.push(listener as (event: { data: unknown }) => void);
            }
        },
    };

    // Constructing the runtime registers its handler into `runtimeListeners`.
    createSandboxRuntime(scope);

    return { worker, scope, closed: () => closed };
}

/** A `ChatClient` stand-in recording every method call. */
function makeClient(overrides: Partial<ChatClient> = {}): {
    client: ChatClient;
    calls: { method: string; args: unknown[] }[];
} {
    const calls: { method: string; args: unknown[] }[] = [];
    const record =
        (method: string, result: unknown = undefined) =>
        (...args: unknown[]) => {
            calls.push({ method, args });
            return Promise.resolve(result);
        };
    const client = {
        login: record("login"),
        completeLogin: record("completeLogin"),
        restoreSession: record("restoreSession", false),
        logout: record("logout"),
        start: record("start"),
        stop: record("stop"),
        loadMore: record("loadMore"),
        send: record("send"),
        retry: record("retry"),
        sendMediaMessage: record("sendMediaMessage", "mxc://sent"),
        toggleReaction: record("toggleReaction"),
        edit: record("edit"),
        sendTyping: record("sendTyping"),
        supportsThreads: () => false,
        resolveMedia: record("resolveMedia"),
        resolveMediaDownload: record("resolveMediaDownload"),
        resolveEncryptedMedia: record("resolveEncryptedMedia"),
        requestNotificationPermission: record("requestNotificationPermission", "denied"),
        sendReply: record("sendReply"),
        markThreadRead: record("markThreadRead"),
        markRead: record("markRead"),
        redact: record("redact"),
        search: record("search", { hits: [], nextBatch: null, total: 0 }),
        jumpTo: record("jumpTo", true),
        setRoomSelection: record("setRoomSelection"),
        loadMoreRooms: record("loadMoreRooms"),
        hasMoreRooms: () => false,
        createSpace: record("createSpace"),
        createChannel: record("createChannel"),
        createDm: record("createDm"),
        joinRoom: record("joinRoom"),
        leave: record("leave"),
        invite: record("invite"),
        updateRoomSettings: record("updateRoomSettings"),
        searchUsers: record("searchUsers", []),
        loadMembers: record("loadMembers"),
        kick: record("kick"),
        ban: record("ban"),
        unban: record("unban"),
        setPowerLevel: record("setPowerLevel"),
        setProfile: record("setProfile"),
        setupRecovery: record("setupRecovery"),
        restoreBackup: record("restoreBackup"),
        startVerification: record("startVerification"),
        acceptVerification: record("acceptVerification"),
        declineVerification: record("declineVerification"),
        confirmSas: record("confirmSas"),
        mismatchSas: record("mismatchSas"),
        listDevices: record("listDevices"),
        ...overrides,
    } as unknown as ChatClient;
    return { client, calls };
}

/** A minimal `PluginContext` for the host to answer against. */
function makeContext(
    manifest: PluginManifest,
    client: ChatClient,
    hooks: {
        onCommand?: (command: unknown) => void;
        onStyles?: (css: string) => void;
        onSelect?: (next: unknown) => void;
        onAction?: (action: unknown) => void;
    } = {},
): PluginContext {
    return {
        manifest,
        client,
        selection: {
            current: { view: "dms" },
            select: (next) => hooks.onSelect?.(next),
            hrefFor: () => "#/dms",
        },
        actions: {
            requestLeave: () => undefined,
            requestModeration: () => undefined,
            requestMarkRead: () => undefined,
            requestMarkSpaceRead: () => undefined,
            requestPinRoom: () => undefined,
            requestMuteRoom: () => undefined,
            requestSpaceSettings: () => undefined,
            requestSpaceInvite: () => undefined,
            requestSpaceCreateChannel: () => undefined,
        },
        media: {
            resolve: async () => "blob:host/1",
            resolveDownload: async () => "blob:host/2",
            resolveEncrypted: async () => "blob:host/3",
        },
        addRenderer: () => () => undefined,
        addComposerAction: (action) => {
            hooks.onAction?.(action);
            return () => undefined;
        },
        addCommand: (command) => {
            hooks.onCommand?.(command);
            return () => undefined;
        },
        addMemberDecoration: () => () => undefined,
        addSettingsTab: () => () => undefined,
        injectStylesheet: (css) => {
            hooks.onStyles?.(css);
            return () => undefined;
        },
    };
}

const MANIFEST: PluginManifest = {
    id: "acme.sandbox",
    name: "Sandbox Test",
    version: "1.0.0",
    minUI: "1.0.0",
    minCore: "1.0.0",
    permissions: ["commands", "styles", "composer-actions"],
};

/**
 * A bundle that registers a command shaped exactly like the template's: `run`
 * gets the real `CommandContext` and sends through the context's `client`.
 */
function makeBundle(): { bundle: string; plugin: Plugin } {
    const plugin: Plugin = {
        manifest: MANIFEST,
        install(ctx) {
            ctx.addCommand({
                name: "shrug",
                description: "Send a shrug",
                run: async ({ args, roomId, client }) => {
                    await client.send(roomId, `${args} ¯\\_(ツ)_/¯`);
                },
            });
            ctx.injectStylesheet(".sandbox { color: red; }");
            return () => undefined;
        },
    };
    return { bundle: "// bundle text", plugin };
}

/** Wire a host facade to a runtime running `plugin`, and install it. */
async function bridge(
    plugin: Plugin,
    hooks: {
        onCommand?: (command: unknown) => void;
        onStyles?: (css: string) => void;
        onAction?: (action: unknown) => void;
        onFailed?: (id: string, error: Error) => void;
        clientOverrides?: Partial<ChatClient>;
    } = {},
): Promise<{
    calls: { method: string; args: unknown[] }[];
    closed: () => boolean;
    client: ChatClient;
}> {
    const { client, calls } = makeClient(hooks.clientOverrides);
    const fake = makeWorker({ importModule: () => Promise.resolve({ default: plugin }) });

    const facade = sandboxPlugin(
        { manifest: MANIFEST, bundle: "// bundle text" },
        {
            createWorker: () => fake.worker,
            ...(hooks.onFailed ? { onFailed: hooks.onFailed } : {}),
        },
    );

    facade.install(
        makeContext(MANIFEST, client, {
            ...(hooks.onCommand ? { onCommand: hooks.onCommand } : {}),
            ...(hooks.onStyles ? { onStyles: hooks.onStyles } : {}),
            ...(hooks.onAction ? { onAction: hooks.onAction } : {}),
        }),
    );

    // The runtime's `install` is driven by the `init` message the facade just
    // posted; it resolves over a microtask chain (import → install → ready).
    await settle();
    return { calls, closed: fake.closed, client };
}

/** Let every queued microtask run (the bridge is promise-chained, not timed). */
async function settle(times = 40): Promise<void> {
    for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe("sandbox bridge", () => {
    it("runs the plugin's install in the Worker and relays its command", async () => {
        const commands: unknown[] = [];
        const styles: string[] = [];
        await bridge(makeBundle().plugin, {
            onCommand: (command) => commands.push(command),
            onStyles: (css) => styles.push(css),
        });

        assert.equal(commands.length, 1, "the command contribution reached the host");
        const command = commands[0] as { name: string; run: unknown };
        assert.equal(command.name, "shrug");
        assert.equal(typeof command.run, "function", "the host revived a callable run");

        assert.deepEqual(styles, [".sandbox { color: red; }"]);
    });

    it("runs the plugin's command in the Worker with the context the composer really passes", async () => {
        const commands: { run: (...args: unknown[]) => Promise<unknown> }[] = [];
        const { calls, client } = await bridge(makeBundle().plugin, {
            onCommand: (command) => commands.push(command as never),
        });

        const command = commands[0];
        assert.ok(command, "a command was registered");
        // MessageComposer.vue: command.run({ roomId, client, args, raw }). The
        // live client cannot be cloned; this used to throw DataCloneError, so
        // every sandboxed command (the template's included) failed when run.
        await command.run({ roomId: "!room:example.org", client, args: "hi", raw: "/shrug hi" });

        const send = calls.find((call) => call.method === "send");
        assert.ok(send, "the plugin's run() called client.send through the bridge");
        assert.deepEqual(send.args, ["!room:example.org", "hi ¯\\_(ツ)_/¯"]);
    });

    it("refuses ctx.selection.select: navigation is not a sandbox capability", async () => {
        const selections: unknown[] = [];
        const { client } = makeClient();
        const fake = makeWorker({
            importModule: () =>
                Promise.resolve({
                    default: {
                        manifest: MANIFEST,
                        install: (ctx: PluginContext) => {
                            ctx.selection.select({ view: "guild", guildId: "!g:example.org" });
                            return () => undefined;
                        },
                    } satisfies Plugin,
                }),
        });
        const facade = sandboxPlugin(
            { manifest: MANIFEST, bundle: "// x" },
            { createWorker: () => fake.worker },
        );
        facade.install(
            makeContext(MANIFEST, client, { onSelect: (next) => selections.push(next) }),
        );
        await settle();

        assert.deepEqual(selections, [], "a sandboxed plugin cannot navigate the user (policy.ts CONTEXT_RULES)");
    });

    it("propagates a host refusal back into the plugin as a named error", async () => {
        // The point: a bridged call that the host cannot answer rejects inside
        // the plugin with the host's reason, rather than resolving to
        // `undefined`. Here `resolveMedia` is removed from the client the host
        // answers against, so the host refuses it by name.
        const partial = makeClient();
        delete (partial.client as unknown as Record<string, unknown>)["resolveMedia"];
        let seen: string | null = null;
        const fake = makeWorker({
            importModule: () =>
                Promise.resolve({
                    default: {
                        manifest: MANIFEST,
                        install: (ctx: PluginContext) => {
                            void ctx.client.resolveMedia("mxc://x", 8).then(
                                () => {
                                    seen = "resolved";
                                },
                                (error: unknown) => {
                                    seen = error instanceof Error ? error.message : String(error);
                                },
                            );
                            return () => undefined;
                        },
                    } satisfies Plugin,
                }),
        });
        const facade = sandboxPlugin({ manifest: MANIFEST, bundle: "// x" }, { createWorker: () => fake.worker });
        facade.install(makeContext(MANIFEST, partial.client));
        await settle();

        assert.match(seen ?? "", /resolveMedia/, "the host named the refused method");
    });

    it("refuses media resolution: a sandboxed plugin cannot fetch the user's media", async () => {
        const created: Blob[] = [];
        let refusal = "";
        const { client, calls } = makeClient({
            resolveMedia: async () => new ArrayBuffer(4),
        });
        const fake = makeWorker({
            createObjectUrl: (blob) => {
                if (blob.type !== "text/javascript") created.push(blob);
                return "blob:worker/1";
            },
            importModule: () =>
                Promise.resolve({
                    default: {
                        manifest: MANIFEST,
                        install: (ctx: PluginContext) => {
                            ctx.media.resolve("mxc://example.org/x", 64).catch((error: Error) => {
                                refusal = error.message;
                            });
                            return () => undefined;
                        },
                    } satisfies Plugin,
                }),
        });
        const facade = sandboxPlugin({ manifest: MANIFEST, bundle: "// x" }, { createWorker: () => fake.worker });
        facade.install(makeContext(MANIFEST, client));
        await settle();

        assert.match(refusal, /not available to sandboxed plugins/);
        assert.equal(created.length, 0, "no bytes crossed, so nothing was minted");
        assert.ok(!calls.some((call) => call.method.startsWith("resolve")), "the host never called the client");
    });

    it("serves the synchronous capabilities from the host's snapshot", async () => {
        const seen: unknown[] = [];
        const { client } = makeClient({
            supportsThreads: () => true,
            hasMoreRooms: () => true,
        });
        const fake = makeWorker({
            importModule: () =>
                Promise.resolve({
                    default: {
                        manifest: MANIFEST,
                        install: (ctx: PluginContext) => {
                            seen.push(ctx.client.supportsThreads(), ctx.client.hasMoreRooms());
                            return () => undefined;
                        },
                    } satisfies Plugin,
                }),
        });
        const facade = sandboxPlugin({ manifest: MANIFEST, bundle: "// x" }, { createWorker: () => fake.worker });
        facade.install(makeContext(MANIFEST, client));
        await settle();

        assert.deepEqual(seen, [true, true], "the sync members were not guessed");
    });

    it("reports a throwing install() through onFailed and tears the worker down", async () => {
        const failures: { id: string; error: Error }[] = [];
        const { client } = makeClient();
        const fake = makeWorker({
            importModule: () =>
                Promise.resolve({
                    default: {
                        manifest: MANIFEST,
                        install: () => {
                            throw new Error("boom in install");
                        },
                    } satisfies Plugin,
                }),
        });
        const facade = sandboxPlugin(
            { manifest: MANIFEST, bundle: "// x" },
            {
                createWorker: () => fake.worker,
                onFailed: (id, error) => failures.push({ id, error }),
            },
        );
        facade.install(makeContext(MANIFEST, client));
        await settle();

        assert.equal(failures.length, 1, "the failure surfaced");
        assert.equal(failures[0]?.id, MANIFEST.id);
        assert.match(failures[0]?.error.message ?? "", /boom in install/);
        assert.ok(fake.closed(), "the worker was terminated");
    });

    it("tears down the worker and the plugin's teardown on uninstall", async () => {
        let tornDown = false;
        const { client } = makeClient();
        const fake = makeWorker({
            importModule: () =>
                Promise.resolve({
                    default: {
                        manifest: MANIFEST,
                        install: () => () => {
                            tornDown = true;
                        },
                    } satisfies Plugin,
                }),
        });
        const facade = sandboxPlugin({ manifest: MANIFEST, bundle: "// x" }, { createWorker: () => fake.worker });
        facade.install(makeContext(MANIFEST, client));
        await settle();

        facade.uninstall?.();
        await settle();

        assert.equal(tornDown, true, "the plugin's own teardown ran in the Worker");
        assert.ok(fake.closed(), "the worker was terminated");
    });

    it("refuses the all-rooms feed: a sandboxed plugin cannot list the user's rooms", async () => {
        const observed: unknown[] = [];
        const { client } = makeClient({ rooms: subscribable([room("!a:example.org")]) });
        const fake = makeWorker({
            importModule: () =>
                Promise.resolve({
                    default: {
                        manifest: MANIFEST,
                        install: (ctx: PluginContext) => {
                            ctx.client.rooms.subscribe((value) => observed.push(value));
                            return () => undefined;
                        },
                    } satisfies Plugin,
                }),
        });
        const facade = sandboxPlugin({ manifest: MANIFEST, bundle: "// x" }, { createWorker: () => fake.worker });
        facade.install(makeContext(MANIFEST, client));
        await settle();

        assert.deepEqual(observed, [], "no room list crossed the bridge");
    });

    it("lets an action read its own room's timeline and react, then closes the feed", async () => {
        // The showcase composer action, end to end: the policy's invoked-room
        // rule must allow exactly this.
        const ROOM = "!here:example.org";
        const timeline = liveFeed([{ id: "$last", body: "hi" }]);
        const actions: { run: (...args: unknown[]) => Promise<unknown> }[] = [];
        const { calls, client } = await bridge(
            {
                manifest: MANIFEST,
                install(ctx) {
                    ctx.addComposerAction({
                        id: "test.react",
                        label: "React",
                        run: async ({ roomId, client: c }) => {
                            const messages = await new Promise<{ id: string }[]>((resolve) => {
                                const sub = c.timeline(roomId).subscribe((value) => {
                                    if (value.length > 0) {
                                        sub.unsubscribe();
                                        resolve(value as { id: string }[]);
                                    }
                                });
                            });
                            await c.toggleReaction(roomId, messages[messages.length - 1]!.id, "👍");
                        },
                    });
                    return () => undefined;
                },
            },
            { onAction: (action) => actions.push(action as never), clientOverrides: { timeline: () => timeline.feed } as never },
        );

        await actions[0]!.run({ roomId: ROOM, draft: "", client, setDraft: () => undefined });
        assert.deepEqual(calls.find((c) => c.method === "toggleReaction")?.args, [ROOM, "$last", "👍"]);
        await settle();
        assert.equal(timeline.listeners(), 0, "the room's timeline feed closed when the action finished");
    });

    it("refuses everything outside the invoked room, and every privileged call even inside it", async () => {
        const ROOM = "!here:example.org";
        const refusals: string[] = [];
        const actions: { run: (...args: unknown[]) => Promise<unknown> }[] = [];
        const note = (p: Promise<unknown>): Promise<void> => p.then(() => refusals.push("ALLOWED"), (e: Error) => void refusals.push(e.message));
        const { calls, client } = await bridge(
            {
                manifest: MANIFEST,
                install(ctx) {
                    // Not invoked by anyone yet: nothing room-scoped is open.
                    void note(ctx.client.send(ROOM, "from install"));
                    ctx.addComposerAction({
                        id: "test.greedy",
                        label: "Greedy",
                        run: async ({ client: c }) => {
                            await note(c.send("!elsewhere:example.org", "other room"));
                            await note(c.logout());
                            await note(c.setupRecovery());
                            await note(c.confirmSas("req"));
                            await note(c.kick(ROOM, "@victim:example.org"));
                        },
                    });
                    return () => undefined;
                },
            },
            { onAction: (action) => actions.push(action as never) },
        );
        await actions[0]!.run({ roomId: ROOM, draft: "", client, setDraft: () => undefined });
        await settle();

        assert.equal(refusals.length, 6);
        assert.ok(!refusals.includes("ALLOWED"), `something got through: ${JSON.stringify(refusals)}`);
        assert.deepEqual(calls, [], "the real client was never called");
    });

    it("lets an action call setDraft while it runs, and refuses it afterwards", async () => {
        const drafts: string[] = [];
        let kept: ((text: string) => void) | null = null;
        const actions: { run: (...args: unknown[]) => Promise<unknown> }[] = [];
        const { client } = await bridge(
            {
                manifest: MANIFEST,
                install(ctx) {
                    ctx.addComposerAction({
                        id: "test.draft",
                        label: "Draft",
                        run: async ({ setDraft }) => {
                            await setDraft("rewritten");
                            kept = setDraft;
                        },
                    });
                    return () => undefined;
                },
            },
            { onAction: (action) => actions.push(action as never) },
        );
        await actions[0]!.run({ roomId: "!r:example.org", draft: "x", client, setDraft: (t: string) => drafts.push(t) });
        assert.deepEqual(drafts, ["rewritten"]);

        await assert.rejects(Promise.resolve((kept as unknown as (t: string) => Promise<unknown>)("later")), /no longer available/);
        assert.deepEqual(drafts, ["rewritten"], "a finished invocation's setDraft does nothing");
    });

    it("fails a plugin that floods contributions, rather than letting it stall the app (F4)", async () => {
        const failures: string[] = [];
        await bridge(
            {
                manifest: MANIFEST,
                install(ctx) {
                    for (let i = 0; i <= SANDBOX_LIMITS.contributions; i++) {
                        ctx.addCommand({ name: `flood${i}`, run: () => undefined });
                    }
                    return () => undefined;
                },
            },
            { onFailed: (_id, error) => failures.push(error.message) },
        );
        assert.equal(failures.length, 1);
        assert.match(failures[0]!, /more than 64 contributions/);
    });

    it("fails a plugin that floods the bridge with calls (F4)", async () => {
        const failures: string[] = [];
        await bridge(
            {
                manifest: MANIFEST,
                install(ctx) {
                    for (let i = 0; i <= SANDBOX_LIMITS.callsInFlight; i++) ctx.client.send("!r:example.org", "x").catch(() => undefined);
                    return () => undefined;
                },
            },
            { onFailed: (_id, error) => failures.push(error.message) },
        );
        assert.equal(failures.length, 1);
        assert.match(failures[0]!, /more than 64 concurrent calls/);
    });
});

/** A feed whose listener count is observable, to prove a subscription was closed. */
function liveFeed<T>(value: T): { feed: { get(): T; subscribe(l: (v: T) => void): { unsubscribe(): void } }; listeners(): number } {
    const listeners = new Set<(v: T) => void>();
    return {
        feed: {
            get: () => value,
            subscribe(listener) {
                listeners.add(listener);
                listener(value);
                return { unsubscribe: () => void listeners.delete(listener) };
            },
        },
        listeners: () => listeners.size,
    };
}

/** A minimal `RoomSummary` for feed tests. */
function room(id: string): unknown {
    return {
        id,
        name: id,
        topic: null,
        isSpace: false,
        parentSpaceIds: [],
        unreadCount: 0,
        highlightCount: 0,
        fullyReadEventId: null,
    };
}

/** A minimal subscribable whose value is fixed at construction. */
function subscribable<T>(value: T): ChatClient["rooms"] {
    const listeners = new Set<(next: T) => void>();
    return {
        get: () => value,
        subscribe(listener) {
            listeners.add(listener);
            listener(value);
            return { unsubscribe: () => listeners.delete(listener) };
        },
    };
}
