/**
 * The Worker-side sandbox runtime, as a factory — the shim's testable core.
 *
 * `shim.ts` instantiates this against the real `self` and the real dynamic
 * `import()`; tests instantiate it against a fake scope and a fake importer, so
 * the whole host↔worker protocol can be exercised in-process without a browser.
 * Nothing here touches `self` directly.
 *
 * See `shim.ts` for the design notes; this module is where they are implemented.
 */

import type {
    ChatClient,
    ConnectionState,
    EncryptedAttachment,
    MemberView,
    MessageView,
    NotificationState,
    OwnPresenceView,
    ProfileView,
    RoomPowerLevelsView,
    RoomSummary,
    SecurityStatus,
    SessionView,
    Subscribable,
    Subscription,
    ThreadSummary,
    TypingState,
    VerificationState,
} from "@tumult/core/contract";

import type { ComposerAction } from "../../../timeline/composer-actions.ts";
import type { Command } from "../../../timeline/commands.ts";
import type { Plugin, PluginContext, PluginManifest } from "../../types.ts";
import {
    INVOKE_FN,
    wireError,
    type HostMessage,
    type RpcContribution,
    type SandboxCapabilities,
    type WorkerMessage,
} from "../protocol.ts";

/** The slice of a Worker global scope the runtime needs. */
export interface SandboxScope {
    postMessage(message: WorkerMessage): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    close(): void;
    /** Mint a `blob:` URL for media bytes — `URL.createObjectURL` in a Worker. */
    createObjectUrl(blob: Blob): string;
    revokeObjectUrl(url: string): void;
    /** Import a module from a URL — the real dynamic `import()` in a Worker. */
    importModule(url: string): Promise<unknown>;
}

/** The runtime's public face: what a scope binds to. */
export interface SandboxRuntime {
    handleMessage(data: unknown): void;
}

