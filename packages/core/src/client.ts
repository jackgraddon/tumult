import {
    ClientEvent,
    PushRuleKind,
    createClient,
    EventType,
    HttpApiEvent,
    IndexedDBStore,
    SyncState,
    type MatrixClient,
    type MatrixEvent,
    type SyncStateData,
} from "matrix-js-sdk";

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
import { CryptoController } from "./crypto/controller.ts";
import { resendAfterOutage, sendTextMessage, retryTextMessage } from "./rooms/send.ts";
import { readUploadLimit, sendAttachments, sendMediaMessage } from "./rooms/media.ts";
import { sendEditMessage } from "./rooms/edits.ts";
import { redactEvent } from "./rooms/redact.ts";
import { searchRoomHistory } from "./rooms/search.ts";
import { toggleReaction } from "./rooms/reactions.ts";
import { OwnPresenceController } from "./rooms/own-presence-controller.ts";
import { ProfileController } from "./rooms/profile-controller.ts";
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
import { RoomListPublisher } from "./rooms/room-list.ts";
import { onDecryptedRebuild, TimelineFeed } from "./timeline/feed.ts";
import { VerificationManager } from "./verification/manager.ts";
import { OAuthLogin, type AuthNavigator, type ClientMetadata } from "./auth/oauth.ts";
import { AuthStorage, type StoredSession } from "./auth/storage.ts";
import { toConnectionState, watchNetwork } from "./sync/connection.ts";
import { buildSlidingSync, detectSlidingSync, type ActiveSyncMode, type SlidingSync, type SlidingSyncRangeManager, type SssWindowStore, type SyncModeOption } from "./sync/sliding.ts";
import { RtcFeature } from "./call/rtc.ts";
import type { ClientContext } from "./client-context.ts";
import { clearShellSnapshot } from "./shellCache.ts";

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

export class MatrixChatClient implements ChatClient {
    private readonly storage: AuthStorage;
    private readonly login_: OAuthLogin;
    private readonly syncModeOption: SyncModeOption;
    /**
     * Lazy, read-at-call-time view of this client for the feature modules
     * (client-context.ts). Built in the constructor body, before them.
     */
    private readonly ctx: ClientContext;
    /** Calls + voice: their feeds, managers and voice settings (call/rtc.ts). */
    private readonly rtc: RtcFeature;
    /** Own profile + MSC4133 fields (rooms/profile-controller.ts). */
    private readonly profileCtl: ProfileController;
    /** Own presence/status + its heartbeat (rooms/own-presence-controller.ts). */
    private readonly ownPresenceCtl: OwnPresenceController;
    /** Security feed, recovery setup/restore, devices (crypto/controller.ts). */
    private readonly cryptoCtl: CryptoController;
    /** The published room list, its warm seed and shell cache (rooms/room-list.ts). */
    private readonly roomList: RoomListPublisher;
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
    /** Presence REST poller (sliding sync only — no presence extension). */
    private _presence: PresencePoller | null = null;
    /** Simplified Sliding Sync instance (sliding mode only). */
    private _slidingSync: SlidingSync | null = null;
    /** Sliding-sync room-window owner (sliding mode only). */
    private _rangeManager: SlidingSyncRangeManager | null = null;
    /** The room the UI is showing, fed by `setRoomSelection`. */
    private _selectedRoomId: string | null = null;

    private readonly sessionState = new Observable<SessionView | null>(null);
    private readonly connectionState = new Observable<ConnectionState>("stopped");
    private readonly verificationState = new Observable<VerificationState>({ requests: [] });
    private readonly typingState = new Observable<TypingState>({ rooms: {} });
    private readonly notificationsState = new Observable<NotificationState>({
        permission: "default",
        supported: typeof Notification !== "undefined",
    });
    /** Removes the browser online/offline listeners (watchNetwork). */
    private unwatchNetwork: (() => void) | null = null;
    /** Mirrors `ownPresence` into the rosters, so our row matches the bar. */
    private selfPresenceSubscription: Subscription | null = null;

    public constructor(options: ChatClientOptions) {
        this.storage = options.storage ?? AuthStorage.browser();
        this.login_ = new OAuthLogin(this.storage, options.clientMetadata, options.navigator);
        this.syncModeOption = options.syncMode ?? "auto";
        // Closures, not values: features read the client, session and
        // selection live, so a stop/start swap is always seen.
        this.ctx = {
            storage: this.storage,
            matrix: () => this.matrix,
            session: () => this.stored,
            selectedRoomId: () => this._selectedRoomId,
        };
        this.rtc = new RtcFeature({
            storage: this.storage,
            elementCallUrl: options.elementCallUrl || null,
            createE2EEWorker: options.createE2EEWorker ?? null,
        });
        this.profileCtl = new ProfileController(this.ctx);
        this.ownPresenceCtl = new OwnPresenceController(this.ctx);
        this.cryptoCtl = new CryptoController(this.ctx, { rebuildTimelines: () => this.timelines?.rebuildAll() });
        this.roomList = new RoomListPublisher(this.ctx);
    }

    public get session(): Subscribable<SessionView | null> {
        return this.sessionState;
    }

