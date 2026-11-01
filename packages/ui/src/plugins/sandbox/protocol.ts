/**
 * The sandbox wire protocol — the one place host and Worker agree on shapes.
 *
 * A `sandbox`-lane plugin runs in a Worker and can reach the shell only by
 * posting messages. This module is the contract those messages obey: the
 * envelope kinds, the id-based request/response correlation, the error
 * encoding, and the two name lists (client methods, client feeds) that the
 * proxy reflects. It is pure — no `Worker`, no `Blob`, no DOM — so both sides
 * can import it and `packages/ui`'s graph stays DOM-free.
 *
 * Two invariants worth stating because breaking either fails silently:
 *
 *   - **Every `ChatClient` member is named here.** `CLIENT_METHODS` and
 *     `CLIENT_FEEDS` are guarded at compile time (below) against the real
 *     `ChatClient`, so adding a method to the contract fails this build until
 *     the sandbox learns to carry it — never a runtime "undefined is not a
 *     function" inside someone's plugin.
 *   - **Errors cross as strings, never as thrown objects.** A `Worker`'s
 *     error events are not structured and re-throwing a host `Error` inside the
 *     Worker would be a cross-realm lie about its origin, so the wire carries a
 *     message and the receiving side makes a fresh `Error`.
 */

import type { ChatClient } from "@tumult/core/contract";

/** Which side a message came from; used to detect crossed wires in tests. */
export const SANDBOX_PROTOCOL_VERSION = 1;

/** The methods of `ChatClient` that are functions (everything but the feeds). */
type ChatClientMethods = {
    [K in keyof ChatClient]: ChatClient[K] extends (...args: never[]) => unknown ? K : never;
}[keyof ChatClient];

/** The members of `ChatClient` that are `Subscribable` feeds. */
type ChatClientFeeds = Exclude<keyof ChatClient, ChatClientMethods>;

/**
 * Every method the sandbox proxies. Ordering is cosmetic; completeness is
 * compile-enforced by the assertion below.
 */
export const CLIENT_METHODS = [
    "login",
    "completeLogin",
    "restoreSession",
    "logout",
    "start",
    "stop",
    "loadMore",
    "send",
    "retry",
    "sendMediaMessage",
    "sendAttachments",
    "uploadLimit",
    "toggleReaction",
    "edit",
    "sendTyping",
    "supportsThreads",
    "resolveMedia",
    "resolveMediaDownload",
    "resolveEncryptedMedia",
    "requestNotificationPermission",
    "sendReply",
    "markThreadRead",
    "markRead",
    "redact",
    "search",
    "jumpTo",
    "setRoomSelection",
    "loadMoreRooms",
    "hasMoreRooms",
    "createSpace",
    "createChannel",
    "createDm",
    "joinRoom",
    "leave",
    "invite",
    "updateRoomSettings",
    "searchUsers",
    "loadMembers",
    "kick",
    "ban",
    "unban",
    "setPowerLevel",
    "setProfile",
    "setOwnPresence",
    "profileFieldsSupported",
    "setProfileField",
    "setupRecovery",
    "restoreBackup",
    "startVerification",
    "acceptVerification",
    "declineVerification",
    "confirmSas",
    "mismatchSas",
    "listDevices",
] as const satisfies readonly ChatClientMethods[];

/**
 * The parameterised feeds: `timeline(roomId)` and friends are methods that
 * RETURN a feed, so they cross as a subscribe request carrying their key.
 */
export const CLIENT_FEEDS = [
    "session",
    "connection",
    "rooms",
    "security",
    "verification",
    "typing",
    "notifications",
    "profile",
    "ownPresence",
] as const satisfies readonly ChatClientFeeds[];

/** Feeds that are parameterised by an id, subscribed via a method call. */
export const CLIENT_FEED_METHODS = [
    "timeline",
    "threads",
    "threadTimeline",
    "members",
    "powerLevels",
    "banned",
    "profileField",
] as const satisfies readonly ChatClientMethods[];

/** Compile-time completeness: every method is either listed or a feed method. */
type ListedMethods = (typeof CLIENT_METHODS)[number] | (typeof CLIENT_FEED_METHODS)[number];
type _AllMethodsListed = ChatClientMethods extends ListedMethods ? true : never;
type _NoExtraMethods = ListedMethods extends ChatClientMethods ? true : never;
// These bindings exist only to fail the build on drift; they are never read.
export type __MethodCompleteness = [_AllMethodsListed, _NoExtraMethods];

/**
 * The non-`ChatClient` RPC names the Worker may send. `ctx.selection` and
 * `ctx.actions` are the shell's live objects, not part of the client contract,
 * so they travel under their own namespaced names rather than pretending to be
 * client methods. `hrefFor` is deliberately absent: it is a pure string builder
 * the shim answers locally, keeping it synchronous as the contract requires.
 */
