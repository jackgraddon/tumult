import { AuthStorage } from "./storage.ts";

/**
 * Whether a persisted session exists — without loading the Matrix client.
 *
 * Restoring a session needs nothing from matrix-js-sdk: `loadSession()` is a
 * localStorage read. The router guard runs before any route component, so
 * answering it from here keeps the entry chunk free of the SDK and lets the
 * shell paint while the SDK chunk is still in flight; AppView then performs
 * the real `restoreSession()`/`start()`.
 *
 * This module MUST stay free of any matrix-js-sdk import, or the SDK it is
 * meant to defer comes back with it. Reach it through the `@tumult/core/session`
 * subpath, not the package barrel.
 */
export function hasStoredSession(): boolean {
    try {
        return AuthStorage.browser().loadSession() !== null;
    } catch {
        // No localStorage (or an unavailable store): treat as signed out.
        return false;
    }
}
