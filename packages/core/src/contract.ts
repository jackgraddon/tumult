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
    senderId: string;
    body: string;
    timestamp: number;
    status: MessageStatus;
    decryption: DecryptionStatus;
}

export interface RoomSummary {
    id: string;
    name: string;
    topic: string | null;
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
    timeline(roomId: string): Subscribable<MessageView[]>;
    send(roomId: string, body: string): Promise<void>;
}