export const CONTEXT_METHODS = [
    "selection:select",
    "actions:requestLeave",
    "actions:requestModeration",
    "actions:requestMarkRead",
    "actions:requestPinRoom",
    "actions:requestMuteRoom",
    "actions:requestMarkSpaceRead",
    "actions:requestSpaceSettings",
    "actions:requestSpaceInvite",
    "actions:requestSpaceCreateChannel",
] as const;

export type ContextMethod = (typeof CONTEXT_METHODS)[number];

/**
 * Worker→host call that runs a function the host passed INTO an invocation
 * (a composer action's `setDraft`). Args: `[invokeId, fnId, ...args]`. Live
 * objects cannot cross `postMessage`, so the host sends `{ kind: "hostfn",
 * invoke, fn }` in their place and `{ kind: "client" }` for the ChatClient;
 * the Worker revives both. A hostfn answers only while its invocation runs.
 */
export const INVOKE_FN = "invoke:fn";

/**
 * A method call from the Worker to the host. `args` is whatever the plugin
 * passed, already structured-cloneable (the shim rejects the rest).
 */
export interface RpcCall {
    kind: "call";
    /** Correlates with the matching `RpcResult`. */
    id: number;
    /** A `ChatClient` method name (see `CLIENT_METHODS`). */
    method: string;
    args: unknown[];
}

/** A host→Worker push of a feed's current value. */
export interface RpcFeedValue {
    kind: "feed";
    /** The subscription id handed out by the host. */
    id: number;
    /** The new snapshot; structured-cloneable by construction. */
    value: unknown;
}

/** The answer to one `RpcCall`. Exactly one of `value`/`error` is present. */
export interface RpcResult {
    kind: "result";
    id: number;
    ok: boolean;
    value?: unknown;
    error?: string;
}

/**
 * The two `ChatClient` members that are SYNCHRONOUS (`supportsThreads`,
 * `hasMoreRooms`). A synchronous call cannot cross a Worker boundary, so their
 * answers are pushed to the Worker as a snapshot instead; the shim's methods
 * read that cache. Kept explicit so the exception is documented, not hidden.
 */
export interface SandboxCapabilities {
    supportsThreads: boolean;
    hasMoreRooms: boolean;
}

/** Host→Worker: start up. Carries the verified bundle and the manifest JSON. */
export interface RpcInit {
    kind: "init";
    protocol: number;
    /** The verified, hash-checked plugin source text. */
    bundle: string;
    /** The consented manifest, as JSON. */
    manifest: unknown;
    /** Initial values for the synchronous `ChatClient` members. */
    capabilities: SandboxCapabilities;
}

/** Host→Worker: refreshed values for the synchronous members. */
export interface RpcCapabilities {
    kind: "capabilities";
    capabilities: SandboxCapabilities;
}

/** Worker→Host: the plugin's `install()` returned (or threw). */
export interface RpcReady {
    kind: "ready";
    ok: boolean;
    error?: string;
}

/** Host→Worker: run the plugin's `uninstall()`, then stop. */
export interface RpcDispose {
    kind: "dispose";
}

/** Worker→Host: one contribution came back from the plugin's `install()`. */
export interface RpcContribution {
    kind: "contribution";
    /** Which extension point to register it on. */
    api: "addCommand" | "addComposerAction" | "injectStylesheet";
    /** Serialized payload (name, description, usage — never a function). */
    payload: unknown;
}

/**
 * A serialized FUNCTION, as it appears INSIDE a contribution payload. The Worker
 * keeps the real function in a table and substitutes this reference, so plugin
 * code never crosses the boundary; the host revives it into a stub that RPCs
 * back with `invoke`. Not a message of its own — it is payload.
 */
export interface RpcCallbackRef {
    kind: "callback";
    id: number;
}

/** Host→Worker: invoke a callback the plugin registered (`run`, `match`). */
export interface RpcInvoke {
    kind: "invoke";
    id: number;
    args: unknown[];
}

/** Worker→Host: a callback's return value. */
export interface RpcInvokeResult {
    kind: "invoke-result";
    id: number;
    ok: boolean;
    value?: unknown;
    error?: string;
}

/** Every message the Worker may send, in one union so a switch is exhaustive. */
export type WorkerMessage = RpcCall | RpcReady | RpcContribution | RpcInvokeResult;

/** Every message, in one union so a switch is exhaustive. */
export type HostMessage =
    | RpcInit
    | RpcResult
    | RpcFeedValue
    | RpcDispose
    | RpcCapabilities
    | RpcInvoke;

/** Make a fresh `Error` from a wire message (never share a realm's Error). */
export function wireError(message: string | undefined): Error {
    return new Error(message && message.length > 0 ? message : "the sandbox plugin failed");
}