/** Build the context the plugin's `install()` receives. */
export function createSandboxRuntime(scope: SandboxScope): SandboxRuntime {
    /** The plugin's own functions, kept here so they never cross the wire. */
    const callbackTable = new Map<number, (...args: unknown[]) => unknown>();
    let nextCallbackId = 1;

    /** Worker→host calls awaiting a `result`. */
    let nextCallId = 1;
    const pendingCalls = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

    /** Latest pushed value per feed id, and the per-key local state behind each. */
    const feedValues = new Map<number, unknown>();
    interface LocalFeed {
        /** The host feed id, once `openFeed` resolved. */
        id: number | null;
        listeners: Set<(value: unknown) => void>;
    }
    /** key → local feed state, so repeated `get()`/`subscribe()` share one host feed. */
    const feedEntries = new Map<string, LocalFeed>();
    /** host feed id → the same state, so a `feed` push finds its listeners. */
    const feedEntriesById = new Map<number, LocalFeed>();

    let capabilities: SandboxCapabilities = { supportsThreads: false, hasMoreRooms: false };
    let manifest: PluginManifest | null = null;
    let teardown: (() => void) | null = null;
    let disposed = false;

    /** Send one request to the host and await its `result`. */
    function rpc(method: string, args: unknown[]): Promise<unknown> {
        const id = nextCallId++;
        return new Promise<unknown>((resolve, reject) => {
            pendingCalls.set(id, { resolve, reject });
            scope.postMessage({ kind: "call", id, method, args });
        });
    }

    /**
     * A fire-and-forget call (navigation, shell actions). The host's policy can
     * refuse it, and with nothing awaiting the promise that would surface as an
     * unhandled rejection — so the refusal is logged, where an author sees it.
     */
    function fire(method: string, args: unknown[]): void {
        rpc(method, args).catch(refused(method));
    }

    /** Log a refused call for the plugin's author, rather than crash on it. */
    function refused(method: string): (error: unknown) => void {
        return (error) => console.warn(`[tumult sandbox] ${method}:`, error instanceof Error ? error.message : error);
    }

    /** The shared local state for one feed key (created on first use). */
    function entryFor(key: string): LocalFeed {
        const existing = feedEntries.get(key);
        if (existing) return existing;
        const created: LocalFeed = { id: null, listeners: new Set() };
        feedEntries.set(key, created);
        return created;
    }

    /**
     * Open a feed once per key. The host answers with its feed id; every later
     * value arrives as a `feed` push carrying that id.
     */
    function openFeed(key: string, method: string, args: unknown[]): Promise<number> {
        const entry = entryFor(key);
        if (entry.id !== null) return Promise.resolve(entry.id);
        return rpc(method, args).then((value) => {
            const id = value as number;
            entry.id = id;
            feedEntriesById.set(id, entry);
            // A snapshot may have been pushed before the id was known, so replay.
            if (feedValues.has(id)) {
                const snapshot = feedValues.get(id);
                for (const listener of entry.listeners) listener(snapshot);
            }
            return id;
        });
    }

    /**
     * A read-only `Subscribable` whose snapshots are pushed from the host. The
     * feed opens lazily on first use; `get()` returns the last pushed value or
     * `fallback` until the first push lands (so a plugin never crashes on "no
     * value yet").
     */
    function feed<T>(key: string, method: string, args: unknown[], fallback: T): Subscribable<T> {
        return {
            get(): T {
                const entry = entryFor(key);
                if (entry.id !== null && feedValues.has(entry.id)) return feedValues.get(entry.id) as T;
                openFeed(key, method, args).catch(refused(method));
                return fallback;
            },
            subscribe(listener: (value: T) => void): Subscription {
                const entry = entryFor(key);
                const wrapped = listener as (value: unknown) => void;
                entry.listeners.add(wrapped);
                // `openFeed` replays the current snapshot to every listener once
                // the id is known, so a subscriber is not served twice here.
                openFeed(key, method, args).catch(refused(method));
                return {
                    unsubscribe() {
                        entry.listeners.delete(wrapped);
                    },
                };
            },
        };
    }

    /** Mint a Worker-local `blob:` URL from media bytes that crossed the boundary. */
    function mediaUrl(bytes: unknown, type: string): string {
        if (typeof bytes === "string") return bytes;
        if (bytes instanceof ArrayBuffer) return scope.createObjectUrl(new Blob([bytes], { type }));
        if (ArrayBuffer.isView(bytes)) {
            return scope.createObjectUrl(new Blob([bytes.buffer as ArrayBuffer], { type }));
        }
        throw new Error("media resolution returned something that is not bytes");
    }

    /** A thin `rpc`-backed method, for the plain (non-feed, non-sync) calls. */
    function call(method: string): (...args: unknown[]) => Promise<unknown> {
        return (...args: unknown[]) => rpc(method, args);
    }

    /** The client facade: every method an `rpc`, every feed a pushed snapshot. */
    function buildClient(): ChatClient {
        const client = {
            login: call("login"),
            completeLogin: call("completeLogin"),
            restoreSession: call("restoreSession"),
            logout: call("logout"),
            start: call("start"),
            stop: call("stop"),

            session: feed<SessionView | null>("session", "session", [], null),
            connection: feed<ConnectionState>("connection", "connection", [], "starting"),
            rooms: feed<RoomSummary[]>("rooms", "rooms", [], []),
            security: feed<SecurityStatus>("security", "security", [], {
                checked: false,
                crossSigningReady: false,
                backupEnabled: false,
                backupTrusted: false,
                secretStorageReady: false,
            }),
            verification: feed<VerificationState>("verification", "verification", [], { requests: [] }),
            typing: feed<TypingState>("typing", "typing", [], { rooms: {} }),
            notifications: feed<NotificationState>("notifications", "notifications", [], {
                permission: "default",
                supported: false,
            }),
            profile: feed<ProfileView | null>("profile", "profile", [], null),
            ownPresence: feed<OwnPresenceView | null>("ownPresence", "ownPresence", [], null),

            timeline: (roomId: string) =>
                feed<MessageView[]>(`timeline:${roomId}`, "timeline", [roomId], []),
            loadMore: call("loadMore"),
            send: call("send"),
            retry: call("retry"),
            sendMediaMessage: call("sendMediaMessage"),
            sendAttachments: call("sendAttachments"),
            uploadLimit: call("uploadLimit"),
            toggleReaction: call("toggleReaction"),
            edit: call("edit"),
            sendTyping: call("sendTyping"),
            // Synchronous by contract, so served from the pushed capability snapshot.
            supportsThreads: () => capabilities.supportsThreads,

            resolveMedia: async (uri: string, size: number) =>
                mediaUrl(await rpc("resolveMedia", [uri, size]), "image/*"),
            resolveMediaDownload: async (uri: string) =>
                mediaUrl(await rpc("resolveMediaDownload", [uri]), "application/octet-stream"),
            resolveEncryptedMedia: async (file: EncryptedAttachment) =>
                mediaUrl(await rpc("resolveEncryptedMedia", [file]), "application/octet-stream"),

            requestNotificationPermission: call("requestNotificationPermission"),
            threads: (roomId: string) =>
                feed<ThreadSummary[]>(`threads:${roomId}`, "threads", [roomId], []),
            threadTimeline: (threadId: string) =>
                feed<MessageView[]>(`thread:${threadId}`, "threadTimeline", [threadId], []),
            sendReply: call("sendReply"),
            markThreadRead: call("markThreadRead"),
            markRead: call("markRead"),
            redact: call("redact"),
            search: call("search"),
            jumpTo: call("jumpTo"),
            setRoomSelection: (roomId: string | null) => {
                fire("setRoomSelection", [roomId]);
            },
            loadMoreRooms: call("loadMoreRooms"),
            // Synchronous by contract, so served from the pushed capability snapshot.
            hasMoreRooms: () => capabilities.hasMoreRooms,

            createSpace: call("createSpace"),
            createChannel: call("createChannel"),
            createDm: call("createDm"),
            joinRoom: call("joinRoom"),
            leave: call("leave"),
            invite: call("invite"),
            updateRoomSettings: call("updateRoomSettings"),
            searchUsers: call("searchUsers"),

            members: (roomId: string) => feed<MemberView[]>(`members:${roomId}`, "members", [roomId], []),
            loadMembers: call("loadMembers"),
            powerLevels: (roomId: string) =>
                feed<RoomPowerLevelsView | null>(`powerLevels:${roomId}`, "powerLevels", [roomId], null),
            banned: (roomId: string) => feed<MemberView[]>(`banned:${roomId}`, "banned", [roomId], []),
            kick: call("kick"),
            ban: call("ban"),
            unban: call("unban"),
            setPowerLevel: call("setPowerLevel"),

            setProfile: call("setProfile"),
            setOwnPresence: call("setOwnPresence"),
            profileFieldsSupported: call("profileFieldsSupported"),
            setProfileField: call("setProfileField"),
            profileField: (userId: string, key: string) =>
                feed<unknown>(`profileField:${userId}:${key}`, "profileField", [userId, key], null),
            setupRecovery: call("setupRecovery"),
            restoreBackup: call("restoreBackup"),
            startVerification: call("startVerification"),
            acceptVerification: call("acceptVerification"),
            declineVerification: call("declineVerification"),
            confirmSas: call("confirmSas"),
            mismatchSas: call("mismatchSas"),
            listDevices: call("listDevices"),
        };
        return client as unknown as ChatClient;
    }

    /** Send one contribution, replacing every function with a callback placeholder. */
    function contribute(api: RpcContribution["api"], payload: unknown): void {
        scope.postMessage({ kind: "contribution", api, payload: serialize(payload) });
    }

    /** Replace functions with `{ kind: "callback", id }` references recursively. */
    function serialize(value: unknown): unknown {
        if (typeof value === "function") {
            const fn = value as (...args: unknown[]) => unknown;
            const id = nextCallbackId++;
            callbackTable.set(id, fn);
            return { kind: "callback", id };
        }
        if (Array.isArray(value)) return value.map(serialize);
        if (typeof value === "object" && value !== null) {
            const out: Record<string, unknown> = {};
            for (const [key, entryValue] of Object.entries(value)) out[key] = serialize(entryValue);
            return out;
        }
        return value;
    }

    /** Build the context the plugin's `install()` receives. */
    function buildContext(): PluginContext {
        const pluginManifest = manifest;
        if (!pluginManifest) throw new Error("the sandbox has no manifest");
        return {
            manifest: pluginManifest,
            client: workerClient(),
            selection: {
                // A live host object with a hook (`useSelection`) the Worker cannot
                // run; the same three members are exposed over RPC so a command can
                // still navigate.
                current: { view: "dms" },
                select(next) {
                    fire("selection:select", [next]);
                },
                hrefFor(next) {
                    // A pure string builder the shell owns; mirroring it here keeps
                    // `hrefFor` synchronous as the contract requires.
                    return next.guildId ? `#/guild/${next.guildId}` : "#/dms";
                },
            },
            actions: {
                requestLeave(target) {
                    fire("actions:requestLeave", [target]);
                },
                requestModeration(action) {
                    fire("actions:requestModeration", [action]);
                },
                requestMarkRead(roomId) {
                    fire("actions:requestMarkRead", [roomId]);
                },
                requestPinRoom(roomId, pinned) {
                    fire("actions:requestPinRoom", [roomId, pinned]);
                },
                requestMuteRoom(roomId, muted) {
                    fire("actions:requestMuteRoom", [roomId, muted]);
                },
                requestMarkSpaceRead(spaceId) {
                    fire("actions:requestMarkSpaceRead", [spaceId]);
                },
                requestSpaceSettings(spaceId) {
                    fire("actions:requestSpaceSettings", [spaceId]);
                },
                requestSpaceInvite(spaceId) {
                    fire("actions:requestSpaceInvite", [spaceId]);
                },
                requestSpaceCreateChannel(spaceId) {
                    fire("actions:requestSpaceCreateChannel", [spaceId]);
                },
            },
            media: {
                resolve: async (uri, size) => mediaUrl(await rpc("resolveMedia", [uri, size]), "image/*"),
                resolveDownload: async (uri) =>
                    mediaUrl(await rpc("resolveMediaDownload", [uri]), "application/octet-stream"),
                resolveEncrypted: async (file) =>
                    mediaUrl(await rpc("resolveEncryptedMedia", [file]), "application/octet-stream"),
            },
            addRenderer() {
                // A renderer is a live component: a sandbox plugin cannot contribute
                // one, and the lane rule derives that from its permissions, so this
                // is unreachable in practice. Refuse honestly rather than register
                // nothing.
                throw new Error("timeline renderers require the trusted lane");
            },
            addComposerAction(action: ComposerAction) {
                contribute("addComposerAction", action);
                return () => undefined;
            },
            addCommand(command: Command) {
                contribute("addCommand", command);
                return () => undefined;
            },
            addMemberDecoration() {
                throw new Error("member decorations require the trusted lane");
            },
            addActivityRenderer() {
                throw new Error("activity renderers require the trusted lane");
            },
            addSettingsTab() {
                throw new Error("settings tabs require the trusted lane");
            },
            addPane() {
                throw new Error("workspace panes require the trusted lane");
            },
            injectStylesheet(css: string) {
                contribute("injectStylesheet", { css });
                return () => undefined;
            },
        };
    }

    /** One client facade per Worker, so install-time and invocation-time `client` are the same object. */
    let sharedClient: ChatClient | null = null;
    function workerClient(): ChatClient {
        sharedClient ??= buildClient();
        return sharedClient;
    }

    /**
     * Rebuild what the host sent for an invocation. The host cannot send live
     * objects, so it marks them (see `toWire` in host.ts): `{ kind: "client" }`
     * is the shell's ChatClient — here, this Worker's own bridged client, so
     * every call it makes goes through the host's policy — and
     * `{ kind: "hostfn" }` is a host function such as a composer action's
     * `setDraft`, callable back only while this invocation is running.
     */
    function fromWire(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(fromWire);
        if (typeof value !== "object" || value === null) return value;
        const marked = value as { kind?: unknown; invoke?: unknown; fn?: unknown };
        if (marked.kind === "client") return workerClient();
        if (marked.kind === "hostfn" && typeof marked.invoke === "number" && typeof marked.fn === "number") {
            const { invoke, fn } = marked;
            return (...args: unknown[]) => rpc(INVOKE_FN, [invoke, fn, ...args]);
        }
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) out[key] = fromWire(entry);
        return out;
    }

    /** Hand an `invoke` request to the plugin's function, replying with its result. */
    function handleInvoke(callId: number, args: unknown[]): void {
        const [callbackId, ...wire] = args;
        const fn = typeof callbackId === "number" ? callbackTable.get(callbackId) : undefined;
        if (!fn) {
            scope.postMessage({ kind: "invoke-result", id: callId, ok: false, error: "unknown callback" });
            return;
        }
        const rest = wire.map(fromWire);
        void Promise.resolve()
            .then(() => fn(...rest))
            .then(
                (value) => scope.postMessage({ kind: "invoke-result", id: callId, ok: true, value }),
                (error: unknown) =>
                    scope.postMessage({
                        kind: "invoke-result",
                        id: callId,
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    }),
            );
    }

    /** Import the bundle text and return its `Plugin` export. */
    async function importPlugin(source: string): Promise<Plugin> {
        const url = scope.createObjectUrl(new Blob([source], { type: "text/javascript" }));
        let module: unknown;
        try {
            module = await scope.importModule(url);
        } finally {
            scope.revokeObjectUrl(url);
        }
        const exported = module as { plugin?: unknown; default?: unknown };
        const plugin = exported?.plugin ?? exported?.default;
        if (typeof plugin !== "object" || plugin === null) {
            throw new Error("the bundle does not export a plugin");
        }
        const candidate = plugin as { manifest?: unknown; install?: unknown };
        if (typeof candidate.install !== "function") {
            throw new Error("the bundle's plugin has no install() function");
        }
        return plugin as Plugin;
    }

    /** Run the plugin and reply `ready`. */
    async function initialise(init: {
        bundle: string;
        manifest: unknown;
        capabilities: SandboxCapabilities;
    }): Promise<void> {
        capabilities = init.capabilities;
        manifest = init.manifest as PluginManifest;
        try {
            const plugin = await importPlugin(init.bundle);
            const result = plugin.install(buildContext());
            teardown = typeof result === "function" ? result : null;
            scope.postMessage({ kind: "ready", ok: true });
        } catch (error) {
            scope.postMessage({
                kind: "ready",
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /** Stop: run teardown, drop state, and close the scope. */
    function dispose(): void {
        if (disposed) return;
        disposed = true;
        if (teardown) {
            try {
                teardown();
            } catch (error) {
                console.error("[tumult] sandbox teardown failed", error);
            }
        }
        for (const pending of pendingCalls.values()) {
            pending.reject(new Error("the plugin was uninstalled"));
        }
        pendingCalls.clear();
        callbackTable.clear();
        feedValues.clear();
        feedEntries.clear();
        feedEntriesById.clear();
        manifest = null;
        teardown = null;
        scope.close();
    }

    function handleMessage(data: unknown): void {
        const message = data as HostMessage | null | undefined;
        if (!message || typeof message !== "object" || !("kind" in message)) return;
        switch (message.kind) {
                case "result": {
                    const pending = pendingCalls.get(message.id);
                    if (!pending) break;
                    pendingCalls.delete(message.id);
                    if (message.ok) pending.resolve(message.value);
                    else pending.reject(wireError(message.error));
                    break;
                }
                case "feed": {
                    feedValues.set(message.id, message.value);
                    const local = feedEntriesById.get(message.id);
                    if (local) {
                        for (const listener of local.listeners) listener(message.value);
                    }
                    break;
                }
                case "capabilities": {
                    capabilities = message.capabilities;
                    break;
                }
                case "invoke": {
                    handleInvoke(message.id, message.args);
                    break;
                }
                case "dispose": {
                    dispose();
                    break;
                }
                case "init": {
                    void initialise({
                        bundle: message.bundle,
                        manifest: message.manifest,
                        capabilities: message.capabilities,
                    });
                    break;
                }
                default:
                    break;
            }
        }

    // Register with the scope here rather than in `shim.ts`: the runtime IS the
    // message handler, and binding it at construction means a test's fake scope
    // is wired by merely constructing the factory.
    scope.addEventListener("message", (event) => handleMessage(event.data));

    return { handleMessage };
}
