import { createClient, OAuth2, type ValidatedAuthMetadata } from "matrix-js-sdk";

import { AuthStorage, type PendingLogin, type StoredSession } from "./storage.ts";

/**
 * MAS-native OAuth 2.0 login (MSC3861 + MSC2966 dynamic registration +
 * MSC4254 revocation). This is the only login method Tumult supports.
 *
 * The flow, in order:
 *   discover auth metadata -> register client -> build PKCE authorize URL ->
 *   redirect out -> redirect back -> exchange code -> persist session.
 */

/** Metadata the IdP shows the user on the consent screen. */
export interface ClientMetadata {
    clientName: string;
    /**
     * Must be a public https URL. MAS rejects http, and rejects `localhost`
     * under either scheme — so this cannot simply be the dev server's origin.
     * Point it at a real https URL you control; it identifies the application,
     * not the instance the user happens to be running.
     */
    clientUri: string;
    /**
     * Where the IdP sends the user back.
     *
     * MAS ties the permitted shape to {@link applicationType}: `web` requires
     * https, while `native` also accepts loopback (`http://localhost:...`) and
     * custom schemes. A localhost dev server therefore has to register as
     * `native` even though it runs in a browser.
     */
    redirectUri: string;
    applicationType: "web" | "native";
}

/**
 * Catch the metadata combinations MAS refuses, before we ask it.
 *
 * Worth doing because the SDK discards the IdP's error body and throws a bare
 * "Dynamic registration failed", which says nothing about which field was
 * wrong. These checks reproduce MAS's rules so the failure names the problem.
 */
function validateClientMetadata(metadata: ClientMetadata): void {
    let clientUri: URL;
    try {
        clientUri = new URL(metadata.clientUri);
    } catch {
        throw new Error(`Invalid clientUri ${JSON.stringify(metadata.clientUri)}: not a URL`);
    }

    if (clientUri.protocol !== "https:") {
        throw new Error(
            `clientUri must use https, got ${JSON.stringify(metadata.clientUri)}. ` +
                "It identifies the application, not the running instance, so point it at a public https URL you control.",
        );
    }

    if (isLoopbackHost(clientUri.hostname)) {
        throw new Error(
            `clientUri must not be a loopback address, got ${JSON.stringify(metadata.clientUri)}. ` +
                "Set it to a public https URL you control; the redirect URI is what points at your dev server.",
        );
    }

    let redirectUri: URL;
    try {
        redirectUri = new URL(metadata.redirectUri);
    } catch {
        throw new Error(`Invalid redirectUri ${JSON.stringify(metadata.redirectUri)}: not a URL`);
    }

    if (metadata.applicationType === "web" && redirectUri.protocol !== "https:") {
        const hint = isLoopbackHost(redirectUri.hostname)
            ? ' Use applicationType "native" to register a loopback redirect.'
            : "";
        throw new Error(
            `A "web" client needs an https redirectUri, got ${JSON.stringify(metadata.redirectUri)}.${hint}`,
        );
    }
}

