/**
 * Tumult desktop — the Electron main process.
 *
 * A shell, not a second app: it serves `apps/web`'s production build from the
 * privileged scheme `app://tumult/` (never `file://`), and owns what a browser
 * would otherwise own — navigation, permissions, the screen picker and the MAS
 * login redirect.
 *
 * It also runs the one native bridge the shell breaks its bridge-less stance for:
 * a loopback RPC a native app (`src/native-activity.ts`) connects to, relayed to
 * each window's `contextBridge` preload (`src/preload.ts`) as `window.tumultNative`.
 * The page itself gets no Node and no arbitrary bridge — only that one declared
 * value through `contextBridge` — so the app is still the web app by default. The
 * pure policy lives in `protocol.ts`, `auth.ts`, `policy.ts` and `native-activity.ts`
 * (all unit tested); this file wires them to Electron.
 */
import { stat, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { app, BrowserWindow, desktopCapturer, net, protocol, screen, session, shell } from "electron";
import type { Session, WebContents } from "electron";

import { callbackTarget, DESKTOP_REDIRECT_URI, isAuthorizationRequest } from "./auth.ts";
import { pluginAssetResponse } from "./plugin-asset.ts";
import { askingOrigin, callOriginFrom, externalUrl, isAppUrl, loginPending, originOf, permissionAllowed } from "./policy.ts";
import { NATIVE_ACTIVITY_IPC, resolveNativeActivityPort, startNativeActivityServer, type NativeActivity, type NativeActivityServer } from "./native-activity.ts";
import { APP_ORIGIN, APP_SCHEME, contentTypeFor, requestPath, route } from "./protocol.ts";

/** Defined by `scripts/build.ts` from the same env the web build reads. */
declare const __TUMULT_ELEMENT_CALL_URL__: string;

const CALL_ORIGIN = callOriginFrom(__TUMULT_ELEMENT_CALL_URL__);
const DEV = !app.isPackaged;

// ── Before ready ──────────────────────────────────────────────────────────────

// `standard` gives the scheme real origins (so localStorage, IndexedDB and CSP
// 'self' work per origin), `secure` makes it a secure context (WebCrypto,
// getUserMedia), `supportFetchAPI`/`corsEnabled` let the page fetch its own
// assets and `/api/plugin-asset`, `stream` lets media range-request, and
// `codeCache` keeps V8's compiled-code cache for it. Must run before `ready`.
protocol.registerSchemesAsPrivileged([
    {
        scheme: APP_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
    },
]);

if (process.platform === "linux") {
    // Native Wayland when the session is Wayland, X11 otherwise. Recent
    // Electron defaults to this already; stating it keeps older launchers and
    // `.desktop` files that pass nothing behaving the same.
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

// Dev-only overrides, for the smoke test and local runs. Ignored once packaged,
// so a packaged app always serves its own bundled `web/` and its own profile.
if (DEV) {
    const userData = process.env.TUMULT_USER_DATA_DIR;
    // A dev build must not share a real install's profile (its IndexedDB holds
    // that install's device keys, and one MatrixClient per IndexedDB is a rule).
    app.setPath("userData", userData ? resolve(userData) : join(app.getPath("appData"), "Tumult (dev)"));
}
const WEB_ROOT = resolve(DEV && process.env.TUMULT_WEB_ROOT ? process.env.TUMULT_WEB_ROOT : join(app.getAppPath(), "web"));

// One app instance per profile. Two would mean two MatrixClients on one
// IndexedDB — the SDK's documented store corruption. The second launch focuses
// the first window instead.
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

if (process.platform === "win32") app.setAppUserModelId("io.github.jackgraddon.tumult");

// ── The app:// protocol ───────────────────────────────────────────────────────

async function isFile(file: string): Promise<boolean> {
    try {
        return (await stat(file)).isFile();
    } catch {
        return false;
    }
}

/** Resolve a root-relative path to a file inside WEB_ROOT, or null if it escapes. */
function inRoot(file: string): string | null {
    const full = resolve(WEB_ROOT, file);
    return full.startsWith(WEB_ROOT + sep) ? full : null;
}

async function handleApp(request: Request): Promise<Response> {
    // Existence is checked up front (async) so `route` can stay pure and sync.
    const path = requestPath(new URL(request.url));
    const candidates = new Set<string>(["index.html"]);
    if (path && path !== "/") candidates.add(path.slice(1));
    const present = new Set<string>();
    await Promise.all(
        [...candidates].map(async (file) => {
            const full = inRoot(file);
            if (full && (await isFile(full))) present.add(file);
        }),
    );

    const decision = route(request.url, (file) => present.has(file));
    if (decision.kind === "plugin-asset") {
        // `net.fetch` is looked up per call (Chromium's network stack: the
        // system proxy applies), not captured.
        // `credentials: "omit"`: the default session is shared with the sign-in
        // window, and a GitHub cookie from an upstream login must not ride along
        // (the Vercel function this mirrors never has user cookies).
        const fetchUpstream = (input: string, init?: RequestInit) => net.fetch(input, { ...init, credentials: "omit" });
        return pluginAssetResponse(request.method, decision.query, fetchUpstream, decision.headers);
    }
    if (decision.kind === "not-found") {
        return new Response("Not found", { status: 404, headers: { ...decision.headers, "Content-Type": "text/plain; charset=utf-8" } });
    }
    const full = inRoot(decision.file);
    if (!full) return new Response("Not found", { status: 404 });
    const body = await readFile(full);
    return new Response(new Uint8Array(body), {
        status: 200,
        headers: { ...decision.headers, "Content-Type": contentTypeFor(decision.file), "Content-Length": String(body.length) },
    });
}

// ── Permissions, screen share, navigation ────────────────────────────────────

function harden(ses: Session): void {
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
        const allowed = permissionAllowed({
            permission,
            requestingOrigin: askingOrigin({
                securityOrigin: "securityOrigin" in details ? (details as { securityOrigin?: string }).securityOrigin : undefined,
                requestingUrl: details.requestingUrl,
            }),
            topOrigin: originOf(contents.getURL()),
            callOrigin: CALL_ORIGIN,
        });
        if (!allowed) console.warn(`[tumult] denied permission ${permission} for ${details.requestingUrl ?? "unknown frame"}`);
        callback(allowed);
    });
    ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
        permissionAllowed({
            permission,
            requestingOrigin: askingOrigin({
                securityOrigin: details.securityOrigin,
                requestingOrigin,
                requestingUrl: details.requestingUrl,
            }),
            topOrigin: contents ? originOf(contents.getURL()) : originOf(details.embeddingOrigin),
            callOrigin: CALL_ORIGIN,
        }),
    );

    // getDisplayMedia: Electron has no picker of its own. Share the primary
    // screen (on Wayland the PipeWire portal shows the system's own chooser and
    // the source list is what the user picked there). System audio is a
    // Windows-only Chromium capability ("loopback"); elsewhere video only.
    ses.setDisplayMediaRequestHandler((request, callback) => {
        const origin = originOf(request.securityOrigin);
        const topOrigin = originOf(request.frame?.top?.url);
        const allowed = permissionAllowed({ permission: "display-capture", requestingOrigin: origin, topOrigin, callOrigin: CALL_ORIGIN });
        if (!allowed) {
            callback(null);
            return;
        }
        desktopCapturer.getSources({ types: ["screen"] }).then(
            (sources) => {
                const primary = String(screen.getPrimaryDisplay().id);
                const source = sources.find((candidate) => candidate.display_id === primary) ?? sources[0];
                if (!source) {
                    callback(null);
                    return;
                }
                callback(request.audioRequested && process.platform === "win32" ? { video: source, audio: "loopback" } : { video: source });
            },
            (error: unknown) => {
                console.error("[tumult] screen capture sources unavailable", error);
                callback(null);
            },
        );
    });

    // Backstop for the login redirect: the navigation handlers below cancel it
    // first, so this should never fire — but if anything else ever requests the
    // loopback redirect URI, it is cancelled here rather than sent to whatever
    // happens to listen on this machine's port.
    const redirect = new URL(DESKTOP_REDIRECT_URI);
    ses.webRequest.onBeforeRequest({ urls: [`${redirect.protocol}//${redirect.hostname}/*`] }, (details, callback) => {
        callback({ cancel: callbackTarget(details.url) !== null });
    });
}

