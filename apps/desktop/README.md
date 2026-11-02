# Tumult desktop (`@tumult/desktop`)

An Electron shell around `apps/web`. Targets **Linux** (AppImage, deb, rpm) and
**Windows** (NSIS, x64). macOS runs it for development but gets no package.

It is a shell, not a second app. The main process serves the web app's
production build from the privileged scheme `app://tumult/` (never `file://`).
It owns only what a browser would otherwise own: navigation, permissions, the
screen picker and the MAS login redirect. There is **no preload**, so the page
gets no Node and no bridge.

## Commands

All of these run from the repo root with `pnpm --filter @tumult/desktop <script>`.

| Script | What it does |
| --- | --- |
| `dev` | Builds core and theme, builds the **real** desktop web build into `web/` and the main process into `dist/`, then runs `electron .`. Needs `VITE_CLIENT_URI` (repo-root `.env.local`, as for web). |
| `start` | Runs `electron .` on whatever is built. For the offline fake client, run `build:web:fake` and `build`, then `TUMULT_WEB_ROOT=web-fake pnpm --filter @tumult/desktop start`. |
| `build` | Compiles the main process only (`src/main.ts` → `dist/main.cjs`, esbuild, CommonJS, `electron` external). |
| `build:web` / `build:web:fake` | Builds the desktop web build only. |
| `test` | Unit tests for the pure main-process helpers (`test/*.test.ts`). |
| `test:smoke` | Playwright `_electron` smoke test against a fake-mode build (`smoke/desktop.smoke.ts`). |
| `demo:activity` | Runs the reference native producer (`demo/native-activity.ts`): connect to the RPC and push a demo activity. Not packaged. |
| `dist:linux` | AppImage + deb + rpm (x64) into `release/`. rpm needs `rpmbuild`. |
| `dist:win` | NSIS installer (x64) into `release/`. |
| `icons` | Regenerates `build/icons/*.png` from `apps/web/public/favicon.svg` (rendered by Electron). |

The desktop web build is `apps/web`'s own Vite config with `VITE_DESKTOP=1`
(`scripts/build-web.ts`). That flag is the build's only behavioural
difference: `chat.real.ts` registers a loopback redirect URI as a `native`
client. See the comment in `apps/web/vite.config.ts`.

## How it works

