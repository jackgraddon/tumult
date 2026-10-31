import {
    ClientEvent,
    PushRuleKind,
    createClient,
    EventType,
    HttpApiEvent,
    IndexedDBStore,
    NotificationCountType,
    SyncState,
    UserEvent,
    type MatrixClient,
    type MatrixEvent,
    type SyncStateData,
} from "matrix-js-sdk";
import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";

import type {
    AttachmentSendResult,
    OutgoingAttachment,
    SendAttachmentsOptions,
    VoiceSettings,
    VoiceVideoSource,
    VoiceView,
    CallView,
    ChatClient,
    CompleteLoginParams,
    ConnectionState,
    CreateChannelParams,
    CreateDmParams,
    CreateSpaceParams,
    DeviceView,
    EncryptedAttachment,
    LoginParams,
    MemberView,
    MessageView,
    NotificationPermission,
    NotificationState,
    OwnPresenceState,
    OwnPresenceView,
    ProfileView,
    RoomPowerLevelsView,
    RoomSettingsPatch,
    RoomSummary,
    SearchPage,
    SecurityStatus,
    SessionView,
    Subscribable,
    Subscription,
    ThreadSummary,
    TypingState,
    UserSearchResult,
    VerificationState,
} from "./contract.ts";
import { Observable } from "./observable.ts";
import { UNCHECKED_SECURITY, querySecurityStatus } from "./crypto/security.ts";
import { restoreFailureMessage, serveHeldKey, shouldVerifyDevice } from "./crypto/restore.ts";
import { mergeRoomSummaries, sameRoomSummaries, snapshotRooms } from "./rooms/snapshot.ts";
import { resendAfterOutage, sendTextMessage, retryTextMessage } from "./rooms/send.ts";
import { readUploadLimit, sendAttachments, sendMediaMessage } from "./rooms/media.ts";
import { sendEditMessage } from "./rooms/edits.ts";
import { redactEvent } from "./rooms/redact.ts";
import { searchRoomHistory } from "./rooms/search.ts";
import { toggleReaction } from "./rooms/reactions.ts";
import { fallbackName, readProfile, writeProfile } from "./rooms/profile.ts";
import { readOwnPresence } from "./rooms/own-presence.ts";
import { assertProfileFieldKey, ProfileFieldStore } from "./rooms/profile-fields.ts";
import { updateRoomSettings as writeRoomSettings } from "./rooms/settings.ts";
import {
    createChannel,
    createDm,
    createSpace,
    inviteToRoom,
    joinRoom,
    leaveRoom,
    searchUserDirectory,
} from "./rooms/lifecycle.ts";
import { TypingTracker } from "./typing/tracker.ts";
import { ThreadTracker } from "./threads/tracker.ts";
import { MembersTracker } from "./rooms/members.ts";
import { banMember, kickMember, PowerLevelsTracker, setMemberPowerLevel, unbanMember } from "./rooms/moderation.ts";
import { MediaResolver } from "./media/resolver.ts";
import { NotificationTracker } from "./notifications/tracker.ts";
import { PresencePoller } from "./rooms/presence.ts";
import { UnreadTracker } from "./rooms/unread.ts";
import { onDecryptedRebuild, TimelineFeed } from "./timeline/feed.ts";
import { ThrottledTask } from "./util/throttle.ts";
import { VerificationManager } from "./verification/manager.ts";
import { OAuthLogin, type AuthNavigator, type ClientMetadata } from "./auth/oauth.ts";
import { AuthStorage, type StoredSession } from "./auth/storage.ts";
import { toConnectionState, watchNetwork } from "./sync/connection.ts";
import { buildSlidingSync, detectSlidingSync, type ActiveSyncMode, type SlidingSync, type SlidingSyncRangeManager, type SssWindowStore, type SyncModeOption } from "./sync/sliding.ts";
import { RtcFeature } from "./call/rtc.ts";
import { SHELL_CACHE_DEBOUNCE_MS, clearShellSnapshot, readShellSnapshot, writeShellSnapshot } from "./shellCache.ts";

export interface ChatClientOptions {
    /** Identity this app presents to the IdP during dynamic registration. */
    clientMetadata: ClientMetadata;
    storage?: AuthStorage;
    /** Overridable so tests can assert on the redirect instead of navigating. */
    navigator?: AuthNavigator;
    /**
     * Sync loop selection. `auto` (default) prefers Simplified Sliding Sync
     * (MSC4186) when the homeserver advertises it, else classic `/sync`.
     * `classic` forces `/sync`; `sliding` forces MSC4186 (falling back to
     * classic if the server turns out not to speak it). A future UI setting
     * would persist a choice here and apply it at startup — the mode is read
     * once, in `start()`.
     */
    syncMode?: SyncModeOption;
    /**
     * Public URL of the call app to embed (Element Call's *embedded* package,
     * served at its root). Unset means calls are unsupported: `supportsCalls()`
     * is false and the UI shows no call affordance. The origin must also be
     * allowed by the page's CSP `frame-src`.
     */
    elementCallUrl?: string;
    /**
     * Enables native audio voice (MatrixRTC + LiveKit, no frame). Supplied by the
     * host because LiveKit encrypts media frames in a worker that only the host's
     * bundler can build (`livekit-client/e2ee-worker`); core stays bundler-free.
     * Unset means `supportsVoice()` is false.
     */
    createE2EEWorker?: () => Promise<Worker>;
}

/**
 * One crypto store per account *and* device. Sharing a store between accounts
 * corrupts device keys; deriving the name from both means a second login can
 * never land on the first one's store.
 */
function cryptoDatabasePrefix(session: StoredSession): string {
    const safe = (value: string): string => value.replace(/[^a-zA-Z0-9]+/g, "-");
    return `tumult:${safe(session.userId)}:${safe(session.deviceId)}`;
}

/**
 * Sync cache database name. Shared by start() and logout(): if these ever drift,
 * logout silently leaves a stale cache behind for the next login to trip over.
 */
function syncDatabaseName(session: StoredSession): string {
    return `tumult-sync:${session.userId}`;
}

/**
 * A structure signature over a room list, for gating an async cache write.
 *
 * The published room list re-publishes on every sync and receipt burst, and
 * `sameRoomSummaries` already skips a republish when nothing counts-differently
 * moved — but a single new message bumps a count, republishes the array, and
 * arms the debounced writer. Counts change every message; the *structure* (which
 * rooms exist, their names, space nesting, favourites) is what first paint needs
 * and changes rarely, so a count-only update must not force a localStorage write.
 *
 * The signature therefore keeps only structural fields and omits the
 * high-frequency ones (unread / highlight / read marker / topic / alias, which
 * the live sync reconciles anyway). Order is preserved positionally — a genuine
 * reorder SHOULD write once — so the signature is compared against the last
 * written one rather than recomputed-and-stored per burst.
 */
function shellSignature(rooms: readonly RoomSummary[]): string {
    return rooms
        .map((r) => {
            const kind = r.isSpace ? "S" : "C";
            const fav = r.favourite ? String(r.favouriteOrder ?? 0) : "-";
            return [r.id, r.name, kind, fav, r.parentSpaceIds.join(","), r.avatarUrl ?? "", r.joinRule].join("#");
        })
        .join("\n");
}

function createSyncStore(session: StoredSession): IndexedDBStore {
    return new IndexedDBStore({
        indexedDB: globalThis.indexedDB,
        dbName: syncDatabaseName(session),
        localStorage: globalThis.localStorage,
    });
}

/**
 * Persisted sliding-sync room-window upper bound. Namespaced so it can't
 * collide with the session or a pending login, and cleared on logout so the
 * next account starts from the default window.
 */
const SSS_WINDOW_KEY = "tumult.sss.windowEnd";

/**
 * The presence the user last chose (`online` when never set). Re-asserted on
 * start and on {@link OWN_PRESENCE_HEARTBEAT_MS}: sliding sync carries no
 * `set_presence`, so without this the server never hears we are online and
 * keeps reporting `offline` while we are plainly using the app.
 */
const PRESENCE_KEY = "tumult.presence.desired";

/**
 * How often our own presence is re-read and, if the server drifted (idle
 * timeout, another client), re-asserted. Also how fast a status set on
 * another device reaches the bar under sliding sync. One GET per tick.
 */
const OWN_PRESENCE_HEARTBEAT_MS = 60_000;

/**
 * Throttle for progressive room-list refreshes during the first sync. Sliding
 * sync emits `ClientEvent.Room` once per room as it enters the window (roughly
 * 100 events on a large account), all before the single terminal
 * `ClientEvent.Sync`; without a throttle the list would recompute and re-render
 * once per room. One pass per this window keeps it smooth while still painting
 * long before the batch finishes.
 */
