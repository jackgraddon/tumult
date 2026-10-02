import {
    ClientEvent,
    createClient,
    HttpApiEvent,
    IndexedDBStore,
    SyncState,
    type MatrixClient,
    type SyncStateData,
} from "matrix-js-sdk";
import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";

import type {
    ChatClient,
    CompleteLoginParams,
    ConnectionState,
    DeviceView,
    LoginParams,
    MessageView,
    RoomSummary,
    SecurityStatus,
    SessionView,
    Subscribable,
    ThreadSummary,
    TypingState,
    VerificationState,
} from "./contract.ts";
import { Observable } from "./observable.ts";
import { querySecurityStatus } from "./crypto/security.ts";
import { restoreFailureMessage, serveHeldKey, shouldVerifyDevice } from "./crypto/restore.ts";
import { sameRoomSummaries, snapshotRooms } from "./rooms/snapshot.ts";
import { sendTextMessage } from "./rooms/send.ts";
import { sendEditMessage } from "./rooms/edits.ts";
import { toggleReaction } from "./rooms/reactions.ts";
import { TypingTracker } from "./typing/tracker.ts";
import { ThreadTracker } from "./threads/tracker.ts";
import { onDecryptedRebuild, TimelineFeed } from "./timeline/feed.ts";
import { VerificationManager } from "./verification/manager.ts";
import { OAuthLogin, type AuthNavigator, type ClientMetadata } from "./auth/oauth.ts";
import { AuthStorage, type StoredSession } from "./auth/storage.ts";

export interface ChatClientOptions {
    /** Identity this app presents to the IdP during dynamic registration. */
    clientMetadata: ClientMetadata;
    storage?: AuthStorage;
    /** Overridable so tests can assert on the redirect instead of navigating. */
    navigator?: AuthNavigator;
}

/**
 * Map the SDK's sync lifecycle onto the coarser state the UI cares about.
 *
 * `Prepared` and `Catchup` both mean "we have a usable timeline" as far as the
 * UI is concerned, so both collapse to `syncing`. `Prepared` can be served
 * entirely from the IndexedDB cache, which is exactly why the listener has to
 * be attached before `startClient()` — otherwise a warm start emits it before
 * anyone is listening and the UI hangs on `starting` forever.
 */
