/**
 * The contract between `@tumult/core` and everything above it.
 *
 * Nothing in this file may reference a matrix-js-sdk type. The UI is allowed to
 * know these shapes and nothing else; core is free to change how it produces
 * them. Every value here is a plain snapshot — safe to hold, compare and render
 * without worrying that the SDK mutated it underneath you.
 */

/** Cancels a subscription created by {@link Subscribable.subscribe}. */
export interface Subscription {
    unsubscribe(): void;
}

/**
 * A current value plus a change feed.
 *
 * `get()` always returns the latest snapshot, so a subscriber never has to
 * handle "no value yet". Listeners fire after the snapshot has been replaced.
 */
export interface Subscribable<T> {
    get(): T;
    subscribe(listener: (value: T) => void): Subscription;
}

/**
 * Where the sync loop is, as far as the UI is concerned.
 *
 * This is deliberately coarser than the SDK's own sync states: PREPARED and
 * CATCHUP both land on `syncing` because the UI treats them identically.
 */
export type ConnectionState = "starting" | "syncing" | "reconnecting" | "error" | "stopped";

/** Local send lifecycle. `sending` is a local echo with no server event yet. */
export type MessageStatus = "sending" | "sent" | "failed";

/**
 * Whether we can read a message yet.
 *
 * `pending` is not an error: encrypted events routinely arrive before the keys
 * that open them, and upgrade to `ok` or `failed` later. The UI must render it
 * as a placeholder rather than dropping the event.
 */
export type DecryptionStatus = "ok" | "pending" | "failed";

export interface MessageView {
    id: string;
    /** Matrix event type, e.g. "m.room.message", "cc.jackg.tumult.chess.move". */
    type: string;
    senderId: string;
    body: string;
    timestamp: number;
    status: MessageStatus;
    decryption: DecryptionStatus;
    /** Type-specific payload as plain JSON. The registered renderer owns its shape. */
    content: Readonly<Record<string, unknown>>;
    /** True when an `m.replace` edit superseded this message's body. */
    edited: boolean;
    /** Aggregated `m.reaction` annotations on this message. Never null. */
    reactions: ReactionView[];
    /**
     * Users who have read at least this far, for whom this is the deepest
     * held message — i.e. each reader appears on exactly one row, the
     * Discord-style "seen" marker. Includes ourselves once our receipt
     * lands. Never null.
     */
    readBy: string[];
}

/** One grouped emoji annotation: count across senders, flag for our own. */
export interface ReactionView {
    emoji: string;
    count: number;
    ownReacted: boolean;
}

export interface RoomSummary {
    id: string;
    name: string;
    topic: string | null;
    /**
     * Usually an `mxc://` URI — NOT directly loadable: pass it through
     * `resolveMedia()`. May also be an already-loadable URL (fixtures).
     */
    avatarUrl: string | null;
    /** True for Matrix spaces, which render as guilds/categories rather than channels. */
    isSpace: boolean;
    /** Parent spaces, used to build the guild rail. Empty means orphaned — a DM by our rule. */
    parentSpaceIds: string[];
    unreadCount: number;
    highlightCount: number;
}

/** The signed-in identity. `null` when logged out. */
export interface SessionView {
    userId: string;
    /**
     * Stable per-install device ID. Crypto identity is tied to it, so it is
     * generated once and reused for the life of the session.
     */
    deviceId: string;
    homeserverUrl: string;
}

/**
 * Encryption health of this device, as the UI needs it.
 *
 * `backupEnabled` means a key backup exists on the server and the engine is
 * running; `backupTrusted` means this device holds the backup decryption key.
 * A fresh device typically reads `{ enabled: true, trusted: false }` — the
 * recovery-key prompt state.
 */
export interface SecurityStatus {
    crossSigningReady: boolean;
    backupEnabled: boolean;
    backupTrusted: boolean;
    secretStorageReady: boolean;
}

/** One SAS verification request, as the UI needs it. */
export interface VerificationRequestView {
    id: string;
    initiatedByMe: boolean;
    otherUserId: string;
    otherDeviceId: string | undefined;
    isSelfVerification: boolean;
    phase: "unsent" | "requested" | "ready" | "started" | "cancelled" | "done";
    sasEmoji: [string, string][] | null;
    sasDecimal: [number, number, number] | null;
}

export interface VerificationState {
    requests: VerificationRequestView[];
}

/** Per-room typing state: user ids currently typing, sorted. */
export interface TypingState {
    /** roomId → typing user ids (self excluded). */
    rooms: Record<string, string[]>;
}

/** One thread in a room, as the UI needs it. */
export interface ThreadSummary {
    rootEventId: string;
    replyCount: number;
    lastReplyTs: number;
    unreadCount: number;
    hasParticipated: boolean;
}

/** One of this account's devices, as the account menu needs it. */
export interface DeviceView {
    id: string;
    displayName: string | null;
    lastSeenTs: number | null;
    isCurrent: boolean;
    verified: boolean;
}

export interface LoginParams {
    /** Base URL of the homeserver, e.g. `https://matrix.example.com`. */
    homeserverUrl: string;
}

export interface CompleteLoginParams {
    /**
     * The full callback URL the IdP redirected back to, including its fragment.
     * Secrets come back in the fragment by default, so pass the whole URL rather
     * than pre-parsed query params.
     */
    callbackUrl: string;
}

