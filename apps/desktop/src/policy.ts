/**
 * Navigation and permission policy, as pure decisions (`test/policy.test.ts`).
 * `main.ts` only wires these to Electron's events.
 */
import { APP_HOST, APP_ORIGIN, APP_SCHEME } from "./protocol.ts";

function parse(url: string): URL | null {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

/** Whether `url` is on the app's own origin, `app://tumult`. */
export function isAppUrl(url: string): boolean {
    const parsed = parse(url);
    return parsed !== null && parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
}

/**
 * The URL to hand the OS browser, or null. Only http(s): `file:`, `javascript:`,
 * custom schemes (which can launch arbitrary local handlers) and the app's own
 * scheme never leave through `shell.openExternal`.
 */
export function externalUrl(url: string): string | null {
    const parsed = parse(url);
    if (!parsed) return null;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username !== "" || parsed.password !== "") return null;
    return parsed.href;
}

/** The origin of `url`, or null (opaque origins included). */
export function originOf(url: string | undefined | null): string | null {
    if (!url) return null;
    const parsed = parse(url);
    if (!parsed) return null;
    // URL.origin is "null" for non-special schemes in Node; build app:// by hand.
    if (parsed.protocol === `${APP_SCHEME}:`) return `${APP_SCHEME}://${parsed.host}`;
    return parsed.origin === "null" ? null : parsed.origin;
}

/**
 * What the app's own origin may be granted. Everything else is denied.
 *
 * - `media`: microphone/camera (voice, video, Element Call).
 * - `display-capture`: screen share (paired with the display-media handler).
 * - `notifications`.
 * - `clipboard-sanitized-write`: the "Copy link"/"Copy user id" items and the
 *   recovery key's Copy button call `navigator.clipboard.writeText`, which
 *   Chromium gates on this. Write only — `clipboard-read` stays denied.
 */
export const APP_PERMISSIONS: ReadonlySet<string> = new Set(["media", "display-capture", "notifications", "clipboard-sanitized-write"]);

/** What the embedded call app (Element Call's frame) may be granted, when one is configured. */
export const CALL_PERMISSIONS: ReadonlySet<string> = new Set(["media", "display-capture"]);

export interface PermissionQuery {
    permission: string;
    /** The origin asking: a frame's origin for an iframe. */
    requestingOrigin: string | null;
    /** The origin of the top-level document it is embedded in. */
    topOrigin: string | null;
    /** The configured Element Call origin, or null when calls are off. */
    callOrigin: string | null;
}

/**
 * Grant only what the list allows, and only inside the app: the top-level
 * document must be `app://tumult` (so the auth window's IdP pages get nothing),
 * and the asker must be the app itself or the configured call frame.
 */
export function permissionAllowed(query: PermissionQuery): boolean {
    if (query.topOrigin !== APP_ORIGIN) return false;
    if (query.requestingOrigin === APP_ORIGIN) return APP_PERMISSIONS.has(query.permission);
    if (query.callOrigin !== null && query.requestingOrigin === query.callOrigin) return CALL_PERMISSIONS.has(query.permission);
    return false;
}

/** The configured Element Call origin from its URL (the same rule as the web build's CSP), or null. */
export function callOriginFrom(url: string | undefined): string | null {
    return /^https?:\/\/[^/?#]+/.exec(url ?? "")?.[0] ?? null;
}

/**
 * The origin that is really asking for a permission. Electron's
 * `requestingUrl` is the frame's URL, NOT its security origin: the plugin
 * sandbox frame lives at app://tumult/sandbox.html but runs with an OPAQUE
 * origin (sandbox="allow-scripts", no allow-same-origin), so trusting the URL
 * would treat plugin code as the app. Prefer the security origin when Electron
 * gives one, and never let the sandbox page count as the app — so the
 * allow-list holds by itself, not only because Chromium also refuses.
 */
export function askingOrigin(details: { securityOrigin?: string | undefined; requestingOrigin?: string | undefined; requestingUrl?: string | undefined }): string | null {
    if (details.requestingUrl && isSandboxFrameUrl(details.requestingUrl)) return null;
    if (details.securityOrigin !== undefined) return originOf(details.securityOrigin);
    return originOf(details.requestingOrigin) ?? originOf(details.requestingUrl);
}

/** The plugin sandbox page or its script, served on the app's host but opaque at runtime. */
export function isSandboxFrameUrl(url: string): boolean {
    const parsed = parse(url);
    return (
        parsed !== null &&
        parsed.protocol === `${APP_SCHEME}:` &&
        parsed.host === APP_HOST &&
        (parsed.pathname === "/sandbox.html" || parsed.pathname === "/sandbox.js")
    );
}

/**
 * Whether the app window is where a login starts (its /login route), so an
 * authorization request may open the sign-in window. Anywhere else, a URL
 * that merely LOOKS like an authorization request must not get a chromeless
 * window that could pass for the real sign-in.
 */
export function loginPending(currentUrl: string): boolean {
    const parsed = parse(currentUrl);
    return parsed !== null && isAppUrl(currentUrl) && (parsed.pathname === "/login" || parsed.pathname.startsWith("/login/"));
}
