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
    /**
     * Sender's display name as of this event (member state at the time),
     * falling back to the user id. Never empty.
     */
    senderName: string;
    /** Sender's avatar as an `mxc://` URI — resolve via `resolveMedia()`. */
    senderAvatarUrl: string | null;
    body: string;
    timestamp: number;
    status: MessageStatus;
    decryption: DecryptionStatus;
    /** Type-specific payload as plain JSON. The registered renderer owns its shape. */
    content: Readonly<Record<string, unknown>>;
    /** True when an `m.replace` edit superseded this message's body. */
    edited: boolean;
    /**
     * True once a redaction tombstoned this message: the body reads
     * "Message deleted." and edit/delete affordances must hide.
     */
    redacted: boolean;
    /**
     * A compact quote of the message this one replies to (`m.in_reply_to`),
     * or `null` when it isn't a reply.
     *
     * The quoted sender/body come from the replied-to event when it is in the
     * loaded window (post-edit, redaction-aware) and from parsing the reply's
     * own fallback text otherwise, so a quote renders before the history
     * around it has been paginated in. `body` never contains the `> ` prefix.
     */
    reply: ReplyView | null;
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

/** One quoted target of an inline reply. */
export interface ReplyView {
    /** Event id of the replied-to message. */
    eventId: string;
    /** Sender of the quoted message; `""` when neither event nor fallback knows it. */
    senderId: string;
    /** Quoted sender's display name; falls back to `senderId`, `""` when unknown. */
    senderName: string;
    /** Quoted text with any `> ` reply fallback stripped; `""` when unknown. */
    body: string;
}

/** One grouped emoji annotation: count across senders, flag for our own. */
export interface ReactionView {
    emoji: string;
    count: number;
    ownReacted: boolean;
}

/**
 * One page of server-side room search results.
 *
 * Hits are ordinary `MessageView`s: same shapes, same `resolveMedia`, same
 * renderer registry. Encrypted hits carry `decryption: "pending"` — the
 * server can't search ciphertext, so an encrypted room simply matches
 * nothing (client-side search over decrypted history is a v1 non-goal).
 */
export interface SearchPage {
    /** Matches for this page, most recent first (server ordering). */
    hits: MessageView[];
    /** Opaque cursor for the next page; `null` when this is the last one. */
    nextBatch: string | null;
    /** Total matches the server knows about across all pages. */
    total: number;
}

/** Parameters for creating a top-level space (a guild on the rail). */
export interface CreateSpaceParams {
    name: string;
    topic?: string;
}

/**
 * Parameters for creating a channel inside a space.
 *
 * `visibility` defaults to private. `aliasLocalpart` only applies to public
 * rooms — it is the localpart of `#alias:server`, which is what `joinRoom`
 * later resolves. `encrypted` defaults to false; spaces never encrypt (they
 * don't host messages).
 */
export interface CreateChannelParams {
    name: string;
    topic?: string;
    visibility?: "private" | "public";
    aliasLocalpart?: string;
    encrypted?: boolean;
}

/** Parameters for creating a 1:1 direct-message room. */
export interface CreateDmParams {
    userId: string;
    encrypted?: boolean;
}

