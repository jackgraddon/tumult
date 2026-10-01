import {
    ClientEvent,
    createClient,
    IndexedDBStore,
    SyncState,
    type MatrixClient,
    type SyncStateData,
} from "matrix-js-sdk";

import type {
    ChatClient,
    CompleteLoginParams,
    ConnectionState,
    LoginParams,
    MessageView,
    RoomSummary,
    SessionView,
    Subscribable,
} from "./contract.ts";
import { Observable } from "./observable.ts";
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

function notImplemented(slice: string): never {
    throw new Error(`Not implemented yet — lands in the "${slice}" slice`);
}

export class MatrixChatClient implements ChatClient {
    private readonly storage: AuthStorage;
    private readonly login_: OAuthLogin;

    private matrix: MatrixClient | null = null;
    private stored: StoredSession | null = null;

    private readonly sessionState = new Observable<SessionView | null>(null);
    private readonly connectionState = new Observable<ConnectionState>("stopped");
    private readonly roomsState = new Observable<RoomSummary[]>([]);

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

        const session = this.stored;
        this.connectionState.set("starting");

        const store = createSyncStore(session);

        const client = createClient({
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
        });

        this.matrix = client;
        await client.startClient();
    }

    public async stop(): Promise<void> {
        const client = this.matrix;
        if (!client) return;

        client.stopClient();
        await client.store.save(true);
        this.matrix = null;
        this.connectionState.set("stopped");
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

    public timeline(_roomId: string): Subscribable<MessageView[]> {
        return notImplemented("timeline read + history pagination");
    }

    public async send(_roomId: string, _body: string): Promise<void> {
        return notImplemented("send with local echo");
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
}

export function createChatClient(options: ChatClientOptions): ChatClient {
    return new MatrixChatClient(options);
}