const PROGRESSIVE_REFRESH_MS = 120;

/**
 * Coalesce window for crypto-event-driven security snapshots. A single sync or
 * device-list batch re-emits `KeysChanged` / `DevicesUpdated` many times, and
 * each snapshot walks cross-signing, backup trust and secret storage. Explicit
 * moments (start, restore, setup) still refresh immediately.
 */
const SECURITY_REFRESH_MS = 250;

/**
 * Coalesce window for our own presence. Presence for one user can arrive as a
 * burst of `m.presence` events (a status change plus a last-active bump), and
 * each refresh is a REST read; one read per window is enough for a status line.
 */
const OWN_PRESENCE_REFRESH_MS = 250;

export class MatrixChatClient implements ChatClient {
    private readonly storage: AuthStorage;
    private readonly login_: OAuthLogin;
    private readonly syncModeOption: SyncModeOption;
    /** Calls + voice: their feeds, managers and voice settings (call/rtc.ts). */
    private readonly rtc: RtcFeature;
    /** Sync loop actually running; set in bootstrap before startClient. */
    private activeSyncMode: ActiveSyncMode = "classic";

    private matrix: MatrixClient | null = null;
    /**
     * Held so stop() can close the IndexedDB connection. Dropping the reference
     * is not enough — see stop().
     */
    private store: IndexedDBStore | null = null;
    /** In-flight start(), so concurrent callers share one client. */
    private starting: Promise<void> | null = null;
    private stored: StoredSession | null = null;
    /** Per-room timeline feeds, alive while the sync loop runs. */
    private timelines: TimelineFeed | null = null;
    private removeDecryptedHook: (() => void) | null = null;
    /** Active SAS verification requests, alive while the sync loop runs. */
    private _verification: VerificationManager | null = null;
    /** Per-room typing state, alive while the sync loop runs. */
    private _typing: TypingTracker | null = null;
    /** Thread tracking, alive while the sync loop runs. */
    private _threads: ThreadTracker | null = null;
    /** Per-room member rosters, alive while the sync loop runs. */
    private _members: MembersTracker | null = null;
    /** Per-room power levels, alive while the sync loop runs. */
    private _powerLevels: PowerLevelsTracker | null = null;
    /** Authenticated-media fetches as blob URLs, alive while the sync loop runs. */
    private _media: MediaResolver | null = null;
    /** Browser notification firing, alive while the sync loop runs. */
    private _notifications: NotificationTracker | null = null;
    /** Client-side unread counts (sliding sync only — Synapse sends none). */
    private _unread: UnreadTracker | null = null;
    /**
     * A room-list refresh is due on the next microtask. Sync, receipt, and
     * unread-count signals arrive in bursts (a sync batch can carry many
     * receipts); coalescing keeps `snapshotRooms` to one pass per burst.
     */
    private roomRefreshScheduled = false;
    /**
     * Progressive room-list refresh for the first sync (see
     * {@link scheduleProgressiveRefreshRooms}). A throttled task, not a
     * microtask: the first-sync room flood must not recompute once per room.
     */
    private readonly progressiveRefresh: ThrottledTask;
    /**
     * Coalesces crypto-event security refreshes (see {@link SECURITY_REFRESH_MS}).
     * Explicit call sites stay immediate and await the query directly.
     */
    private readonly securityRefresh: ThrottledTask;
    /**
     * Debounced writer for the shell's first-paint cache (see `shellCache.ts`).
     * The room list republishes on every sync/receipt burst; this collapses a
     * flood into one localStorage write so a busy room can't churn the cache.
     */
    private readonly shellPersist: ThrottledTask;
    /**
     * Signature of the last cache write: the room *structure* (ids, names,
     * space nesting, favourite order), not the counts. Counts change every
     * message but the structure is what first paint needs, so a count-only
     * update is not worth a localStorage write.
     */
    private lastShellSignature: string | null = null;
    /**
     * The room list painted from the shell cache at boot, held until the first
     * full sync batch supersedes it. With sliding sync the SDK does not persist
     * its window cursor, so the first network batch is a *partial* resync — far
     * fewer rooms than the cache holds. `refreshRooms()` overlays this seed over
     * every partial batch (see `mergeRoomSummaries`) so the rail can't collapse
     * (92 → 9 → 92) while the window fills in; `clearWarmSeed()` drops it on the
     * first full batch and on every teardown (stop / logout / logged-out).
     */
    private _warmSeed: RoomSummary[] | null = null;
    /** Presence REST poller (sliding sync only — no presence extension). */
    private _presence: PresencePoller | null = null;
    /** Simplified Sliding Sync instance (sliding mode only). */
    private _slidingSync: SlidingSync | null = null;
    /** Sliding-sync room-window owner (sliding mode only). */
    private _rangeManager: SlidingSyncRangeManager | null = null;
    /** The room the UI is showing, fed by `setRoomSelection`. */
    private _selectedRoomId: string | null = null;
    /**
     * Pasted recovery key, held ONLY for the duration of a restoreBackup()
     * call so the SDK's secret-storage requests can use it. Cleared in a
     * `finally` — never retained, never persisted.
     */
    private heldSecretKey: Uint8Array<ArrayBuffer> | null = null;

    private readonly sessionState = new Observable<SessionView | null>(null);
    private readonly connectionState = new Observable<ConnectionState>("stopped");
    private readonly roomsState = new Observable<RoomSummary[]>([]);
    private readonly securityState = new Observable<SecurityStatus>(UNCHECKED_SECURITY);
    private readonly verificationState = new Observable<VerificationState>({ requests: [] });
    private readonly typingState = new Observable<TypingState>({ rooms: {} });
    private readonly notificationsState = new Observable<NotificationState>({
        permission: "default",
        supported: typeof Notification !== "undefined",
    });
    private readonly profileState = new Observable<ProfileView | null>(null);
    /**
     * MSC4133 support, asked once per started client (`null` = not asked).
     * Reset on stop: a different session may land on a different server.
     */
    private profileFieldsSupport: Promise<boolean> | null = null;
    private readonly profileFields = new ProfileFieldStore((userId, key) => this.readProfileField(userId, key), {
        ttlMs: 5 * 60_000,
    });
    /**
     * Our own presence + status message. `null` until the server tells us —
     * presence is user-level state, not something we can infer from the
     * profile, and a fresh session has no honest answer yet.
     */
    private readonly ownPresenceState = new Observable<OwnPresenceView | null>(null);
    /** Coalesces `m.presence` bursts for our own user into one read. */
    private ownPresenceHeartbeat: ReturnType<typeof setInterval> | null = null;
    /** Removes the browser online/offline listeners (watchNetwork). */
    private unwatchNetwork: (() => void) | null = null;
    /** Mirrors `ownPresence` into the rosters, so our row matches the bar. */
    private selfPresenceSubscription: Subscription | null = null;
    private readonly ownPresenceRefresh = new ThrottledTask(() => {
        void this.refreshOwnPresence();
    }, OWN_PRESENCE_REFRESH_MS);

    public constructor(options: ChatClientOptions) {
        this.storage = options.storage ?? AuthStorage.browser();
        this.login_ = new OAuthLogin(this.storage, options.clientMetadata, options.navigator);
        this.syncModeOption = options.syncMode ?? "auto";
        this.rtc = new RtcFeature({
            storage: this.storage,
            elementCallUrl: options.elementCallUrl || null,
            createE2EEWorker: options.createE2EEWorker ?? null,
        });
        this.progressiveRefresh = new ThrottledTask(() => this.refreshRooms(), PROGRESSIVE_REFRESH_MS);
        this.securityRefresh = new ThrottledTask(() => {
            void this.refreshSecurity();
        }, SECURITY_REFRESH_MS);
        this.shellPersist = new ThrottledTask(() => this.flushShellCache(), SHELL_CACHE_DEBOUNCE_MS);
    }

    public get session(): Subscribable<SessionView | null> {
        return this.sessionState;
    }

    public get connection(): Subscribable<ConnectionState> {
        return this.connectionState;
    }

    public get rooms(): Subscribable<RoomSummary[]> {
        return this.roomsState;
    }

    public get security(): Subscribable<SecurityStatus> {
        return this.securityState;
    }

    public get verification(): Subscribable<VerificationState> {
        return this.verificationState;
    }

    public get typing(): Subscribable<TypingState> {
        return this.typingState;
    }