    public get connection(): Subscribable<ConnectionState> {
        return this.connectionState;
    }

    public get rooms(): Subscribable<RoomSummary[]> {
        return this.roomList.feed;
    }

    public get security(): Subscribable<SecurityStatus> {
        return this.cryptoCtl.feed;
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
        return this.profileCtl.feed;
    }

    public get ownPresence(): Subscribable<OwnPresenceView | null> {
        return this.ownPresenceCtl.feed;
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
        const resumeRoomId = this.roomList.seed(session);
        if (this._selectedRoomId === null) this._selectedRoomId = resumeRoomId;

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
                // `getSecretStorageKey` serves the recovery key the crypto
                // controller holds during setupRecovery() / restoreBackup()
                // (crypto/controller.ts). Read at CALL time, never captured:
                // outside those calls it returns null (fresh setup has nothing
                // cached yet, and we never retain keys).
                cryptoCallbacks: {
                    getSecretStorageKey: ({ keys }) => Promise.resolve(this.cryptoCtl.serveSecretStorageKey(keys)),
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
                // The first usable batch supersedes the warm seed (dropped on
                // the first "syncing"), then the room list — a snapshot over
                // the sync loop — recomputes wholesale (rooms/room-list.ts).
                //
                // Timelines self-drive off the same loop inside TimelineFeed.
                this.roomList.onSync(next);
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
                this.roomList.scheduleProgressive();
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
                if (event.getType() === EventType.Receipt) this.roomList.schedule();
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
            this._members.setSelfPresence(this.ownPresenceCtl.feed.get()?.presence ?? "unknown");
            this.selfPresenceSubscription = this.ownPresenceCtl.feed.subscribe((own) =>
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
                this.roomList.attachUnread(client);
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
            // failure publishes the localpart fallback (profile-controller.ts).
            void this.profileCtl.refresh();
            // Own presence/status is another independent HTTP read: read it
            // now, re-assert the user's choice, keep it honest on a heartbeat
            // (registers its UserEvent.Presence listener here, as before).
            this.ownPresenceCtl.start(client);
            this._media = new MediaResolver(client);
            this._notifications = new NotificationTracker(client);
            this._notifications.subscribe(() => this.publishNotifications());
            this.publishNotifications();
            // Key backup state can move at any time; the crypto controller
            // registers its coalesced CryptoEvent listeners here, as before.
            this.cryptoCtl.watch(client);
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
            await this.cryptoCtl.refresh();
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
        this.roomList.flush();
        this.roomList.clearPersist();

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
        this.profileCtl.resetForStop();
        this.connectionState.set("stopped");
        this.cryptoCtl.resetForStop();
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
        this.roomList.detach();
        // stop() already detached the poller before stopClient(); detachAll is
        // idempotent, so the second call here is a no-op on that path.
        this._presence?.detachAll();
        this._presence = null;
        this._slidingSync = null;
        this._rangeManager = null;
        this.cryptoCtl.clearTimers();
        this.ownPresenceCtl.stop();
        this.selfPresenceSubscription?.unsubscribe();
        this.selfPresenceSubscription = null;
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

    public setProfile(params: { displayName?: string; avatar?: Blob | null }): Promise<void> {
        return this.profileCtl.set(params);
    }

    public setOwnPresence(presence: OwnPresenceState, statusMessage?: string): Promise<void> {
        return this.ownPresenceCtl.set(presence, statusMessage);
    }

    public profileFieldsSupported(): Promise<boolean> {
        return this.profileCtl.fieldsSupported();
    }

    public profileField(userId: string, key: string): Subscribable<unknown> {
        return this.profileCtl.field(userId, key);
    }

    public setProfileField(key: string, value: unknown): Promise<void> {
        return this.profileCtl.setField(key, value);
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
        this.roomList.schedule();
    }

    public async setRoomMuted(roomId: string, muted: boolean): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot mute a room before start()");
        if (muted) {
            await client.addPushRule("global", PushRuleKind.RoomSpecific, roomId, { actions: [] });
        } else if (client.getRoomPushRule("global", roomId)) {
            await client.deletePushRule("global", PushRuleKind.RoomSpecific, roomId);
        }
        this.roomList.schedule();
    }

    public async markRead(roomId: string): Promise<void> {
        const timelines = this.timelines;
        if (!timelines) throw new Error("Cannot mark read before start()");
        await timelines.markRead(roomId);
    }

    public setupRecovery(): Promise<string> {
        return this.cryptoCtl.setupRecovery();
    }

    public restoreBackup(recoveryKey: string): Promise<boolean> {
        return this.cryptoCtl.restoreBackup(recoveryKey);
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

    public listDevices(): Promise<DeviceView[]> {
        return this.cryptoCtl.listDevices();
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
        this.ownPresenceCtl.forget();
        clearShellSnapshot(this.storage);
    }

    /** Forget the session and empty every account-scoped feed. */
    private dropSession(): void {
        this.storage.clearSession();
        this.stored = null;
        this.sessionState.set(null);
        this.profileCtl.feed.set(null);
        this.ownPresenceCtl.feed.set(null);
        this.roomList.feed.set([]);
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
        return this.roomList.debugUnread(recompute);
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
