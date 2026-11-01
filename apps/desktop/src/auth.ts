/**
 * The MAS login leg, as pure URL decisions (`test/auth.test.ts`).
 *
 * The web app's `login()` navigates the window to the IdP's authorization URL;
 * MAS later redirects to `DESKTOP_REDIRECT_URI`, a loopback address nothing
 * listens on. The main process recognises both ends:
 *
 * - {@link isAuthorizationRequest}: the navigation OUT, which it moves into a
 *   separate auth window instead of letting the app window leave `app://`.
 * - {@link callbackTarget}: the redirect BACK, which it cancels before it
 *   reaches the network and replaces with the app's own callback route, so
 *   `CallbackView` → `completeLogin()` runs unchanged with the code and state.
 */
import { DESKTOP_CALLBACK_PATH, DESKTOP_ORIGIN, DESKTOP_REDIRECT_URI } from "../../web/src/desktop.ts";

export { DESKTOP_REDIRECT_URI };

function parse(url: string): URL | null {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

export function isLoopbackHost(hostname: string): boolean {
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Whether `url` is an OAuth authorization request for THIS app: response_type
 * `code` and our loopback `redirect_uri`. https for a real IdP; plain http only
 * on loopback (a homeserver in Docker on this machine), matching what the core
 * accepts. Anything else leaving `app://` is not login and is not let in.
 */
export function isAuthorizationRequest(url: string, redirectUri: string = DESKTOP_REDIRECT_URI): boolean {
    const parsed = parse(url);
    if (!parsed) return false;
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))) return false;
    return parsed.searchParams.get("response_type") === "code" && parsed.searchParams.get("redirect_uri") === redirectUri;
}

/**
 * If `url` is the redirect back to our loopback redirect URI (same scheme, host,
 * port and path; any query or fragment), the `app://` URL to load instead —
 * carrying the query and fragment verbatim, since MAS answers in the fragment
 * (`response_mode=fragment`) and an error may come back in the query. Otherwise
 * null.
 */
export function callbackTarget(url: string, redirectUri: string = DESKTOP_REDIRECT_URI): string | null {
    const parsed = parse(url);
    const expected = parse(redirectUri);
    if (!parsed || !expected) return null;
    if (parsed.origin !== expected.origin || parsed.pathname !== expected.pathname) return null;
    if (parsed.username !== "" || parsed.password !== "") return null;
    return `${DESKTOP_ORIGIN}${DESKTOP_CALLBACK_PATH}${parsed.search}${parsed.hash}`;
}