    public get call(): Subscribable<CallView | null> {
        return this.rtc.callFeed;
    }

    public get voice(): Subscribable<VoiceView | null> {
        return this.rtc.voiceFeed;
    }

    public get voiceSettings(): Subscribable<VoiceSettings> {
        return this.rtc.voiceSettingsFeed;
    }

    public get voiceRooms(): Subscribable<Record<string, string[]>> {
        return this.rtc.voiceRoomsFeed;
    }

    public get notifications(): Subscribable<NotificationState> {
        return this.notificationsState;
    }

    public get profile(): Subscribable<ProfileView | null> {
        return this.profileState;
    }

    public get ownPresence(): Subscribable<OwnPresenceView | null> {
        return this.ownPresenceState;
    }

    public async login(params: LoginParams): Promise<void> {
        await this.login_.begin(params.homeserverUrl);
    }

    public async completeLogin(params: CompleteLoginParams): Promise<void> {
        const session = await this.login_.complete(params.callbackUrl);
        this.adoptSession(session);
    }

    public async restoreSession(): Promise<boolean> {
        const session = this.storage.loadSession();
        if (!session) return false;
        this.adoptSession(session);
        return true;
    }

    public async start(): Promise<void> {
        if (!this.stored) throw new Error("Cannot start without a session; log in or restore first");
        if (this.matrix) return;

        // Concurrent starts must share one client. The SDK is explicit that two
        // MatrixClient instances on the same IndexedDB cause data corruption and
        // decryption failures, and the plain `if (this.matrix)` guard above does
        // not prevent it: both callers pass it before either assigns.
        this.starting ??= this.bootstrap(this.stored).finally(() => {
            this.starting = null;
        });
        return this.starting;
    }

    private async bootstrap(session: StoredSession): Promise<void> {
        this.connectionState.set("starting");

        // First paint is cache-first: the SDK's on-disk store only rehydrates
        // presence, not rooms, so `client.getRooms()` is empty until the first
        // network batch — and that batch is a *full* resync, because the SDK does
        // not persist its sliding-sync cursor. Painting the cached room list now
        // means the rail is populated the instant the shell mounts, and the live
        // sync upgrades it in place. A stale or wrong-account entry yields [].
        // The selection the UI is resuming is seeded too, so the last-opened
        // room is subscribed on the very first request.
        const seed = readShellSnapshot(this.storage, { userId: session.userId, homeserverUrl: session.homeserverUrl });
        if (seed.rooms.length > 0) {
            this.roomsState.set(seed.rooms);
            this.lastShellSignature = shellSignature(seed.rooms);
            if (this._selectedRoomId === null) this._selectedRoomId = seed.lastRoomId;
            // Hold the seed so the first partial batch can't collapse the rail;
            // `clearWarmSeed()` drops it on the first full sync.
            this._warmSeed = seed.rooms;
            console.debug(`[tumult] warm seed: ${seed.rooms.length} rooms from shell cache`);
        }

        const store = createSyncStore(session);
        let client: MatrixClient | null = null;

        try {
            client = createClient({
                baseUrl: session.homeserverUrl,
                userId: session.userId,
                deviceId: session.deviceId,
                accessToken: session.accessToken,
                // Supplying oauthClientId lets the SDK refresh tokens itself against
                // MAS; without it an expired access token is simply a dead session.
                oauthClientId: session.clientId,
                ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
                onTokenRefresh: (tokens) => {
                    // The old tokens are already invalid at this point, so persist
                    // synchronously rather than waiting for any other checkpoint.
                    this.persistTokens(tokens.accessToken, tokens.refreshToken);
                },
                // Local echoes join the live timeline in send order, so the
                // feed renders `sending` states. This is the SDK default
                // (`PendingEventOrdering.Chronological`); `detached` would hide
                // echoes until the server echo arrives, so don't set it.
                //
                // `getSecretStorageKey` serves a user-pasted recovery key back
                // to the SDK during restoreBackup() only — see heldSecretKey.
                // Outside a restore it returns null (fresh setup has nothing
                // cached yet, and we never retain keys).
                cryptoCallbacks: {
                    getSecretStorageKey: ({ keys }) => Promise.resolve(serveHeldKey(this.heldSecretKey, keys)),
                },
                store,
            });

            // Must come *after* createClient: the store only gets its `createUser`
            // hook when it is attached to a client, and startup() needs it to
            // rehydrate cached presence events.
            //
            // Getting this backwards fails only once the store has presence events
            // to replay — so a cold start appears to work and the next run throws.
            await store.startup();

            // Rust crypto must be up before the sync loop starts, or the first batch
            // of encrypted events arrives with nothing able to decrypt it.
            await client.initRustCrypto({
                useIndexedDB: true,
                cryptoDatabasePrefix: cryptoDatabasePrefix(session),
            });

            // Registered before startClient() — see toConnectionState().
            client.on(ClientEvent.Sync, (state: SyncState, _prev: SyncState | null, data?: SyncStateData) => {
                const next = toConnectionState(state);
                const previous = this.connectionState.get();
                this.connectionState.set(next);
                // Back from an outage: deliver what the user sent into it.
                if (client && next === "syncing" && (previous === "reconnecting" || previous === "error")) {
                    // Never let this throw: it runs inside the SDK's sync-state
                    // emitter, and an exception there aborts the sync loop
                    // ("Sync startup aborted with an error" — seen on CI).
                    try {
                        const resent = resendAfterOutage(client);
                        if (resent > 0) console.debug(`[tumult] resent ${resent} message(s) sent during the outage`);
                    } catch (error) {
                        console.error("[tumult] could not resend messages after the outage", error);
                    }
                }
                if (state === SyncState.Error && data?.error) {
                    console.error("[tumult] sync error", data.error);
                }
                // The first usable batch supersedes the warm seed: Prepared,
                // Syncing and Catchup all collapse to "syncing", so the first
                // one is the first full list. From here on refreshRooms()
                // publishes the authoritative live list, so drop the seed that
                // was shielding the rail from the partial first resync.
                if (this._warmSeed && next === "syncing") this.clearWarmSeed();
                // The room list is a snapshot over the sync loop: every batch
                // can join/leave/rename rooms, change hierarchy, or move unread
                // counts (receipts ride the same loop). Recompute wholesale —
                // the Sync event is the one invalidation signal that covers all
                // of them without per-room listener bookkeeping.
                //
                // Timelines self-drive off the same loop inside TimelineFeed.
                this.scheduleRefreshRooms();
            });

            // Rooms enter the sliding-sync window one at a time during the
            // first sync: the SDK emits `ClientEvent.Room` per room as soon as
            // that room's events are injected, and the terminal
            // `ClientEvent.Sync` does not fire until the whole batch is done.
            // Waiting for it leaves the room list blank for seconds on a large
            // account while the SDK resolves each room. A throttled recompute
            // here paints the list as rooms arrive. Once the window is warm,
            // rooms are updated (not added), so this rarely fires again.
            client.on(ClientEvent.Room, () => {
                this.scheduleProgressiveRefreshRooms();
            });

            // SSS loop emits ClientEvent.Sync from SlidingSyncState.Complete,
            // which fires BEFORE its post-process extensions run — and the
            // receipts extension is a PostProcess one. Recomputing only on Sync
            // therefore always reads the previous batch's receipt map, so a
            // room read on another client (or in a room we just opened) keeps
            // its stale badge until some later Sync happens to land. The
            // extension re-emits each receipt as ClientEvent.Event, so
            // recompute off that too: this is the invalidation signal that
            // actually covers read positions.
            client.on(ClientEvent.Event, (event: MatrixEvent) => {
                if (event.getType() === EventType.Receipt) this.scheduleRefreshRooms();
            });

            // The homeserver has rejected our token and refreshing could not
            // recover it — revoked from another device, or the refresh token
            // expired. Nothing local fixes this, so surface it as logged out
            // rather than leaving the UI parked on a dead session.
            client.on(HttpApiEvent.SessionLoggedOut, () => {
                void this.handleSessionLoggedOut();
            });

            // IndexedDB can fail at runtime (quota, private browsing, the user
            // clearing site data). The store does not propagate that — it
            // silently becomes a MemoryStore — so without this the app keeps
            // working and quietly stops persisting anything.
            store.on("degraded", (error: Error) => {
                console.error("[tumult] sync store degraded to memory; nothing will persist", error);
            });
            store.on("closed", () => {
                console.error("[tumult] sync store closed unexpectedly");
            });

            this.matrix = client;
            this.store = store;
            this.timelines = new TimelineFeed(client);
            this.removeDecryptedHook = onDecryptedRebuild(client, this.timelines);
            const crypto = client.getCrypto();
            if (crypto) {
                const verification = new VerificationManager(client, crypto);
                verification.setOnUpdate(() => this.publishVerification());
                this._verification = verification;
                this.publishVerification();
            }
            this._typing = new TypingTracker(client);
            this.rtc.attach(client);
            // The tracker owns its own Observable; without this subscription
            // the contract's `typing` feed is published once and never again,
            // so "X is typing…" never appears in the app.
            this._typing.subscribe(() => this.publishTyping());
            this.publishTyping();
            this._threads = new ThreadTracker(client);
            this._members = new MembersTracker(client);
            this._members.setSelfPresence(this.ownPresenceState.get()?.presence ?? "unknown");
            this.selfPresenceSubscription = this.ownPresenceState.subscribe((own) =>
                this._members?.setSelfPresence(own?.presence ?? "unknown"),
            );
            this._powerLevels = new PowerLevelsTracker(client);
            // `slidingSync` is a START option that selects the sync loop: the
            // SDK swaps to SlidingSyncSdk only when the instance is passed to
            // startClient() below. Resolve the mode HERE, before the trackers:
            // unread counts and presence work differently under each loop, and
            // only sliding sync needs the client-side fallbacks (Synapse
            // hardcodes SSS unread counts to 0, and SSS carries no presence at
            // all). Under classic /sync the SDK reports exact server counts and
            // sync-carried presence instead.
            const slidingSupported = this.syncModeOption !== "classic" && (await detectSlidingSync(client));
            this.activeSyncMode = slidingSupported ? "sliding" : "classic";
            const sliding = slidingSupported ? buildSlidingSync(client, this.sssWindowStore()) : null;
            if (sliding) {
                this._unread = new UnreadTracker(client, () => this.scheduleRefreshRooms());
                // The open room's members are polled every tick — the roster on
                // screen stays live — while everyone else refreshes on a slower
                // cadence after a warm-up tick.
                this._presence = new PresencePoller(
                    client,
                    (presence) => this._members?.applyPollPresence(presence),
                    undefined,
                    () => this.priorityPresenceIds(),
                );
                this._presence.start();
            }
            // Profile is a plain HTTP read, independent of the sync loop:
            // seed the feed now rather than waiting for the first batch. A
            // failure publishes the localpart fallback (below) instead.
            void this.refreshProfile();
            // Own presence/status is another independent HTTP read: read it
            // now and re-assert the presence the user chose (sliding sync never
            // tells the server we are here), then keep it honest on a
            // heartbeat. `m.presence` (classic sync) and our own writes refresh
            // it in between; under sliding sync a status set by ANOTHER client
            // lands on the next heartbeat.
            void this.announcePresence();
            this.ownPresenceHeartbeat = setInterval(() => void this.announcePresence(), OWN_PRESENCE_HEARTBEAT_MS);
            const selfId = client.getUserId();
            client.on(UserEvent.Presence, (_event, user) => {
                if (user.userId !== selfId) return;
                this.ownPresenceRefresh.schedule();
            });
            this._media = new MediaResolver(client);
            this._notifications = new NotificationTracker(client);
            this._notifications.subscribe(() => this.publishNotifications());
            this.publishNotifications();
            // Key backup state can move at any time (another device rotates
            // keys, a backup completes). These three cover it; the snapshot
            // recomputes wholesale on each — but a single crypto batch re-emits
            // them many times, so the refresh is coalesced (see
            // SECURITY_REFRESH_MS) rather than run per event.
            for (const event of [
                CryptoEvent.KeyBackupStatus,
                CryptoEvent.KeysChanged,
                CryptoEvent.DevicesUpdated,
            ]) {
                client.on(event, () => {
                    this.securityRefresh.schedule();
                });
            }
            // Thread support is OFF by default — without it the SDK treats
            // thread replies as main-timeline events and never creates Thread
            // objects. It is a START option (IStartClientOpts): `supportsThreads()`
            // reads the opts startClient() stores. Passed to createClient it is
            // silently ignored — that cast-hidden mistake left threads dead.
            //
            // Lazy member loading is the same class of option: on startClient()
            // it shrinks every sync to the members who actually speak (the
            // point — a 10k-member room must not ship its roster every poll);
            // on createClient it is silently ignored. The roster then arrives
            // partial until loadMembers() fetches the full list, which is why
            // MembersTracker never claims a partial snapshot is complete.
            //
            // The mode was resolved above the trackers; here the built list
            // and any selection made before the loop take effect for the first
            // request (setListRanges / modifyRoomSubscriptions are non-sticky
            // and safe pre-start).
            if (sliding) {
                this._slidingSync = sliding.sync;
                this._rangeManager = sliding.manager;
                // Apply the restored (or default) window before the first
                // request; setListRanges is non-sticky and safe pre-start.
                sliding.manager.restoreWindow();
                // The shell selects a room on mount, which can precede this
                // loop; re-apply it so the open room is subscribed from the
                // first request (modifyRoomSubscriptions is safe pre-start).
                this.setRoomSelection(this._selectedRoomId);
            }

            await client.startClient({
                threadSupport: true,
                lazyLoadMembers: true,
                ...(sliding ? { slidingSync: sliding.sync } : {}),
            });
            // Enabling is silent and best-effort: a backup failure must never
            // break login. Runs inside the snapshot query below.
            await this.refreshSecurity();
            this.unwatchNetwork = watchNetwork(client, this.connectionState);
        } catch (error) {
            // Leave nothing half-built. A failed start that leaves a client or an
            // open store behind means the next attempt builds a second client on
            // the same IndexedDB, which corrupts the crypto store.
            client?.stopClient();
            await store.destroy().catch(() => undefined);
            // Trackers built before the failure hold listeners on the dead
            // client; a retry would otherwise stack a second set.
            this.detachSessionTrackers();
            this.connectionState.set("error");
            throw error;
        }
    }