function toConnectionState(state: SyncState | null): ConnectionState {
    switch (state) {
        case SyncState.Prepared:
        case SyncState.Syncing:
        case SyncState.Catchup:
            return "syncing";
        case SyncState.Reconnecting:
            return "reconnecting";
        case SyncState.Error:
            return "error";
        case SyncState.Stopped:
            return "stopped";
        default:
            return "starting";
    }
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

export class MatrixChatClient implements ChatClient {
    private readonly storage: AuthStorage;
    private readonly login_: OAuthLogin;

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
    /**
     * Pasted recovery key, held ONLY for the duration of a restoreBackup()
     * call so the SDK's secret-storage requests can use it. Cleared in a
     * `finally` — never retained, never persisted.
     */
    private heldSecretKey: Uint8Array<ArrayBuffer> | null = null;

    private readonly sessionState = new Observable<SessionView | null>(null);
    private readonly connectionState = new Observable<ConnectionState>("stopped");
    private readonly roomsState = new Observable<RoomSummary[]>([]);
    private readonly securityState = new Observable<SecurityStatus>({
        crossSigningReady: false,
        backupEnabled: false,
        backupTrusted: false,
        secretStorageReady: false,
    });
    private readonly verificationState = new Observable<VerificationState>({ requests: [] });
    private readonly typingState = new Observable<TypingState>({ rooms: {} });

    public constructor(options: ChatClientOptions) {
        this.storage = options.storage ?? AuthStorage.browser();
        this.login_ = new OAuthLogin(this.storage, options.clientMetadata, options.navigator);
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
                this.connectionState.set(toConnectionState(state));
                if (state === SyncState.Error && data?.error) {
                    console.error("[tumult] sync error", data.error);
                }
                // The room list is a snapshot over the sync loop: every batch
                // can join/leave/rename rooms, change hierarchy, or move unread
                // counts (receipts ride the same loop). Recompute wholesale —
                // the Sync event is the one invalidation signal that covers all
                // of them without per-room listener bookkeeping.
                //
                // Timelines self-drive off the same loop inside TimelineFeed.
                this.refreshRooms();
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
            this.publishTyping();
            this._threads = new ThreadTracker(client);
            // Key backup state can move at any time (another device rotates
            // keys, a backup completes). These three cover it; the snapshot
            // recomputes wholesale on each.
            for (const event of [
                CryptoEvent.KeyBackupStatus,
                CryptoEvent.KeysChanged,
                CryptoEvent.DevicesUpdated,
            ]) {
                client.on(event, () => {
                    void this.refreshSecurity();
                });
            }
            // Thread support is OFF by default — without it the SDK treats
            // thread replies as main-timeline events and never creates Thread
            // objects. It is a START option (IStartClientOpts): `supportsThreads()`
            // reads the opts startClient() stores. Passed to createClient it is
            // silently ignored — that cast-hidden mistake left threads dead.
            await client.startClient({ threadSupport: true });
            // Enabling is silent and best-effort: a backup failure must never
            // break login. Runs inside the snapshot query below.
            await this.refreshSecurity();
        } catch (error) {
            // Leave nothing half-built. A failed start that leaves a client or an
            // open store behind means the next attempt builds a second client on
            // the same IndexedDB, which corrupts the crypto store.
            client?.stopClient();
            await store.destroy().catch(() => undefined);
            this.matrix = null;
            this.store = null;
            this.timelines = null;
            this.removeDecryptedHook = null;
            this.connectionState.set("error");
            throw error;
        }
    }

    public async stop(): Promise<void> {
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

        this.timelines?.detachAll();
        this.timelines = null;
        this._verification?.detachAll();
        this._verification = null;
        this._typing?.detachAll();
        this._typing = null;
        this._threads?.detachAll();
        this._threads = null;
        this.publishTyping();
        this.removeDecryptedHook?.();
        this.removeDecryptedHook = null;
        this.matrix = null;
        this.store = null;
        this.connectionState.set("stopped");
        this.securityState.set({
            crossSigningReady: false,
            backupEnabled: false,
            backupTrusted: false,
            secretStorageReady: false,
        });
    }

    public async logout(): Promise<void> {
        const session = this.stored;
        await this.stop();

        if (session) {
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

        this.storage.clearSession();
        this.stored = null;
        this.sessionState.set(null);
        this.roomsState.set([]);
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

    public async send(roomId: string, body: string): Promise<void> {
        const client = this.matrix;
        if (!client) throw new Error("Cannot send before start()");
        // Optimistic by construction: the SDK inserts a local echo (mapped to
        // `sending` by the feed) and replaces it with the server echo on ack.
        // Throws on failure; the echo flips to `failed` in-timeline.
        await sendTextMessage(client, roomId, body);
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

    public async sendTyping(roomId: string, isTyping: boolean): Promise<void> {
        const typing = this._typing;
        if (!typing) throw new Error("Cannot send typing before start()");
        await typing.sendTyping(roomId, isTyping);
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

    public async markRead(roomId: string): Promise<void> {
        const timelines = this.timelines;
        if (!timelines) throw new Error("Cannot mark read before start()");
        await timelines.markRead(roomId);
    }

    public async setupRecovery(): Promise<string> {
        const crypto = this.requireCrypto();
        // Raw random key, not passphrase-derived: MAS accounts may have no
        // password, so password-based 4S is not a safe assumption.
        let encoded: string | undefined;
        await crypto.bootstrapSecretStorage({
            createSecretStorageKey: async () => {
                const generated = await crypto.createRecoveryKeyFromPassphrase();
                encoded = generated.encodedPrivateKey;
                return generated;
            },
            setupNewKeyBackup: true,
        });
        await this.refreshSecurity();
        // Empty when secret storage already existed: the account keeps its
        // old key and there is nothing new to save. Never null — callers
        // distinguish "show this once" from "already set up".
        return encoded ?? "";
    }

    public async restoreBackup(recoveryKey: string): Promise<boolean> {        const crypto = this.requireCrypto();
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
                throw new Error(restoreFailureMessage(cause));
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
        this.storage.clearSession();
        this.stored = null;
        this.sessionState.set(null);
        this.roomsState.set([]);
    }

    /**
     * Recompute the room list from the SDK and publish it. Never throws:
     * a snapshot failure must not take down the sync listener.
     */
    private refreshRooms(): void {
        const client = this.matrix;
        if (!client) return;
        try {
            const next = snapshotRooms(client);
            if (sameRoomSummaries(next, this.roomsState.get())) return;
            const spaces = next.filter((r) => r.isSpace).length;
            console.debug(`[tumult] rooms snapshot: ${next.length} joined (${spaces} spaces)`);
            this.roomsState.set(next);
        } catch (error) {
            console.error("[tumult] room snapshot failed", error);
        }
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
}

export function createChatClient(options: ChatClientOptions): ChatClient {
    return new MatrixChatClient(options);
}