export interface ChatClient {
    /**
     * Begin MAS login.
     *
     * This navigates the browser to the identity provider, so in a browser the
     * returned promise never resolves — the page is gone. It rejects if
     * discovery or client registration fails before the redirect.
     */
    login(params: LoginParams): Promise<void>;

    /**
     * Finish login after the IdP redirects back. Exchanges the authorization
     * code for tokens and persists the session.
     */
    completeLogin(params: CompleteLoginParams): Promise<void>;

    /**
     * Rehydrate a persisted session without user interaction.
     * Resolves `false` when there is nothing stored to restore.
     */
    restoreSession(): Promise<boolean>;

    /** Revoke tokens, drop the crypto store, and clear persisted session state. */
    logout(): Promise<void>;

    /** Boot crypto and start the sync loop. Requires a session. */
    start(): Promise<void>;

    /** Stop the sync loop without discarding the session. */
    stop(): Promise<void>;

    session: Subscribable<SessionView | null>;
    connection: Subscribable<ConnectionState>;
    rooms: Subscribable<RoomSummary[]>;
    security: Subscribable<SecurityStatus>;
    verification: Subscribable<VerificationState>;
    typing: Subscribable<TypingState>;
    /**
     * Snapshot feed for one room's timeline.
     *
     * Must return the same `Subscribable` instance for a given `roomId` on
     * every call, so two panes on one room share one snapshot and
     * `Observable.subscriberCount` can drive idle-room unloading later.
     */
    timeline(roomId: string): Subscribable<MessageView[]>;
    /**
     * Paginate one page of history backwards into `timeline(roomId)`.
     *
     * Resolves `true` when the page added events (more may exist), `false`
     * when the start of history — or a gap the client won't fill — is
     * reached. Concurrent calls for one room collapse into a single request.
     */
    loadMore(roomId: string): Promise<boolean>;
    send(roomId: string, body: string): Promise<void>;
    /**
     * Toggle our `emoji` reaction on a message: sends `m.reaction` when we
     * haven't reacted, redacts our reaction when we have. The feed maps the
     * result; the returned promise only signals the request finished.
     */
    toggleReaction(roomId: string, targetEventId: string, emoji: string): Promise<void>;
    /**
     * Replace our message's body via `m.replace`. Only our own messages can
     * be edited; the feed applies the latest edit from the sender.
     */
    edit(roomId: string, targetEventId: string, newBody: string): Promise<void>;
    /**
     * Send or clear our typing notification. `isTyping: false` clears it.
     * The server auto-expires after ~20s; callers should re-send or clear
     * on blur/send.
     */
    sendTyping(roomId: string, isTyping: boolean): Promise<void>;
    /**
     * False when the homeserver has no thread support (pre-v1.4). The UI hides
     * thread affordances rather than offering a feature that silently degrades.
     * Also false before `start()`, while capability is still unknown.
     */
    supportsThreads(): boolean;
    /**
     * Resolve an `mxc://` URI to a URL an `<img>` can load, at `size` CSS px
     * (fetched at 2x). Authenticated media needs the access token, so this is
     * typically a `blob:` URL. Non-mxc URLs resolve to themselves. Rejects on
     * failure — render a fallback. Shared per image; cheap to call per render.
     */
    resolveMedia(uri: string, size: number): Promise<string>;
    /**
     * Thread list for a room. Same `Subscribable` per roomId on repeat calls.
     */
    threads(roomId: string): Subscribable<ThreadSummary[]>;
    /**
     * Timeline for one thread. Same `Subscribable` per threadId on repeat calls.
     */
    threadTimeline(threadId: string): Subscribable<MessageView[]>;
    /** Send a reply into a thread (the SDK adds the thread relation). */
    sendReply(roomId: string, threadId: string, body: string): Promise<void>;
    /** Mark a thread as read up to its latest event. */
    markThreadRead(threadId: string): Promise<void>;
    /**
     * Send a read receipt for the latest held event in a room. Called when
     * the user is viewing the live tail; throttled per room so re-renders
     * don't spam the server. This is what clears our unread badge.
     */
    markRead(roomId: string): Promise<void>;
    /**
     * Set up secret storage plus a fresh key backup, returning the encoded
     * recovery key. Display it to the user exactly once — it is never
     * retrievable again.
     */
    setupRecovery(): Promise<string>;
    /**
     * Restore the key backup from a recovery key the user pastes in, then
     * decrypt what it unlocks. Rejects when the key is malformed or does
     * not match this account's backup; changes nothing on failure.
     * Resolves `true` when the device also became verified.
     */
    restoreBackup(recoveryKey: string): Promise<boolean>;
    /**
     * Start an interactive SAS verification of this user (own devices).
     * Resolves when the request has been sent; the UI tracks progress
     * through the `verification` feed.
     */
    startVerification(): Promise<void>;
    /** Accept an incoming verification request. */
    acceptVerification(id: string): Promise<void>;
    /** Decline an incoming verification request. */
    declineVerification(id: string): Promise<void>;
    /** Confirm the SAS emoji/decimal match. */
    confirmSas(id: string): Promise<void>;
    /** Report the SAS does not match (cancels with m.mismatched_sas). */
    mismatchSas(id: string): Promise<void>;
    /** This account's devices with verification status, current device first. */
    listDevices(): Promise<DeviceView[]>;
}