    public async stop(): Promise<void> {
        this.unwatchNetwork?.();
        this.unwatchNetwork = null;
        // Persist the last good list before anything tears it down, so a clean
        // close (as opposed to a logout, which clears the cache afterwards)
        // leaves it intact for the next boot. The flush re-checks its
        // signature, so a list already written by the debounced writer is a
        // no-op; clearing the writer cancels a burst that is otherwise still
        // pending into a half-torn-down state. The selection and store are
        // dropped deeper in this method, so flush up front, before they go.
        this.flushShellCache();
        this.shellPersist.clear();

        // SSS carries no presence; the poller must stop before the client does
        // or it will keep firing against a torn-down store.
        this._presence?.detachAll();
        const client = this.matrix;

        const store = this.store;
        if (!client) return;

        client.stopClient();
        await client.store.save(true);

        // Closing the IndexedDB connection is required, not tidiness.
        // `deleteDatabase` blocks while any connection is open, and both of the
        // SDK's blocked handlers only log — they never resolve or reject — so a
        // surviving connection makes the next logout() hang forever.
        await store?.destroy();

        this.detachSessionTrackers();
        // Stop-only extras (the failure path in bootstrap skips these; that
        // drift is known and deliberately kept). publishTyping runs after the
        // tracker is gone, so it publishes the empty snapshot.
        this.publishTyping();
        this._selectedRoomId = null;
        this.profileFieldsSupport = null;
        this.profileFields.clear();
        this.connectionState.set("stopped");
        this.securityState.set(UNCHECKED_SECURITY);
    }

    /**
     * Tear down everything one started session built, shared by stop() and
     * bootstrap()'s failure path. Both call it only AFTER the client is stopped
     * and the sync store destroyed. Every step is idempotent and safe on a
     * half-built start (anything not yet built is null). Each caller keeps its
     * own extras: stop() its early presence detach, store save and stop-only
     * resets; the failure path its `error` state.
     */
    private detachSessionTrackers(): void {
        this.timelines?.detachAll();
        this.timelines = null;
        this.removeDecryptedHook?.();
        this.removeDecryptedHook = null;
        this._verification?.detachAll();
        this._verification = null;
        this._typing?.detachAll();
        this._typing = null;
        this.rtc.detach();
        this._threads?.detachAll();
        this._threads = null;
        this._members?.detachAll();
        this._members = null;
        this._powerLevels?.detachAll();
        this._powerLevels = null;
        this._media?.dispose();
        this._media = null;
        this._notifications?.detachAll();
        this._notifications = null;
        this._unread?.dispose();
        this._unread = null;
        // stop() already detached the poller before stopClient(); detachAll is
        // idempotent, so the second call here is a no-op on that path.
        this._presence?.detachAll();
        this._presence = null;
        this._slidingSync = null;
        this._rangeManager = null;
        this.roomRefreshScheduled = false;
        this.clearWarmSeed();
        this.clearProgressiveRefresh();
        this.securityRefresh.clear();
        this.ownPresenceRefresh.clear();
        this.stopOwnPresence();
        this.matrix = null;
        this.store = null;
    }