/** One user-directory hit, as the DM/invite pickers need it. */
export interface UserSearchResult {
    userId: string;
    displayName: string;
    /** Usually an `mxc://` URI — pass through `resolveMedia()`. */
    avatarUrl: string | null;
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
    /**
     * The `m.fully_read` marker for this room — the event before which the
     * user has read everything — or `null` when never set. Drives the
     * "New messages" divider in the timeline. Comes from room account data,
     * so it changes on sync, not on our own sends.
     */
    fullyReadEventId: string | null;
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

/** Browser notification permission state. */
export type NotificationPermission = "default" | "denied" | "granted";

/** Whether the browser supports notifications and the current permission. */
export interface NotificationState {
    permission: NotificationPermission;
    supported: boolean;
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

/**
 * Membership of a room, as the members pane shows it. Only `join` and `invite`
 * are ever published — left/banned/kicked members belong to slice 22's
 * moderation surface, not the roster.
 */
export type Membership = "join" | "invite" | "leave" | "ban" | "knock";

/**
 * Presence of a room member.
 *
 * `"unknown"` is a real state, not a placeholder: presence only exists once the
 * server has sent that user's `m.presence` *this session*. Presence restored
 * from the store's cache is deliberately not trusted (it can be days old and
 * still say `"online"`), so a member stays `"unknown"` until the server tells
 * us otherwise. Never invent `"online"`.
 */
export type PresenceState = "online" | "offline" | "unknown";

/** One member of a room, as the members pane needs it. */
export interface MemberView {
    userId: string;
    /** Plain display name (never disambiguated); the localpart when unnamed. */
    displayName: string;
    /** Usually an `mxc://` URI — pass through `resolveMedia()`. */
    avatarUrl: string | null;
    /** `join` or `invite` only. */
    membership: Membership;
    /** From the room's power levels — drives admin/mod grouping and ordering. */
    powerLevel: number;
    isSelf: boolean;
    presence: PresenceState;
    /**
     * Approximate last-activity time (ms since epoch) derived from live
     * presence, `null` when presence is unknown. A moment ago for `online`.
     */
    lastActiveTs: number | null;
}

/** Our own profile, as the account menu and edit dialog need it. */
export interface ProfileView {
    userId: string;
    /** Plain display name; the localpart while unnamed. */
    displayName: string;
    /** Usually an `mxc://` URI — pass through `resolveMedia()`. */
    avatarUrl: string | null;
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

/**
 * The `file` descriptor on an encrypted `m.room.message` media event.
 * Plain JSON — no SDK types.
 */
export interface EncryptedAttachment {
    /** `mxc://` URI of the ciphertext. */
    url: string;
    /** JWK for the AES-CTR key. */
    key: {
        alg: string;
        key_ops: string[];
        kty: string;
        k: string;
        ext: boolean;
    };
    /** Base64 (unpadded) 16-byte initial counter block. */
    iv: string;
    /** Ciphertext hashes, keyed by algorithm name (`sha256`). */
    hashes: Record<string, string>;
    /** Version string (currently `"v2"`). */
    v: string;
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
    notifications: Subscribable<NotificationState>;
    /**
     * Our own profile, published once `start()` boots and after every
     * successful `setProfile()`. `null` before there is a session.
     */
    profile: Subscribable<ProfileView | null>;
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
    /**
     * Send one plaintext message. `replyToEventId`, when given, makes it a
     * rich reply: `m.relates_to.m.in_reply_to` on the wire plus a `> `-quoted
     * fallback body for clients that don't understand relations.
     */
    send(roomId: string, body: string, replyToEventId?: string): Promise<void>;
    /**
     * Retry a failed send — the pending event the SDK left in `NOT_SENT`.
     * Resolves once the re-sent request settles; the map still surfaces a
     * subsequent failure through the `failed` status.
     */
    retry(roomId: string, eventId: string): Promise<void>;
    /**
     * Upload and send a media file (image, video, audio, or generic file).
     *
     * The file is uploaded to the homeserver first, then an `m.room.message`
     * is sent with the resulting `mxc://` URI. The SDK owns the local echo
     * lifecycle; the feed maps every transition. `body` is an optional caption
     * — when omitted, the filename is used.
     */
    sendMediaMessage(roomId: string, file: File | Blob, body?: string): Promise<void>;
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
     * Resolve an encrypted attachment (the `file` descriptor on an encrypted
     * `m.room.message`) to a URL an `<img>` can load — fetches the ciphertext
     * and decrypts it. Typically a `blob:` URL. Rejects on failure.
     */
    resolveEncryptedMedia(file: EncryptedAttachment): Promise<string>;
    /**
     * Request browser notification permission from the user.
     *
     * Resolves to the resulting permission (`"granted"`, `"denied"`, or
     * `"default"` if the prompt was dismissed). No-op returning `"denied"`
     * when the Notification API is unsupported.
     */
    requestNotificationPermission(): Promise<NotificationPermission>;
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
     * Send a read receipt for the latest held event in a room, and set the
     * `m.fully_read` marker to the same point. Called when the user is
     * viewing the live tail; throttled per room so re-renders don't spam the
     * server. This is what clears our unread badge AND positions the
     * "New messages" divider.
     */
    markRead(roomId: string): Promise<void>;
    /**
     * Redact (delete) an event: our own messages, or anything our power
     * levels allow. The target tombstones ("Message deleted.") when the
     * redaction lands on the next sync — the redaction event itself never
     * renders. Rejects when the server refuses; the row keeps its content.
     */
    redact(roomId: string, eventId: string, reason?: string): Promise<void>;
    /**
     * Server-side search over one room's history, most recent match first.
     *
     * `opts.nextBatch` (from a previous page's `nextBatch`) fetches the
     * following page. Encrypted events are invisible to the server, so
     * encrypted rooms effectively return no hits — honest, not an error.
     * Rejects when the homeserver has search disabled.
     */
    search(roomId: string, term: string, opts?: { nextBatch?: string }): Promise<SearchPage>;
    /**
     * Make sure `eventId` is in `timeline(roomId)` by paginating history
     * backwards, bounded (the UI jumps to it afterwards). Resolves `false`
     * when the event is older than the bound or gone (redacted-and-purged,
     * never-joined history) — callers must not scroll on `false`.
     */
    jumpTo(roomId: string, eventId: string): Promise<boolean>;
    /**
     * Create a top-level space (renders as a guild on the rail). Resolves to
     * the new room id once the server has it; it lands in `rooms` on a later
     * sync — the UI waits for the feed before selecting it.
     */
    createSpace(params: CreateSpaceParams): Promise<string>;
    /**
     * Create a channel under `spaceId` and link it (`m.space.child` on the
     * space, `m.space.parent` on the channel). Public channels take an
     * `aliasLocalpart` so others can `joinRoom("#alias:server")`. Resolves to
     * the new room id; it lands in `rooms` on a later sync.
     */
    createChannel(spaceId: string, params: CreateChannelParams): Promise<string>;
    /**
     * Create a private 1:1 room with `userId`, inviting them and recording it
     * in `m.direct`. Resolves to the new room id; lands in `rooms` on a later
     * sync (as an orphan, i.e. in the DMs tab).
     */
    createDm(params: CreateDmParams): Promise<string>;
    /**
     * Join a room by id or `#alias:server`. Also accepts an invite to a room
     * we're not in yet. Resolves to the room id; it lands in `rooms` on a
     * later sync.
     */
    joinRoom(idOrAlias: string): Promise<string>;
    /**
     * Leave a room we're in (or reject an invite). The room leaves `rooms` on
     * a later sync; the UI must clear a selection that points at it.
     */
    leave(roomId: string): Promise<void>;
    /** Invite `userId` to `roomId`. Rejects when the server refuses. */
    invite(roomId: string, userId: string): Promise<void>;
    /**
     * User-directory search over ids, display names and domains. Accepts a
     * raw `@user:server` id too (the UI shows both kinds of input), but the
     * directory itself only matches what the server indexes.
     */
    searchUsers(term: string, opts?: { limit?: number }): Promise<UserSearchResult[]>;
    /**
     * Member roster for one room. Same `Subscribable` per roomId on repeat
     * calls (same rule as `timeline`). Ordered by power level descending,
     * then display name; only `join` and `invite` members appear.
     *
     * Under lazy loading the first snapshot can be partial — it holds whoever
     * came through sync until `loadMembers(roomId)` resolves.
     */
    members(roomId: string): Subscribable<MemberView[]>;
    /**
     * Fetch a room's full membership list the first time its members pane
     * opens. Resolves once `members(roomId)` holds the complete roster.
     * Rejects when the homeserver refuses — the feed keeps whatever it
     * already had, so the UI must surface the failure rather than present a
     * partial roster as complete. Concurrent calls for one room collapse.
     */
    loadMembers(roomId: string): Promise<void>;
    /**
     * Update our own profile: a `displayName` through the profile endpoint
     * (empty string clears it), and/or an `avatar` uploaded to the media
     * repository (`null` clears the avatar). Then re-reads the profile so the
     * `profile` feed reflects what the server stored. Rejects on failure and
     * refreshes the feed from the server, so a half-applied change (name
     * landed, upload failed) is shown honestly.
     */
    setProfile(params: { displayName?: string; avatar?: Blob | null }): Promise<void>;
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
