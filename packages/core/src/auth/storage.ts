/**
 * Persisted auth state.
 *
 * Two things live here and they have very different lifetimes:
 *
 * - the *session*, which must survive reloads for the life of the login, and
 *   whose `deviceId` must never change (the crypto identity is bound to it);
 * - the *pending login*, which exists only between the redirect out to the IdP
 *   and the redirect back, and is deleted the moment it is consumed.
 *
 * The registered OAuth client ID is cached per homeserver so we don't
 * dynamically re-register on every login attempt.
 */

const SESSION_KEY = "tumult.session";
const PENDING_PREFIX = "tumult.pending.";
const CLIENT_ID_PREFIX = "tumult.clientId.";

export interface StoredSession {
    homeserverUrl: string;
    userId: string;
    deviceId: string;
    /** OAuth client ID from dynamic registration. Needed to refresh and revoke. */
    clientId: string;
    accessToken: string;
    refreshToken?: string;
}

export interface PendingLogin {
    homeserverUrl: string;
    clientId: string;
    deviceId: string;
    codeVerifier: string;
    redirectUri: string;
}

/**
 * Storage backing auth state. Defaults to `localStorage` in the browser; the
 * desktop shell will swap in something the OS protects.
 */
export interface AuthStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export class AuthStorage {
    public constructor(private readonly store: AuthStore) {}

    public static browser(): AuthStorage {
        if (typeof localStorage === "undefined") {
            throw new Error("No localStorage available; pass an explicit AuthStore");
        }
        return new AuthStorage(localStorage);
    }

    public loadSession(): StoredSession | null {
        return this.read<StoredSession>(SESSION_KEY);
    }

    public saveSession(session: StoredSession): void {
        this.store.setItem(SESSION_KEY, JSON.stringify(session));
    }

    public getItem<T>(key: string): T | null {
        return this.read<T>(key);
    }

    public setItem<T>(key: string, value: T): void {
        this.store.setItem(key, JSON.stringify(value));
    }

    /**
     * Keyed by the OAuth `state` parameter, so two login attempts in two tabs
     * can't clobber each other's PKCE verifier.
     */
    public savePendingLogin(state: string, pending: PendingLogin): void {
        this.store.setItem(PENDING_PREFIX + state, JSON.stringify(pending));
    }

    /** Reads and deletes in one step — a pending login is single-use. */
    public takePendingLogin(state: string): PendingLogin | null {
        const key = PENDING_PREFIX + state;
        const pending = this.read<PendingLogin>(key);
        this.store.removeItem(key);
        return pending;
    }

    /**
     * Registered client IDs are cached per homeserver *and* per client
     * metadata. The metadata is part of the key because a client registered
     * with one redirect URI is useless under another — switching between a
     * local dev origin and a deployed one has to re-register, not silently
     * reuse a client the IdP will reject.
     */
    public loadClientId(homeserverUrl: string, metadataFingerprint: string): string | null {
        return this.store.getItem(`${CLIENT_ID_PREFIX}${metadataFingerprint}.${homeserverUrl}`);
    }

    public saveClientId(homeserverUrl: string, metadataFingerprint: string, clientId: string): void {
        this.store.setItem(`${CLIENT_ID_PREFIX}${metadataFingerprint}.${homeserverUrl}`, clientId);
    }

    private read<T>(key: string): T | null {
        const raw = this.store.getItem(key);
        if (raw === null) return null;
        try {
            return JSON.parse(raw) as T;
        } catch {
            // Corrupt entry is the same as no entry, but don't leave it to rot.
            this.store.removeItem(key);
            return null;
        }
    }
}