    public async logout(): Promise<void> {
        const session = this.stored;
        await this.stop();

        if (session) {
            this.forgetAccountLocalState();
            try {
                await this.login_.revoke(session);
            } catch (error) {
                // A failed revocation must not trap the user in a session they
                // asked to leave. Local state still gets cleared below.
                console.error("[tumult] token revocation failed", error);
            }
        }

        if (session) {
            // Dropping the crypto store means dropping this device's keys for
            // good; anything not in key backup is unrecoverable after this.
            //
            // This client exists only to clear storage, but it still has to be
            // given the real sync store: clearStores() wipes whatever store it
            // holds, and a default StubStore would leave the sync cache on disk
            // for the next login to pick up.
            const store = createSyncStore(session);
            const client = createClient({ baseUrl: session.homeserverUrl, store });
            try {
                await client.clearStores({ cryptoDatabasePrefix: cryptoDatabasePrefix(session) });
            } finally {
                await store.destroy();
            }
        }

        this.dropSession();
    }

    public timeline(roomId: string): Subscribable<MessageView[]> {
        const timelines = this.timelines;
        if (!timelines) throw new Error("Cannot read timeline before start()");
        return timelines.timeline(roomId);
    }

    public async loadMore(roomId: string): Promise<boolean> {
        const timelines = this.timelines;
        if (!timelines) throw new Error("Cannot paginate before start()");
        return timelines.loadMore(roomId);
    }

    public async send(roomId: string, body: string, replyToEventId?: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot send before start()");
        // Optimistic by construction: the SDK inserts a local echo (mapped to
        // `sending` by the feed) and replaces it with the server echo on ack.
        // Throws on failure; the echo flips to `failed` in-timeline.
        await sendTextMessage(client, roomId, body, replyToEventId);
    }

    /**
     * Retry a previously failed send. `roomId` and `eventId` locate the
     * pending event the SDK left in `NOT_SENT`; the SDK re-sends it (and its
     * embedded body/relation), republishing on the SENDING→SENT/failed
     * transition. Resolves once the network request settled — not on a
     * subsequent failure, which the map still surfaces.
     */
    public async retry(roomId: string, eventId: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot retry before start()");
        await retryTextMessage(client, roomId, eventId);
    }

    public async sendMediaMessage(roomId: string, file: File | Blob, body?: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot send before start()");
        await sendMediaMessage(client, roomId, file, body);
    }

