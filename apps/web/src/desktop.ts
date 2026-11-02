/**
 * The contract between this web app and the desktop shell (`apps/desktop`).
 *
 * Pure constants, no DOM and no Vue: the Electron main process bundles this
 * file too, so the two sides cannot disagree about where the app lives or where
 * the identity provider sends the user back.
 */

/**
 * The origin the desktop shell serves this app's production build from — a
 * privileged custom scheme registered by the main process. Never `file://`.
 */
export const DESKTOP_ORIGIN = "app://tumult";

/**
 * The app's own OAuth callback route (`router.ts`'s `callback`). The desktop
 * shell loads `${DESKTOP_ORIGIN}${DESKTOP_CALLBACK_PATH}` with the code and
 * state it intercepted, so `CallbackView`/`completeLogin()` run unchanged.
 */
export const DESKTOP_CALLBACK_PATH = "/auth/callback";

/**
 * The redirect URI the desktop registers with MAS.
 *
 * `app://tumult/…` cannot be one: MAS accepts a custom scheme only as the
 * reverse-DNS of `client_uri`, and a loopback http URI only for
 * `application_type: "native"` (AGENTS.md, VERIFIED against mas.jackg.cc). So
 * the desktop registers as `native` with a loopback URI, and the main process
 * intercepts the navigation to it BEFORE it reaches the network — nothing ever
 * listens on this address. Distinct from the web dev server's
 * `http://localhost:5173/auth/callback`, so the per-metadata client-id cache
 * gives the desktop a registration of its own.
 */
export const DESKTOP_REDIRECT_URI = "http://127.0.0.1/auth/callback";

/**
 * The IPC channel the main process uses to relay a native `SET_ACTIVITY` /
 * `CLEAR` down to a window's preload, which surfaces it as `window.tumultNative`
 * (the one declared native bridge). Both the main process (`main.ts`) and the
 * preload (`preload.ts`) read it here, so the two sides cannot disagree on the
 * channel name — the same reason this file holds `DESKTOP_REDIRECT_URI`: they
 * are the only two places that cross the main/preload boundary.
 */
export const NATIVE_ACTIVITY_IPC = "tumult-native-activity";