function isLoopbackHost(hostname: string): boolean {
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export interface AuthNavigator {
    redirect(url: string): void;
}

const browserNavigator: AuthNavigator = {
    redirect: (url) => {
        window.location.assign(url);
    },
};

/**
 * Discovery needs a MatrixClient, but not an authenticated one — `/auth_metadata`
 * is unauthenticated. This throwaway client exists only to make that one call.
 */
async function discoverAuthMetadata(homeserverUrl: string): Promise<ValidatedAuthMetadata> {
    const probe = createClient({ baseUrl: homeserverUrl });
    return probe.getAuthMetadata();
}

/**
 * A device ID is minted once and then reused forever. It is encoded into the
 * OAuth scope and the crypto identity hangs off it, so regenerating one means
 * silently becoming a new device and losing the old device's keys.
 */
function mintDeviceId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomState(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class OAuthLogin {
    public constructor(
        private readonly storage: AuthStorage,
        private readonly metadata: ClientMetadata,
        private readonly navigator: AuthNavigator = browserNavigator,
    ) {
        // Fail at construction rather than midway through a login attempt.
        validateClientMetadata(metadata);
    }

    /**
     * Start login. In a browser this navigates away and never returns, so
     * anything the callback needs must already be persisted before we redirect.
     */
    public async begin(homeserverUrl: string): Promise<void> {
        const normalized = normalizeHomeserverUrl(homeserverUrl);
        const authMetadata = await discoverAuthMetadata(normalized);
        const clientId = await this.resolveClientId(normalized, authMetadata);

        // A fresh device per login: this is a new device in Matrix's eyes, and
        // restoring an existing session goes through restoreSession(), not here.
        const auth = new OAuth2(authMetadata, { clientId, deviceId: mintDeviceId() });
        const state = randomState();

        const pending: PendingLogin = {
            homeserverUrl: normalized,
            clientId,
            deviceId: auth.context.deviceId,
            codeVerifier: auth.context.codeVerifier,
            redirectUri: this.metadata.redirectUri,
        };
        this.storage.savePendingLogin(state, pending);

        // `fragment` keeps the authorization code out of the query string, so it
        // never reaches server logs or Referer headers.
        const url = await auth.generateAuthorizationCodeGrantUrl(state, this.metadata.redirectUri, "fragment");

        this.navigator.redirect(url);
    }

    /**
     * Complete login from the URL the IdP redirected back to.
     *
     * Re-discovers auth metadata rather than persisting it: it is a cheap
     * unauthenticated call and stale endpoints are a nasty failure mode.
     */
    public async complete(callbackUrl: string): Promise<StoredSession> {
        const params = extractCallbackParams(callbackUrl);

        if (params.error) {
            throw new Error(`Authorization failed: ${params.error}${params.errorDescription ? ` — ${params.errorDescription}` : ""}`);
        }
        if (!params.state) throw new Error("Authorization response has no state");
        if (!params.code) throw new Error("Authorization response has no code");

        const pending = this.storage.takePendingLogin(params.state);
        if (!pending) {
            // Either a replayed callback or a login begun in a different browser
            // profile. Both mean we have no PKCE verifier, so we cannot proceed.
            throw new Error("No pending login for this state; start the login again");
        }

        const authMetadata = await discoverAuthMetadata(pending.homeserverUrl);
        const auth = new OAuth2(authMetadata, {
            clientId: pending.clientId,
            deviceId: pending.deviceId,
            codeVerifier: pending.codeVerifier,
        });

        const tokens = await auth.completeAuthorizationCodeGrant(params.code, pending.redirectUri);

        // The homeserver is the authority on who we actually are; don't infer
        // the user ID from anything in the token response.
        const probe = createClient({
            baseUrl: pending.homeserverUrl,
            accessToken: tokens.access_token,
        });
        const { user_id: userId } = await probe.whoami();

        const session: StoredSession = {
            homeserverUrl: pending.homeserverUrl,
            userId,
            deviceId: pending.deviceId,
            clientId: pending.clientId,
            accessToken: tokens.access_token,
            ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        };
        this.storage.saveSession(session);
        return session;
    }

    /**
     * Revoke tokens at the IdP. Best-effort: a failure here must not strand the
     * user in a half-logged-out state, so the caller clears local state anyway.
     */
    public async revoke(session: StoredSession): Promise<void> {
        const authMetadata = await discoverAuthMetadata(session.homeserverUrl);
        const auth = new OAuth2(authMetadata, {
            clientId: session.clientId,
            deviceId: session.deviceId,
        });

        if (session.refreshToken) {
            await auth.revokeToken(session.refreshToken, "refresh_token");
        }
        await auth.revokeToken(session.accessToken, "access_token");
    }

    /**
     * Dynamic client registration is per homeserver and the result is stable, so
     * cache it. Re-registering on every attempt would spam the IdP's client list.
     */
    private async resolveClientId(homeserverUrl: string, authMetadata: ValidatedAuthMetadata): Promise<string> {
        const fingerprint = this.metadataFingerprint();
        const cached = this.storage.loadClientId(homeserverUrl, fingerprint);
        if (cached) return cached;

        const clientId = await OAuth2.registerClient(authMetadata, {
            client_name: this.metadata.clientName,
            client_uri: this.metadata.clientUri,
            application_type: this.metadata.applicationType,
            redirect_uris: [this.metadata.redirectUri],
        });

        this.storage.saveClientId(homeserverUrl, fingerprint, clientId);
        return clientId;
    }

    /**
     * Short stable digest of the metadata a registration is bound to. Only has
     * to change when the metadata changes, so a cheap non-cryptographic hash is
     * enough — nothing security-sensitive depends on it.
     */
    private metadataFingerprint(): string {
        const input = [this.metadata.clientUri, this.metadata.redirectUri, this.metadata.applicationType].join("|");
        let hash = 5381;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
        }
        return (hash >>> 0).toString(36);
    }
}

interface CallbackParams {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
}

/**
 * We ask for `response_mode=fragment`, but read the query string too: an IdP
 * may fall back to query on an error response.
 */
export function extractCallbackParams(callbackUrl: string): CallbackParams {
    const url = new URL(callbackUrl);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const pick = (key: string): string | null => fragment.get(key) ?? url.searchParams.get(key);

    const params: CallbackParams = {};
    const code = pick("code");
    if (code !== null) params.code = code;
    const state = pick("state");
    if (state !== null) params.state = state;
    const error = pick("error");
    if (error !== null) params.error = error;
    const errorDescription = pick("error_description");
    if (errorDescription !== null) params.errorDescription = errorDescription;
    return params;
}

/** Accepts `example.com` as well as a full URL, and drops any trailing slash. */
export function normalizeHomeserverUrl(input: string): string {
    const trimmed = input.trim();
    if (trimmed === "") throw new Error("Homeserver URL is required");

    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    return url.origin;
}