- **Serving** (`src/protocol.ts`, `src/main.ts`): `app://tumult/<path>` follows
  `apps/web/vercel.json`, which is read at build time. Files come first, then
  `/api/plugin-asset`, then the SPA rewrite. The rewrite excludes
  `/sandbox.html` and `/sandbox.js`, and any other `/api/*` path is a 404.
  Each request gets the same per-path headers a deployment sends (the app's
  `frame-ancestors 'none'`, and the sandbox page's own CSP). The main CSP is
  the build's `<meta>`. Under `app://`, `'self'` is `app://tumult`.
- **Login** (`src/auth.ts`): the redirect URI is `http://127.0.0.1/auth/callback`
  (`apps/web/src/desktop.ts`), registered as `application_type: "native"`.
  1. When the app navigates to the IdP, the main process opens a child
     window, so the app window never leaves `app://`.
  2. The redirect back to the loopback URI is caught on
     `will-redirect`/`will-navigate`, before any request is made. The main
     window then loads `app://tumult/auth/callback#code…`, so `completeLogin()`
     runs unchanged.
  3. A `webRequest` backstop cancels the loopback URL if anything else ever
     requests it.

  Closing the child window returns the app to `/login`. Tokens, the device ID
  and the client-ID cache live in the `app://tumult` origin's localStorage,
  exactly as on web.
- **Plugin assets** (`src/plugin-asset.ts`): `app://tumult/api/plugin-asset`
  reuses `apps/web/api/plugin-asset.ts` (validation, reconstructed github.com
  URL, 4 MB cap, 15 s timeout). It fetches with Electron's `net.fetch`, so the
  system proxy applies.
- **Hardening**:
  - Every window runs with `contextIsolation`, `sandbox` and `webSecurity`
    on, `nodeIntegration` off, no `<webview>`, and no preload.
  - `window.open` never opens a window. http(s) links go to the OS browser
    through `shell.openExternal`, and any other scheme is dropped.
  - The app window can only navigate within `app://tumult`.
  - Permissions go only to `app://tumult` as the top-level document: `media`,
    `display-capture`, `notifications` and `clipboard-sanitized-write` (the
    app's Copy buttons). The configured Element Call frame gets `media` and
    `display-capture`. Everything else is denied.
  - DevTools are off in packaged builds.
  - A single-instance lock prevents two MatrixClients on one IndexedDB.
  - Electron fuses are set: no run-as-node, no `NODE_OPTIONS`/`--inspect`, and
    the app loads only from its asar.
- **Screen share**: `setDisplayMediaRequestHandler` shares the primary screen.
  On Wayland, the PipeWire portal shows the system picker. System audio
  (`loopback`) is Windows-only.
- **Linux**: `ozone-platform-hint=auto` (Wayland or X11). The `.desktop` entry
  has `Categories=Network;Chat;InstantMessaging;`, and its `desktopName` /
  `StartupWMClass` is `tumult`.

## Native activity / reference client

The one bridge the shell breaks its bridge-less stance for: a native app on this
machine can tell Tumult **what you are doing** (a game running, a track playing,
a file open) so a plugin can show rich presence. Web has no equivalent, because
a tab cannot read another process — and passive focused-window detection is not
cross-platform (it does not work on Wayland). So the producer is RPC-first and
language-agnostic: a native process opens a loopback connection to a `node:net`
server the desktop app runs, and pushes one newline-terminated frame per change.

- **The server** (`src/native-activity.ts`, pure of Electron): a loopback
  `127.0.0.1` listener on an ephemeral `0` port. Each frame it reads is validated
  and broadcast to the app's renderer over `NATIVE_ACTIVITY_IPC`, which the
  context-isolated `src/preload.ts` surfaces as `window.tumultNative` — the one
  bridge the shell allows. The server is pure of Electron and unit-tested with a
  real `node:net` client.
- **The wire** (`src/native-wire.ts`, Electron- and IPC-free): the message shape,
  validation, newline framing and port choice, shared by both sides so they
  cannot drift. A native app links *this* module; it is free of `node:net`,
  Electron and the main process's IPC channel.
- **The client** (`src/native-client.ts`, the template a real native app
  copies): a `node:net` client that connects (loopback only), and:
  - **holds** a value before the server is up and re-asserts it on (re)connect,
    so a producer that starts before the app still shows its activity;
  - **never sends a clobbering clear** when it has never set a value, so it does
    not erase another producer's feed;
  - **clears on quit** — `stop()` writes a `clear` before the socket closes, so a
    quitting producer leaves no ghost on the feed. A producer must clear when it
    stops (a closed app is no longer "playing"); the CLI wires that to
    SIGINT/SIGTERM, but the library itself is free of process signals, so it is
    portable as a linked library.
- **Port choice** (`resolveNativeActivityPort`): default `18731`, overridable by
  `TUMULT_NATIVE_ACTIVITY_PORT`. A co-located app finds the port; a port
  `0`/blank/non-numeric falls back to the default.
- **The reference demo** (`demo/native-activity.ts`, dev-only — a real
  detector would replace it): a small Node/Node-TS client that pushes a
  demo activity and quits. Not in
  `electron-builder`'s `files` glob, so it never ships. Run it with the
  desktop app open to watch the feed light up:

  ```
  pnpm --filter @tumult/desktop demo:activity --type listening --name "E2E" --details "hello" --duration 5
  ```

  On exit the demo clears the feed (the "the app quit, so the activity goes away"
  path); a running app keeps it up.

## Dev-only environment

These are ignored by a packaged app:

- `TUMULT_WEB_ROOT`: serve this directory instead of the bundled `web/`. The
  smoke test uses it to serve `web-fake/`.
- `TUMULT_USER_DATA_DIR`: use this profile directory. Unpackaged runs default
  to `<appData>/Tumult (dev)`, never the installed app's profile.

## CI

`.github/workflows/desktop.yml` runs on `workflow_dispatch` and on `v*` tags.
It runs a matrix of `ubuntu-latest` (all three Linux targets, smoke test under
xvfb) and `windows-latest` (NSIS), and uploads the packages as artifacts. It
publishes nothing.

It needs the **repository variable** `VITE_CLIENT_URI`, which is a public URL,
not a secret:

```
gh variable set VITE_CLIENT_URI --body https://tumult.example.org
```

`VITE_ELEMENT_CALL_URL` and `VITE_VOICE` are optional, set the same way.

## Deferred, deliberately (AGENTS.md v1 scope)

- Tray.
- Auto-update.
- Deep links / custom URL scheme.
- `safeStorage` for tokens: they stay in the origin's localStorage, as on web.
- Code signing (Windows SmartScreen will warn).
- macOS packaging.
- A window chooser for screen share.
- A native context menu (copy/paste) for text fields.

## Known Linux caveat

On Ubuntu 24.04+, AppArmor restricts unprivileged user namespaces. An AppImage
can therefore refuse to start ("The SUID sandbox helper binary was found, but
is not configured correctly"). The deb/rpm installs set `chrome-sandbox`
setuid, so they are unaffected. The app never turns its sandbox off. Run the
AppImage on a system that allows user namespaces, or prefer the deb/rpm.