/** Open `url` in the OS browser if it is http(s); anything else is dropped. */
function openExternally(url: string): void {
    const target = externalUrl(url);
    if (target) void shell.openExternal(target);
    else console.warn(`[tumult] blocked navigation to ${url}`);
}

/** Shared by every window: no new windows, no <webview>, external links out. */
function lockDown(contents: WebContents): void {
    contents.setWindowOpenHandler(({ url }) => {
        openExternally(url);
        return { action: "deny" };
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
}

const WEB_PREFERENCES = {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    // Packaged builds ship no DevTools; dev keeps them.
    devTools: DEV,
} as const;

/**
 * The one native bridge the shell breaks its bridge-less stance for. The main
 * window's preload surfaces the native activity feed as `window.tumultNative`
 * (`NativeActivityFeed`, via `plugins/native-activity.ts`); it lives in `dist/`
 * next to `main.cjs`, and the auth window gets none of it.
 */
const PRELOAD = join(__dirname, "preload.cjs");

// The loopback RPC a native app on this machine connects to. It starts in
// `whenReady` and closes on `will-quit`; `currentNative` is the last value the
// feed held, seeded into every window when it loads so a late subscriber sees it.
let nativeServer: NativeActivityServer | null = null;
let currentNative: NativeActivity | null = null;

/** A native SET/CLEAR: remember it and push it to every window's bridge. */
function broadcastNative(activity: NativeActivity | null): void {
    currentNative = activity;
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(NATIVE_ACTIVITY_IPC, activity);
}

/** Seed a freshly loaded window with the last native activity, if any. */
function seedNative(window: BrowserWindow): void {
    window.webContents.on("did-finish-load", () => window.webContents.send(NATIVE_ACTIVITY_IPC, currentNative));
}

let mainWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null;

/**
 * The MAS authorization flow, in a child window so the app window never leaves
 * `app://tumult`. The child may browse http(s) (the IdP, and any upstream
 * provider it federates to) and nothing else; it has no permissions (its top
 * origin is never the app's). The redirect back to the loopback URI is caught
 * on `will-redirect`/`will-navigate` — before the request is made — and becomes
 * the app's own callback route in the main window. Closing the child without
 * finishing returns the app to its login page.
 */
function openAuthWindow(url: string): void {
    if (!mainWindow) return;
    if (authWindow) {
        void authWindow.loadURL(url);
        authWindow.focus();
        return;
    }
    let finished = false;
    const child = new BrowserWindow({
        parent: mainWindow,
        modal: process.platform !== "darwin",
        width: 520,
        height: 720,
        title: "Sign in — Tumult",
        autoHideMenuBar: true,
        webPreferences: { ...WEB_PREFERENCES },
    });
    authWindow = child;

    const intercept = (event: Electron.Event, target: string) => {
        const callback = callbackTarget(target);
        if (callback) {
            event.preventDefault();
            finished = true;
            void mainWindow?.loadURL(callback);
            child.close();
            return;
        }
        if (!externalUrl(target)) event.preventDefault();
    };
    child.webContents.on("will-navigate", (event) => intercept(event, event.url));
    child.webContents.on("will-redirect", (event) => intercept(event, event.url));
    child.webContents.on("will-frame-navigate", (event) => {
        if (!event.isMainFrame && callbackTarget(event.url)) event.preventDefault();
    });

    child.on("closed", () => {
        authWindow = null;
        if (!finished) void mainWindow?.loadURL(`${APP_ORIGIN}/login`);
    });
    void child.loadURL(url);
}

function createMainWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 360,
        minHeight: 480,
        title: "Tumult",
        show: false,
        autoHideMenuBar: true,
        // Matches the built-in theme's dark surface closely enough to avoid a
        // white flash before the first paint; the page's theme takes over.
        backgroundColor: "#16181c",
        icon: join(__dirname, "icon.png"),
        webPreferences: { ...WEB_PREFERENCES, preload: PRELOAD },
    });

    // The app window stays on app://tumult. A login navigation goes to the
    // auth window; a stray redirect to the callback is honoured; any other
    // http(s) link opens in the browser; everything else is dropped.
    const guard = (event: Electron.Event, target: string) => {
        if (isAppUrl(target)) return;
        event.preventDefault();
        const callback = callbackTarget(target);
        if (callback) {
            void window.loadURL(callback);
            return;
        }
        if (isAuthorizationRequest(target) && loginPending(window.webContents.getURL())) {
            openAuthWindow(target);
            return;
        }
        openExternally(target);
    };
    window.webContents.on("will-navigate", (event) => guard(event, event.url));
    window.webContents.on("will-redirect", (event) => guard(event, event.url));

    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
        if (mainWindow === window) mainWindow = null;
    });
    seedNative(window);
    void window.loadURL(`${APP_ORIGIN}/`);
    return window;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});

// Every webContents — both windows here, and anything created later — gets the
// same lock-down: no popups (http(s) links go to the OS browser), no <webview>.
app.on("web-contents-created", (_event, contents) => lockDown(contents));

app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, (request) =>
        handleApp(request).catch((error: unknown) => {
            console.error("[tumult] app:// handler failed", error);
            return new Response("Internal error", { status: 500 });
        }),
    );
    harden(session.defaultSession);
    mainWindow = createMainWindow();

    // The loopback RPC a native app on this machine pushes activity through: the
    // feed's producer. The smoke test binds `0` for a safe ephemeral port; a
    // taken port degrades the bridge to empty, exactly the web's shape.
    void startNativeActivityServer({ port: resolveNativeActivityPort(process.env), onActivity: broadcastNative })
        .then((server) => {
            nativeServer = server;
        })
        .catch((error: unknown) => console.error("[tumult] native activity server failed to start", error));

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
}, (error: unknown) => {
    console.error("[tumult] failed to start", error);
    app.exit(1);
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

// Release the loopback RPC's port when the app quits so a native app — or the
// next launch — finds it free; closing on will-quit avoids a TIME_WAIT window.
app.on("will-quit", () => {
    void nativeServer?.close();
});