    public async sendAttachments(
        roomId: string,
        attachments: readonly OutgoingAttachment[],
        options: SendAttachmentsOptions = {},
    ): Promise<AttachmentSendResult[]> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot send before start()");
        return sendAttachments(client, roomId, attachments, options, (body, replyTo) =>
            sendTextMessage(client, roomId, body, replyTo),
        );
    }

    /** Cached per MatrixClient: the limit is server config, not per-request. */
    private uploadLimitRead: { client: MatrixClient; limit: Promise<number | null> } | null = null;

    public uploadLimit(): Promise<number | null> {
        const client = this.matrix;
        if (!client) return Promise.resolve(null);
        if (this.uploadLimitRead?.client !== client) {
            this.uploadLimitRead = { client, limit: readUploadLimit(client) };
        }
        return this.uploadLimitRead.limit;
    }

    public async toggleReaction(roomId: string, targetEventId: string, emoji: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot react before start()");
        await toggleReaction(client, roomId, targetEventId, emoji);
    }

    public async edit(roomId: string, targetEventId: string, newBody: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot edit before start()");
        await sendEditMessage(client, roomId, targetEventId, newBody);
    }

    public async redact(roomId: string, eventId: string, reason?: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot redact before start()");
        await redactEvent(client, roomId, eventId, reason);
    }

    public async search(roomId: string, term: string, opts?: { nextBatch?: string }): Promise<SearchPage> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot search before start()");
        return searchRoomHistory(client, roomId, term, opts?.nextBatch);
    }

    public async jumpTo(roomId: string, eventId: string): Promise<boolean> {
        const timelines = this.timelines;
        if (!timelines) throw new Error("Cannot jump before start()");
        return timelines.jumpTo(roomId, eventId);
    }

    /**
     * Tell the client which room the user is viewing. In sliding-sync mode this
     * keeps the room subscribed with a richer timeline window, so it stays live
     * even when it sits outside the room-list range; the members feed also
     * prioritizes its members for presence. No-op in classic `/sync`.
     */
    public setRoomSelection(roomId: string | null): void {
        this._selectedRoomId = roomId;
        const sync = this._slidingSync;
        if (!sync) return;
        sync.modifyRoomSubscriptions(new Set(roomId ? [roomId] : []));
    }

    /**
     * Grow the sliding-sync room window by one page. Resolves `false` at the
     * cap, before the window is applied, or on classic `/sync` — callers must
     * not keep offering "load more" on `false`.
     */
    public async loadMoreRooms(): Promise<boolean> {
        const manager = this._rangeManager;
        if (!manager) return false;
        return manager.loadMore();
    }

    public hasMoreRooms(): boolean {
        return this._rangeManager?.hasMore() ?? false;
    }

    public async createSpace(params: CreateSpaceParams): Promise<string> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot create a space before start()");
        return createSpace(client, params);
    }

    public async createChannel(spaceId: string, params: CreateChannelParams): Promise<string> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot create a channel before start()");
        return createChannel(client, spaceId, params);
    }

    public async createDm(params: CreateDmParams): Promise<string> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot create a DM before start()");
        return createDm(client, params);
    }

    public async joinRoom(idOrAlias: string): Promise<string> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot join a room before start()");
        return joinRoom(client, idOrAlias);
    }

    public async leave(roomId: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot leave a room before start()");
        await leaveRoom(client, roomId);
    }

    public async invite(roomId: string, userId: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot invite before start()");
        await inviteToRoom(client, roomId, userId);
    }

    public async updateRoomSettings(roomId: string, patch: RoomSettingsPatch): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot update room settings before start()");
        await writeRoomSettings(client, roomId, patch);
    }

    public async searchUsers(term: string, opts?: { limit?: number }): Promise<UserSearchResult[]> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot search users before start()");
        return searchUserDirectory(client, term, opts?.limit);
    }

    public members(roomId: string): Subscribable<MemberView[]> {
        const members = this._members;
        if (!members) throw new Error("Cannot read members before start()");
        return members.members(roomId);
    }

    public async loadMembers(roomId: string): Promise<void> {
        const members = this._members;
        if (!members) throw new Error("Cannot load members before start()");
        await members.loadMembers(roomId);
    }

    public powerLevels(roomId: string): Subscribable<RoomPowerLevelsView | null> {
        const tracker = this._powerLevels;
        if (!tracker) throw new Error("Cannot read power levels before start()");
        return tracker.powerLevels(roomId);
    }

    public banned(roomId: string): Subscribable<MemberView[]> {
        const members = this._members;
        if (!members) throw new Error("Cannot read banned members before start()");
        return members.banned(roomId);
    }

    public async kick(roomId: string, userId: string, reason?: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot kick before start()");
        await kickMember(client, roomId, userId, reason);
    }

    public async ban(roomId: string, userId: string, reason?: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot ban before start()");
        await banMember(client, roomId, userId, reason);
    }

    public async unban(roomId: string, userId: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot unban before start()");
        await unbanMember(client, roomId, userId);
    }

    public async setPowerLevel(roomId: string, userId: string, powerLevel: number): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot set a power level before start()");
        await setMemberPowerLevel(client, roomId, userId, powerLevel);
    }

    public async setProfile(params: { displayName?: string; avatar?: Blob | null }): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot set profile before start()");
        try {
            await writeProfile(client, params);
        } catch (error) {
            // A half-applied change (name landed, upload failed) must show
            // what the server actually stored — refresh first, then rethrow.
            await this.refreshProfile();
            throw error;
        }
        await this.refreshProfile();
    }

    public async setOwnPresence(presence: OwnPresenceState, statusMessage?: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot set presence before start()");
        await client.setPresence(statusMessage === undefined ? { presence } : { presence, status_msg: statusMessage });
        // Remember the choice: start and the heartbeat re-assert it.
        this.storage.setItem(PRESENCE_KEY, presence);
        // The server accepted the write, so publish it immediately — the bar
        // must not sit on a stale status while a follow-up read is in flight.
        // The read then corrects anything the server normalised.
        this.ownPresenceState.set({
            presence,
            statusMessage: statusMessage !== undefined && statusMessage.trim() !== "" ? statusMessage : null,
        });
        void this.refreshOwnPresence();
    }

    public profileFieldsSupported(): Promise<boolean> {
        const client = this.matrix;
        if (!client) return Promise.resolve(false);
        this.profileFieldsSupport ??= client.doesServerSupportExtendedProfiles().catch((error: unknown) => {
            console.error("[tumult] extended profile support check failed", error);
            this.profileFieldsSupport = null; // transient — ask again next time
            return false;
        });
        return this.profileFieldsSupport;
    }

    public profileField(userId: string, key: string): Subscribable<unknown> {
        return this.profileFields.feed(userId, key);
    }

    public async setProfileField(key: string, value: unknown): Promise<void> {
        assertProfileFieldKey(key);
        const client = this.matrix;
        const userId = client?.getUserId();
        if (!client || !userId) throw new Error("Cannot set a profile field before start()");
        if (!(await this.profileFieldsSupported())) {
            throw new Error("This homeserver does not support extended profile fields (MSC4133)");
        }
        if (value === null || value === undefined) {
            await client.deleteExtendedProfileProperty(key);
            this.profileFields.publish(userId, key, null);
        } else {
            await client.setExtendedProfileProperty(key, value);
            this.profileFields.publish(userId, key, value);
        }
    }

    /**
     * One field read for the store: `undefined` when we cannot ask (no client
     * yet — the store retries on the next watch), `null` when unsupported or
     * unset (404), the raw value otherwise. Other failures throw, which the
     * store logs and leaves stale.
     */
    private async readProfileField(userId: string, key: string): Promise<unknown> {
        const client = this.matrix;
        if (!client) return undefined;
        if (!(await this.profileFieldsSupported())) return null;
        try {
            return (await client.getExtendedProfileProperty(userId, key)) ?? null;
        } catch (error) {
            if ((error as { httpStatus?: number }).httpStatus === 404) return null;
            throw error;
        }
    }

    public async sendTyping(roomId: string, isTyping: boolean): Promise<void> {
        const typing = this._typing;
        if (!typing) throw new Error("Cannot send typing before start()");
        await typing.sendTyping(roomId, isTyping);
    }

    /**
     * The media resolver is built at the end of start(), but the shell paints the
     * cached room list on the very first frame (see bootstrap's warm seed) — so the
     * rail's avatar <img>s call `resolveMedia()` *before* start() finishes. Rather
     * than throw — which the avatar's one-shot `.catch()` swallows, stranding the
     * tile on its initials until some later re-render happened to re-fire the
     * resolver — a pre-start call now awaits the in-flight start and resolves once
     * the resolver exists. `this.starting` settles to null when bootstrap ends, so
     * if start() was never called (or failed and left no resolver) the original
     * throw stands and the caller keeps its fallback.
     */
    private async waitForMedia(): Promise<MediaResolver> {
        const media = this._media;
        if (media) return media;
        const pending = this.starting;
        if (!pending) throw new Error("Cannot resolve media before start()");
        await pending;
        const ready = this._media;
        if (!ready) throw new Error("Cannot resolve media before start()");
        return ready;
    }

    public async resolveMedia(uri: string, size: number): Promise<string> {
        const media = await this.waitForMedia();
        return media.resolve(uri, size * 2);
    }

    public async resolveMediaDownload(uri: string): Promise<string> {
        const media = await this.waitForMedia();
        return media.resolveDownload(uri);
    }

    public async resolveEncryptedMedia(file: EncryptedAttachment): Promise<string> {
        const media = await this.waitForMedia();
        return media.resolveEncrypted(file);
    }

    public async requestNotificationPermission(): Promise<NotificationPermission> {
        const notifications = this._notifications;
        if (!notifications) throw new Error("Cannot request permission before start()");
        return notifications.requestPermission();
    }

    // Calls and voice live in call/rtc.ts; these stay explicit methods so tsc
    // keeps checking `implements ChatClient`.
    public supportsCalls(): boolean {
        return this.rtc.supportsCalls();
    }

    public joinCall(roomId: string, options: { video: boolean }): Promise<void> {
        return this.rtc.joinCall(roomId, options);
    }

    public leaveCall(): Promise<void> {
        return this.rtc.leaveCall();
    }

    public attachCall(frame: HTMLIFrameElement): () => void {
        return this.rtc.attachCall(frame);
    }

    public supportsVoice(): boolean {
        return this.rtc.supportsVoice();
    }

    public joinVoice(roomId: string, options: { video?: boolean } = {}): Promise<void> {
        return this.rtc.joinVoice(roomId, options);
    }

    public leaveVoice(): Promise<void> {
        return this.rtc.leaveVoice();
    }

    public setVoiceMuted(muted: boolean): Promise<void> {
        return this.rtc.setVoiceMuted(muted);
    }

    public setVoiceSettings(settings: Partial<VoiceSettings>): Promise<void> {
        return this.rtc.setVoiceSettings(settings);
    }

    public setVoiceCamera(enabled: boolean): Promise<void> {
        return this.rtc.setVoiceCamera(enabled);
    }

    public setVoiceScreenShare(enabled: boolean): Promise<void> {
        return this.rtc.setVoiceScreenShare(enabled);
    }

    public attachVoiceVideo(userId: string, deviceId: string, source: VoiceVideoSource, element: HTMLVideoElement): () => void {
        return this.rtc.attachVoiceVideo(userId, deviceId, source, element);
    }

    public setVoiceDeafened(deafened: boolean): void {
        this.rtc.setVoiceDeafened(deafened);
    }

    public setVoiceUserVolume(userId: string, volume: number): void {
        this.rtc.setVoiceUserVolume(userId, volume);
    }

    public supportsThreads(): boolean {
        return this._threads?.supported() ?? false;
    }

    public threads(roomId: string): Subscribable<ThreadSummary[]> {
        const threads = this._threads;
        if (!threads) throw new Error("Cannot read threads before start()");
        return threads.threads(roomId);
    }

    public threadTimeline(threadId: string): Subscribable<MessageView[]> {
        const threads = this._threads;
        if (!threads) throw new Error("Cannot read threads before start()");
        return threads.threadTimeline(threadId);
    }

    public async sendReply(roomId: string, threadId: string, body: string): Promise<void> {
        const threads = this._threads;
        if (!threads) throw new Error("Cannot reply before start()");
        await threads.sendReply(roomId, threadId, body);
    }

    public async markThreadRead(threadId: string): Promise<void> {
        const threads = this._threads;
        if (!threads) throw new Error("Cannot mark thread read before start()");
        await threads.markThreadRead(threadId);
    }

    public async setRoomPinned(roomId: string, pinned: boolean): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot pin a room before start()");
        if (pinned) await client.setRoomTag(roomId, "m.favourite", {});
        else await client.deleteRoomTag(roomId, "m.favourite");
        this.scheduleRefreshRooms();
    }

    public async setRoomMuted(roomId: string, muted: boolean): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot mute a room before start()");
        if (muted) {
            await client.addPushRule("global", PushRuleKind.RoomSpecific, roomId, { actions: [] });
        } else if (client.getRoomPushRule("global", roomId)) {
            await client.deletePushRule("global", PushRuleKind.RoomSpecific, roomId);
        }
        this.scheduleRefreshRooms();
    }

    public async markRead(roomId: string): Promise<void> {
        const timelines = this.timelines;
        if (!timelines) throw new Error("Cannot mark read before start()");
        await timelines.markRead(roomId);
    }

    public async setupRecovery(): Promise<string> {
        const crypto = this.requireCrypto();

        // Identity first, as Element does: bootstrapSecretStorage stores the
        // cross-signing keys this device holds, so they must exist by then or
        // the recovery key can never verify another device. Only when the
        // ACCOUNT has none — an account with an identity this device cannot
        // use must be verified (emoji / recovery key), never silently rotated,
        // which would cut off every other device. The first upload needs no
        // interactive auth (MSC3967); a server that demands it fails loudly.
        // Without this, an account set up in Tumult had no identity at all
        // ("Couldn't sign … MissingSigningKey"), found by the e2ee browser test.
        if (!(await crypto.userHasCrossSigningKeys(undefined, true))) {
            await crypto.bootstrapCrossSigning({
                authUploadDeviceSigningKeys: async (makeRequest) => {
                    await makeRequest(null);
                },
            });
        }

        // Raw random key, not passphrase-derived: MAS accounts may have no
        // password, so password-based 4S is not a safe assumption.
        let encoded: string | undefined;
        try {
            await crypto.bootstrapSecretStorage({
                createSecretStorageKey: async () => {
                    const generated = await crypto.createRecoveryKeyFromPassphrase();
                    encoded = generated.encodedPrivateKey;
                    // The SDK asks getSecretStorageKey for this very key moments
                    // later, to store the backup and cross-signing keys under it.
                    // Without it held, the callback answered null and setup died
                    // AFTER creating the server backup: a backup nobody had the
                    // key to, and no recovery key ever shown.
                    this.heldSecretKey = generated.privateKey;
                    return generated;
                },
                setupNewKeyBackup: true,
            });
        } finally {
            this.heldSecretKey = null;
        }
        await this.refreshSecurity();
        // Empty when secret storage already existed: the account keeps its
        // old key and there is nothing new to save. Never null — callers
        // distinguish "show this once" from "already set up".
        return encoded ?? "";
    }

    public async restoreBackup(recoveryKey: string): Promise<boolean> {
        const crypto = this.requireCrypto();
        let decoded: Uint8Array<ArrayBuffer>;
        try {
            decoded = decodeRecoveryKey(recoveryKey.trim());
        } catch {
            throw new Error("That recovery key doesn't look valid. Check for typos and try again.");
        }
        // The pasted key must stay stashed for BOTH halves: the backup unlock
        // (loadSessionBackupPrivateKeyFromSecretStorage) and the verification
        // half (bootstrapCrossSigning reads cross-signing keys from 4S).
        // Both go through getSecretStorageKey → serveHeldKey. Cleared in the
        // finally below — never retained past this call.
        this.heldSecretKey = decoded;
        try {
            // Primary path: the pasted key opens secret storage (this is what
            // setupRecovery() shows). The backup key comes from 4S, never from
            // the pasted bytes directly — the two keys are different.
            let unlocked = false;
            try {
                await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
                unlocked = true;
            } catch {
                unlocked = false;
            }
            if (!unlocked) {
                // Fallback: the pasted key IS the backup decryption key
                // (backups made outside Tumult never entered secret storage).
                const check = await crypto.checkKeyBackupAndEnable().catch(() => null);
                if (!check) {
                    throw new Error(
                        "Couldn't unlock secret storage with that key, and this account " +
                            "has no key backup to try it against directly.",
                    );
                }
                try {
                    await crypto.storeSessionBackupPrivateKey(decoded, check.backupInfo.version);
                } catch {
                    throw new Error("That recovery key doesn't match this account's backup.");
                }
            }
            try {
                await crypto.restoreKeyBackup();
            } catch (cause) {
                console.error("[tumult] key backup restore failed", cause);
                throw new Error(restoreFailureMessage(cause), { cause });
            }
            // Verification half: the same pasted key unlocks 4S, which also
            // holds the cross-signing private keys. Importing them and
            // self-signing this device is what flips "Unverified" → verified
            // in other clients' session lists. Only when 4S has keys the
            // device lacks — otherwise bootstrapCrossSigning would rotate
            // the identity, which we never do here.
            let verified = false;
            try {
                const status = await crypto.getCrossSigningStatus();
                if (shouldVerifyDevice(status)) {
                    await crypto.bootstrapCrossSigning({});
                    verified = true;
                }
            } catch (cause) {
                // Verification is best-effort: the backup already restored, and
                // the device can still be verified later via SAS.
                console.error("[tumult] cross-signing import failed", cause);
            }
            await this.refreshSecurity();
            // Newly arrived keys upgrade `pending` timelines in place.
            this.timelines?.rebuildAll();
            return verified;
        } finally {
            this.heldSecretKey = null;
        }
    }

    public async startVerification(): Promise<void> {
        const verification = this._verification;
        if (!verification) throw new Error("Verification isn't ready yet; wait for sync to start.");
        await verification.startVerification();
    }

    public async acceptVerification(id: string): Promise<void> {
        const verification = this._verification;
        if (!verification) throw new Error("Verification isn't ready yet; wait for sync to start.");
        await verification.acceptVerification(id);
    }

    public async declineVerification(id: string): Promise<void> {
        const verification = this._verification;
        if (!verification) throw new Error("Verification isn't ready yet; wait for sync to start.");
        await verification.declineVerification(id);
    }

    public async confirmSas(id: string): Promise<void> {
        const verification = this._verification;
        if (!verification) throw new Error("Verification isn't ready yet; wait for sync to start.");
        await verification.confirmSas(id);
    }

    public async mismatchSas(id: string): Promise<void> {
        const verification = this._verification;
        if (!verification) throw new Error("Verification isn't ready yet; wait for sync to start.");
        await verification.mismatchSas(id);
    }

    public async listDevices(): Promise<DeviceView[]> {
        const client = this.matrix;
        const session = this.stored;
        if (!client || !session) throw new Error("Cannot list devices before start()");
        const { devices } = await client.getDevices();
        const crypto = client.getCrypto();
        const out: DeviceView[] = [];
        for (const d of devices) {
            let verified = false;
            if (crypto) {
                try {
                    verified = (await crypto.getDeviceVerificationStatus(session.userId, d.device_id))?.isVerified() ?? false;
                } catch {
                    verified = false;
                }
            }
            out.push({
                id: d.device_id,
                displayName: d.display_name ?? null,
                lastSeenTs: d.last_seen_ts ?? null,
                isCurrent: d.device_id === session.deviceId,
                verified,
            });
        }
        out.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.id.localeCompare(b.id));
        return out;
    }

    /**
     * Drop to a clean logged-out state after the server invalidated us.
     *
     * Deliberately does not clear the crypto store: the token is already dead,
     * so there is nothing to revoke, and wiping device keys is destructive
     * enough that it should stay an explicit user action. The cost is an
     * orphaned crypto database, since the next login mints a new device ID.
     */
    private async handleSessionLoggedOut(): Promise<void> {
        await this.stop();
        this.forgetAccountLocalState();
        this.dropSession();
    }

    /**
     * Remove this account's local, non-secret state: the sliding-sync window,
     * the chosen presence and the shell cache. The shell cache is
     * account-scoped; dropping it with the session means a stale room list
     * never bleeds into (or paints first for) the next login. Shared by
     * logout() and handleSessionLoggedOut().
     */
    private forgetAccountLocalState(): void {
        this.storage.removeItem(SSS_WINDOW_KEY);
        this.storage.removeItem(PRESENCE_KEY);
        clearShellSnapshot(this.storage);
    }

    /** Forget the session and empty every account-scoped feed. */
    private dropSession(): void {
        this.storage.clearSession();
        this.stored = null;
        this.sessionState.set(null);
        this.profileState.set(null);
        this.ownPresenceState.set(null);
        this.roomsState.set([]);
    }

    /**
     * Coalesce a room-list refresh onto the next microtask. Sync, receipt, and
     * unread-count changes all funnel here: a single sync batch can carry many
     * receipts, and each used to run a full `snapshotRooms` pass.
     */
    private scheduleRefreshRooms(): void {
        if (this.roomRefreshScheduled) return;
        this.roomRefreshScheduled = true;
        queueMicrotask(() => {
            this.roomRefreshScheduled = false;
            // A pending progressive refresh would do the same pass; drop it so
            // a Sync/receipt burst never costs two snapshots.
            this.clearProgressiveRefresh();
            this.refreshRooms();
        });
    }

    /**
     * Throttled variant of {@link scheduleRefreshRooms}, used for the first-sync
     * room flood. At most one recompute per {@link PROGRESSIVE_REFRESH_MS} while
     * rooms stream in, so the list grows smoothly instead of re-rendering once
     * per room. A later `scheduleRefreshRooms` (the terminal Sync) still runs
     * immediately; the timer is cleared on teardown.
     */
    private scheduleProgressiveRefreshRooms(): void {
        this.progressiveRefresh.schedule();
    }

    /** Drop any pending progressive refresh (stop/teardown). */
    private clearProgressiveRefresh(): void {
        this.progressiveRefresh.clear();
    }

    /**
     * Drop the warm seed. Either the first full batch has arrived (the sync
     * listener clears it, from which point the live list is authoritative) or
     * the client is tearing down (stop / logout / logged-out — a stale seed
     * must never linger into the next boot's first paint).
     */
    private clearWarmSeed(): void {
        this._warmSeed = null;
    }

    /**
     * Recompute the room list from the SDK and publish it. Never throws:
     * a snapshot failure must not take down the sync listener.
     *
     * While a warm seed is held (boot, before the first full batch), the fresh
     * snapshot is overlaid onto it: a partial resync can't drop the count, and
     * seed-only rooms survive until the first full batch supersedes the seed.
     * `sameRoomSummaries` then skips a republish when the merged list is byte
     * for byte what the UI already shows.
     */
    private refreshRooms(): void {
        const client = this.matrix;
        if (!client) return;
        try {
            // Sliding sync sends no unread counts (Synapse hardcodes them to 0),
            // so in that mode the tracker recomputes them here, before the
            // snapshot reads them. Classic /sync supplies exact server counts
            // and highlights, so there is no tracker to run.
            this._unread?.update();
            const next = snapshotRooms(
                client,
                this._unread ? (roomId) => this._unread!.getUnread(roomId) : undefined,
            );
            const published = this._warmSeed ? mergeRoomSummaries(this._warmSeed, next) : next;
            if (sameRoomSummaries(published, this.roomsState.get())) return;
            const spaces = published.filter((r) => r.isSpace).length;
            console.debug(`[tumult] rooms snapshot: ${published.length} joined (${spaces} spaces)`);
            this.roomsState.set(published);
            // The published list is what first-paint will use; queue its cache
            // write (debounced, structure-gated below) so the next boot paints it.
            this.shellPersist.schedule();
        } catch (error) {
            console.error("[tumult] room snapshot failed", error);
        }
    }

    /**
     * Persist the published room list so the next boot can paint it before the
     * first network batch (see the seed at the top of `bootstrap`).
     * Structure-gated: a count-only change re-publishes the list but moves no
     * room's identity, so it is not worth a synchronous localStorage write.
     * Best-effort: a full store makes `writeShellSnapshot` return false and the
     * list still renders.
     */
    private flushShellCache(): void {
        const account = this.stored;
        if (!account) return; // logged out / pre-session: nothing to cache
        const rooms = this.roomsState.get();
        const signature = shellSignature(rooms);
        if (signature === this.lastShellSignature) return;
        this.lastShellSignature = signature;
        writeShellSnapshot(this.storage, { userId: account.userId, homeserverUrl: account.homeserverUrl }, rooms, this._selectedRoomId);
    }

    /**
     * Dev diagnostics: the raw read-position state behind each joined room's
     * unread badge, so a wrong count can be explained instead of guessed at.
     * Not part of the ChatClient contract — reachable through the concrete
     * client, exposed by the web dev handle as `__tumult.client.debugUnread()`.
     *
     * Pass `true` to force a recompute first: if the numbers flip to the
     * correct value, the cache was stale (an invalidation-signal bug); if they
     * stay wrong, the recompute itself is wrong.
     */
    public debugUnread(recompute = false): Array<Record<string, unknown>> {
        const client = this.matrix;
        if (!client) return [];
        if (recompute) this._unread?.update();
        return client
            .getRooms()
            .filter((room) => room.getMyMembership() === "join")
            .map((room) => ({
                name: room.name,
                roomId: room.roomId,
                sdkUnread: room.getUnreadNotificationCount(),
                threadUnread: room.hasThreadUnreadNotification(),
                ...(this._unread
                    ? this._unread.describe(room)
                    : {
                        total: room.getUnreadNotificationCount(),
                        highlight: room.getUnreadNotificationCount(NotificationCountType.Highlight),
                        markerId: null,
                        receiptIds: [],
                        readIndex: -1,
                        window: room.getLiveTimeline().getEvents().length,
                        tailId: null,
                    }),
            }));
    }

    private adoptSession(session: StoredSession): void {
        this.stored = session;
        this.sessionState.set({
            userId: session.userId,
            deviceId: session.deviceId,
            homeserverUrl: session.homeserverUrl,
        });
    }

    private persistTokens(accessToken: string, refreshToken?: string): void {
        if (!this.stored) return;
        this.stored = {
            ...this.stored,
            accessToken,
            ...(refreshToken ? { refreshToken } : {}),
        };
        this.storage.saveSession(this.stored);
    }

    /**
     * Recompute the security snapshot. Never throws: crypto queries must not
     * take down event listeners.
     */
    private async refreshSecurity(): Promise<void> {
        const crypto = this.matrix?.getCrypto();
        if (!crypto) return;
        try {
            this.securityState.set(await querySecurityStatus(crypto));
        } catch (error) {
            console.error("[tumult] security snapshot failed", error);
        }
    }

    /**
     * Publish our profile. Never throws: an offline start still gets a
     * readable fallback (the mxid localpart), which is just restating the id
     * we already show — not a name the server ever claimed.
     */
    private async refreshProfile(): Promise<void> {
        const client = this.matrix;
        const userId = client?.getUserId();
        if (!client || !userId) return;
        try {
            this.profileState.set(await readProfile(client));
        } catch {
            this.profileState.set({ userId, displayName: fallbackName(userId), avatarUrl: null });
        }
    }

    /**
     * Publish our own presence + status message. Never throws: presence can be
     * disabled on the homeserver, and a failed read is not evidence the status
     * was cleared — the last snapshot stays.
     */
    private async refreshOwnPresence(): Promise<void> {
        const client = this.matrix;
        if (!client) return;
        try {
            this.ownPresenceState.set(await readOwnPresence(client));
        } catch (error) {
            console.error("[tumult] own presence snapshot failed", error);
        }
    }

    /**
     * Read our presence and, when the server disagrees with what the user
     * chose, write the choice back (keeping the current status message).
     * Publishes whichever the server ends up holding. Never throws: a server
     * with presence disabled keeps the last snapshot, as in refreshOwnPresence.
     */
    private async announcePresence(): Promise<void> {
        const client = this.matrix;
        if (!client) return;
        try {
            const current = await readOwnPresence(client);
            const desired = this.storage.getItem<OwnPresenceState>(PRESENCE_KEY) ?? "online";
            if (current.presence !== desired && this.matrix === client) {
                await client.setPresence(
                    current.statusMessage === null
                        ? { presence: desired }
                        : { presence: desired, status_msg: current.statusMessage },
                );
                current.presence = desired;
            }
            if (this.matrix === client) this.ownPresenceState.set(current);
        } catch (error) {
            console.error("[tumult] own presence announce failed", error);
        }
    }

    private stopOwnPresence(): void {
        if (this.ownPresenceHeartbeat !== null) clearInterval(this.ownPresenceHeartbeat);
        this.ownPresenceHeartbeat = null;
        this.selfPresenceSubscription?.unsubscribe();
        this.selfPresenceSubscription = null;
    }

    /** Persist/restore the sliding-sync room-window upper bound across reloads. */
    private sssWindowStore(): SssWindowStore {
        return {
            loadEnd: () => this.storage.getItem<number>(SSS_WINDOW_KEY),
            saveEnd: (end) => this.storage.setItem(SSS_WINDOW_KEY, end),
        };
    }

    /**
     * The members of the room currently on screen — presence's high-priority
     * set, polled every tick. Empty when no room is selected or it is not
     * loaded yet.
     */
    private priorityPresenceIds(): string[] {
        const client = this.matrix;
        const roomId = this._selectedRoomId;
        if (!client || !roomId) return [];
        const room = client.getRoom(roomId);
        if (!room) return [];
        const ids: string[] = [];
        for (const member of room.getMembers()) {
            if (member.membership === "join" || member.membership === "invite") ids.push(member.userId);
        }
        return ids;
    }

    private requireCrypto(): CryptoApi {
        const crypto = this.matrix?.getCrypto();
        if (!crypto) throw new Error("Encryption isn't ready yet; wait for sync to start.");
        return crypto;
    }

    /** Publish the manager's current snapshot into the verification feed. */
    private publishVerification(): void {
        this.verificationState.set(this._verification?.state ?? { requests: [] });
    }

    /** Publish the tracker's current snapshot into the typing feed. */
    private publishTyping(): void {
        this.typingState.set(this._typing?.snapshot ?? { rooms: {} });
    }

    /** Publish the tracker's current snapshot into the notifications feed. */
    private publishNotifications(): void {
        this.notificationsState.set(this._notifications?.snapshot ?? { permission: "default", supported: false });
    }
}

export function createChatClient(options: ChatClientOptions): ChatClient {
    return new MatrixChatClient(options);
}
