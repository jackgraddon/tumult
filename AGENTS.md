# AGENTS.md — Tumult

Tumult is a Matrix client inspired by Discord. Goal: functional Discord
replacement on the Matrix protocol, with a chat UI that matches what a good
chat client should be.

## Project context — why the architecture looks this way

- **Home server, not a backend.** The homeserver IS the backend; we build a thin
  client-side contract over matrix-js-sdk rather than a backend. The core↔UI
  boundary is a data-ownership split (core owns SDK, UI owns core), never layers.
  Build vertical slices against a written contract: write the flat interface, then
  run one feature end-to-end through both sides, stubbing the contract with a fake
  when data is behind the UI. Read the contract before inventing shapes.
- **Fork, not a package.** `@tumult/core` ships sources (`src`), never `dist`;
  `apps/web` takes no reference to it and resolves `@tumult/ui` via tsconfig
  paths, so slicing off the shell is one import: `apps/web/src/chat.ts` (real
  client). No Vue in core; the contract lives in `contract.ts` so a renderer
  extends it without touching core.
- **DOM is the renderer.** The chat pane renders into the DOM via a Vue render
  function; there is no SSR. `@tumult/ui` components are headless behavior +
  structure, token-driven — never layout.
- **Reactivity is signals, not a store.** Reactivity comes from `@preact/signals-core`
  (`makeObservable`), a no-op for non-signal code, but versioned (BUMP_TOKEN)
  because Preact's signals ship under reverts that reset the primitive. Vue's ref
  lifecycle rides on top of that contract, not the DOM.
- **Layout = chrome vs panes.** The guild rail is CHROME (fixed, non-collapsible
  track); room list, timeline and members are collapsible panes that keep DOM at
  0-width + `inert` when hidden. Splitting rails out of panes is deliberate.
- **Vertical slices, stub first.** Build a feature end-to-end instead of the data
  layer first — contract shape is unknown until you build the UI. UI knows UI, data
  knows data. See slices 1–12.
- **Recompute, don't patch.** The SDK mutates Room/MatrixEvent in place and fires
  events as invalidation signals; recompute snapshots for a roomId on event, don't
  patch. See Matrix specifics.
- **Versioned JSON theme, not raw CSS or Element-style.** Element's JSON themes
  were a cautionary tale (too few tokens → broken themes). A versioned token
  contract in three tiers (primitives → semantic → component) with a default
  theme; raw CSS is an explicit advanced opt-in behind strict CSP. See Theming.
- **Web-first + Electron, deliberate.** v1 targets login/sync/encrypted chat in a
  browser; desktop comes later. Chosen over Tauri because that stack's Linux WebRTC
  gaps would have compromised the web-first path; Electron was the most
  portable-but-stable shell. See v1 scope.

## v1 scope — web-first, no scope creep

- Targets: login, sync, encrypted chat in a plain browser. MAS is the ONLY
  login method.
- Desktop (Electron, most stable cross-platform) comes later. Ignore
  desktop-only features for now (tray, updater, deep links, safeStorage).
  Tauri rejected for now: Linux WebRTC gaps in system webviews.
- Layout: vertical guild rail (Matrix spaces) + DMs tab + members sidebar.
- Theming + modularity are v1. Games (custom room events: chess,
  tic-tac-toe, etc.) come AFTER a rock-solid modular web UI.
- Non-goals v1: games, voice/video, threads, encrypted search, multi-account,
  push notifications, desktop shell.

## Architecture — UI knows UI, data knows data

- The homeserver IS the backend. There is no custom backend to build first.
- Build vertical slices against a small written TS contract, not layers first:
  1. contract + login, 2. 3-pane shell with fake data + default theme,
  3. guild rail + room list then DMs, 4. timeline read + history pagination,
  5. send with local echo, 6. encryption (spike early, polish last),
  7. member list.
- `packages/core`: Matrix client, auth, sync, crypto. No Vue imports.
  `packages/ui`: Vue components, headless behavior + structure, token-driven.
  `packages/theme`: token contract, default theme, theme validator.
  `apps/web`: shell + routing. `apps/desktop`: later.
- Core exposes plain snapshots + subscriptions. No SDK types leak to UI. The
  contract LIVES in `packages/core/src/contract.ts` — read it there, this is a
  sketch:
  ```ts
  type ConnectionState = 'starting' | 'syncing' | 'reconnecting' | 'error' | 'stopped';
  interface MessageView { id: string; senderId: string; body: string; timestamp: number;
    status: 'sending' | 'sent' | 'failed'; decryption: 'ok' | 'pending' | 'failed'; }
  interface ChatClient {
    login(params: LoginParams): Promise<void>;        // redirects away; never resolves
    completeLogin(params: CompleteLoginParams): Promise<void>;
    restoreSession(): Promise<boolean>;
    logout(): Promise<void>; start(): Promise<void>; stop(): Promise<void>;
    session: Subscribable<SessionView | null>;
    connection: Subscribable<ConnectionState>; rooms: Subscribable<RoomSummary[]>;
    timeline(roomId: string): Subscribable<MessageView[]>; send(roomId: string, body: string): Promise<void>;
  }
  ```
- A single `login()` cannot express a redirect flow: it navigates to the IdP
  and the page is gone, so it never resolves. Hence `completeLogin()` for the
  callback leg and `restoreSession()` for reloads.
- One `ChatClient` per renderer, always. The crypto stack is not thread-safe;
  two MatrixClients on one IndexedDB corrupt the store and break decryption.

## Matrix specifics

- SDK: matrix-js-sdk in the webview + Rust crypto as WASM via
  `initRustCrypto()`. `CryptoApi` from `getCrypto()` for verification, key
  backup, secret storage. Never hand-roll crypto.
- Stores: `IndexedDBStore` for sync cache + separate crypto store. One account
  per crypto DB: set per-user/device `cryptoDatabasePrefix`, delete DB on
  logout. Losing crypto store = losing device keys, so key backup / recovery
  key restore is required.
- Sync: prefer Simplified Sliding Sync (MSC4186, native Synapse >= 1.114),
  fallback classic `/sync`. Keep sync layer abstracted so swap is possible.
- Sync is a lifecycle: PREPARED (may come from cache) / SYNCING /
  RECONNECTING / ERROR / STOPPED / CATCHUP. Register sync listener BEFORE
  `startClient()` or PREPARED is missed. UI must show connection state,
  including network-kill + reconnect.
- `IndexedDBStore.startup()` must be called AFTER `createClient({ store })`,
  never before: the store only gets its `createUser` hook on attach. Nothing
  calls it for you. Getting it backwards throws only once the store has
  presence events to replay, so a cold start looks fine and the NEXT run
  breaks — do not trust a single clean first run here.
- Closing the sync store is MANDATORY on stop: call `store.destroy()`.
  `stopClient()` does not close it, and `deleteDatabase` blocks while any
  connection is open. Both of the SDK's `onblocked` handlers only LOG — they
  never resolve or reject — so a surviving connection makes the next
  `clearStores()` hang forever, i.e. logout never returns. (`stopClient()` does
  stop the crypto backend, so that side is covered.)
- Only ONE MatrixClient per IndexedDB, ever: the SDK says two cause data
  corruption and decryption failures. That means start() must collapse
  concurrent calls AND clean up a half-built client when it throws partway —
  a naive `if (this.client) return` guard does neither.
- Handle `HttpApiEvent.SessionLoggedOut`: the server rejected our token and
  refresh could not recover it. Without it the UI parks on a dead session.
- Handle the store's `degraded` and `closed` events. On IndexedDB failure the
  store silently becomes a MemoryStore — the app keeps working and quietly
  stops persisting. Silence here contradicts the honest-connection-state rule.
- Sending is optimistic: pending → sent/failed per message.
  `pendingEventOrdering` controls placement.
- SDK mutates `Room` / `MatrixEvent` in place, events
  (`RoomEvent.Timeline`, `ClientEvent.Sync`, account-data) are invalidation
  signals. Recompute snapshots on event, don't patch incrementally. In Vue:
  `shallowRef` + version counter.
- Encrypted messages can arrive before keys: render `decryption: pending`
  ("unable to decrypt yet"), upgrade to ok/failed on late decryption.
- Auth (MAS native OIDC MSC3861 + dynamic registration MSC2966 + revocation
  MSC4254): `client.getAuthMetadata()` → `OAuth2.registerClient` → PKCE
  authorize URL → redirect → `completeAuthorizationCodeGrant` → create client
  with tokens. Scope encodes device ID: generate once, persist, reuse (crypto
  identity is tied to it). Revoke token on logout.
- VERIFIED v43: the OIDC module is `src/oauth/`, not `src/oidc/`, and the free
  functions older docs name (`registerOidcClient`,
  `completeAuthorizationCodeGrant`, `OidcTokenRefresher`) DO NOT EXIST. It is
  one `OAuth2` class: static `registerClient`, instance
  `generateAuthorizationCodeGrantUrl` / `completeAuthorizationCodeGrant` /
  `revokeToken`. Read `src/oauth/` before writing auth code.
- Token refresh needs no manual wiring: pass `oauthClientId` + `refreshToken` +
  `onTokenRefresh` to `createClient` and the SDK refreshes internally.
  `TokenRefresher` is only for driving it yourself.
- VERIFIED against mas.jackg.cc: `client_uri` must be a public https URL and
  MAS rejects `localhost` under EITHER scheme — so it cannot be derived from
  `window.location` in dev. It identifies the application, not the instance;
  make it config (`VITE_CLIENT_URI`). A loopback redirect is only accepted for
  `application_type: "native"`, so a localhost dev server registers as
  `native` even though it is a browser. https deploys register as `web`.
- The SDK DISCARDS the IdP's error body and throws a bare "Dynamic
  registration failed". When registration fails, replay the POST to
  `registration_endpoint` with curl to see the real reason. Core pre-validates
  client metadata so these failures name the offending field.
- Cache registered client IDs per homeserver AND per client metadata. A client
  registered under one redirect URI is useless under another, so moving between
  a dev origin and a deployed one must re-register, not reuse.
- Test against local homeserver in Docker (Matrix crypto suite uses published
  Synapse image). Write integration tests against it.
- Browser-driven real-homeserver testing is available: the Playwright MCP
  session can log in to the user's real homeserver (matrix.jackg.cc advertises
  `org.matrix.simplified_msc3575: true`) and run the integration suite
  (`packages/core/test-integration/*`, incl. sliding sync) end-to-end against
  it. Prefer Docker Synapse for disposable rounds; the browser path works when
  a real-homeserver session is logged in.

## UI mapping

- Guild rail: ONLY parent-less spaces. Nested spaces render INSIDE parent as
  Discord-like collapsible categories (icon + title), nestable until rooms
  list as channels.
- DMs tab: all orphaned rooms (not in any space). Matrix marks DMs in
  `m.direct` account data — client rule is "show all orphans as DMs/groups".
- Members sidebar right: lazy member loading, virtualize list for large rooms.
- Timeline dispatches on event type through a small registry with plain
  fallback for unknown types. Custom game events later = registered renderer,
  namespaced under our domain. No timeline rewrite.
  (Slice 2: the registry gates decryption/status in `TimelineRow` BEFORE
  resolution, and is owned per-shell via provide/inject — never a singleton.)
- Framework: Vue 3 + plain Vite (not Nuxt — Nuxt's SSR/server routes are
  unused; plain workspace expresses core/ui/theme separation). Behavior/a11y
  via Reka UI (headless, WAI-ARIA).
  Reka has NO general-purpose list virtualizer (only Combobox/Listbox/Tree
  virtualize) — the timeline will need `@tanstack/vue-virtual` in slice 4.
- Shell layout: the guild rail is CHROME, not a pane — fixed at
  `--layout-guild-rail-width`, never collapsible (collapsing it would leave no
  way to change guild). Room list, timeline, members are the three panes.
  Collapsed panes keep DOM at 0-width tracks with the `inert` attribute.
- Contract: `MessageView` carries `type` + `content` (plain-JSON payload owned
  by the registered renderer) so game renderers never force a contract change.
  `timeline(roomId)` returns the SAME `Subscribable` per roomId, so
  `subscriberCount` can drive idle-room unloading later.
- Inline `type` specifiers (`import { type X }`) are NOT erased by the SFC
  compiler and pull the whole module into the web bundle — use whole-statement
  `import type` for type-only imports (this kept matrix-js-sdk out of the fake
  build). VERIFIED: the same trap applies to plain `.ts` in `packages/core`,
  where `verbatimModuleSyntax` makes tsc emit `import { type X } from "y"` as
  the side-effect `import {} from "y"` — so an all-type braces import keeps its
  module in the graph there too. Three files had drifted into it and pulled the
  whole SDK into the fake client's chunk (839 kB → 17 kB when fixed); guarded
  repo-wide by `packages/core/test/imports.test.ts`.
  `packages/ui` ships `src` (SFCs), not `dist`; `apps/web` takes no
  project reference to it and maps `@tumult/ui` via tsconfig paths.
- `CryptoApi`, `CryptoEvent` and `decodeRecoveryKey` are NOT exported from the
  `matrix-js-sdk` package root — import them deep
  (`matrix-js-sdk/lib/crypto-api`, `…/CryptoEvent`, `…/recovery-key`). There is
  no `exports` map blocking deep imports.
- Memory rules day one: one renderer/window, windowed room loading, capped
  in-memory events per room, unload idle rooms, virtualized message list,
  server thumbnails over full images, pause off-screen animations.

## Theming — JSON-first

- Unstyled UI referencing variables + shipped default theme (unstyled alone
  looks broken). Entire app themeable via well-documented token protocol.
- Tokens 3 tiers: primitives (palette) → semantic (surface/text/accent/border/
  danger) → per-component. Components reference semantic/component only.
  Cover color + spacing + radius + typography + motion + layout dims
  (e.g. `--layout-guild-rail-width`, `--layout-members-width`).
- One file per theme on `:root[data-theme="name"]`, version the token list.
- JSON is the default safe path: validate → emit CSS vars. Raw CSS is
  explicit advanced opt-in (arbitrary URLs, keep strict CSP).
- CSP must allow `'wasm-unsafe-eval'` in `script-src` for crypto WASM.

## Build tooling — verified gotchas

- Vite dev server: `optimizeDeps.exclude` must list
  `@matrix-org/matrix-sdk-crypto-wasm`. The crypto glue resolves its `.wasm`
  relative to itself; the dep optimizer rewrites the glue into `.vite/deps/`
  without copying the asset, so the fetch 404s, the SPA fallback answers with
  `index.html`, and it surfaces as "Incorrect response MIME type. Expected
  'application/wasm'". Dev-only — the production build resolves it fine.
- Because pnpm does not hoist, `@matrix-org/matrix-sdk-crypto-wasm` must ALSO
  be an explicit dependency of `apps/web`. It is a transitive dep of
  matrix-js-sdk, so the optimizer cannot resolve it from the app otherwise
  ("Failed to resolve import ... from node_modules/.vite/deps").
- esbuild's postinstall is blocked by default in pnpm 10+. It is approved via
  `allowBuilds:` in `pnpm-workspace.yaml` (NOT the `pnpm` key in
  `package.json`, which pnpm 11 ignores). Without it Vite cannot run.
- TypeScript is pinned to 5.x, not 7.x, for vue-tsc compatibility.
- Packages that emit runtime JS use `rewriteRelativeImportExtensions` so
  sources keep `.ts` specifiers. `apps/web` turns it OFF — the rule cannot
  handle `.vue` specifiers, and Vite does the emitting there anyway.

## Linux is a target — test early

- secret storage may fall back to `basic_text` (unprotected) with no keyring.
- Wayland/X11, GNOME tray needs AppIndicator, deep links need installed
  `.desktop`, packaging AppImage + deb/rpm first (Flatpak later).

## Repo ops

- Private repo `jackgraddon/tumult`, branch `main`. `gh` CLI is installed and
  authed on this device — use it for repo ops.
- `opencode.json` is local-only and gitignored. Never commit it. `AGENTS.md`,
  `README.md`, and spec docs ARE committed.
- pnpm workspace. `pnpm dev` (web), `pnpm build`, `pnpm typecheck` from root.
  `packages/core` must be built before `apps/web` resolves it — `pnpm -r build`
  handles the order.
- Dev homeserver is `matrix.jackg.cc`, auth at `mas.jackg.cc`. Set
  `VITE_CLIENT_URI` in `apps/web/.env.local` (gitignored, see `.env.example`).
- Work with **relative paths** only — base everything off the working directory
  (`$WORKDIR`, normally `/var/home/jack/Documents/Git/tumult`) and reference
  paths as `packages/core/src/client.ts`, `AGENTS.md`, etc. Never use absolute
  paths (e.g. `/var/home/jack/Documents/Git/tumult/...`). Use `workdir` to
  change directory; stay relative inside commands.

## Context for agents

- **Where truth lives:** `packages/core/src/contract.ts` is the UI↔data boundary, `AGENTS.md` is repo ops + verified Matrix traps. When executing the rewrite, reference both rather than duplicating.
- **Stack pins:** Vue 3 + Vite (not Nuxt), Reka headless, `@tanstack/vue-virtual`, TypeScript 5.x (vue-tsc compatible), `rewriteRelativeImportExtensions` on for packages / off for `apps/web`, `optimizeDeps.exclude` must list `@matrix-org/matrix-sdk-crypto-wasm` and it is an explicit dependency of `apps/web`.
- **Invariants to preserve:** one `ChatClient` per renderer, recompute-not-patch, chrome-vs-panes (`inert` + 0-width tracks), per-shell registry via provide/inject (never a module singleton), use whole-statement `import type` in SFCs (not inline `type` specifiers), CSP must allow `'wasm-unsafe-eval'` and `media-src blob:`.
- **Theme v1 baseline:** registry in `packages/theme/src/registry/`, compiler/validator in `packages/theme/src/`, default theme `packages/theme/themes/default.json`, scoped on `:root[data-theme="name"]`.
- **Test conventions:** use `node --test "test/**/*.test.ts"` (not `node --test <dir>`), stub via SDK enums (not hand-typed strings), integration tests via Docker Synapse (`tests/synapse/`, `packages/core/test-integration/`) — Docker may be unavailable; some integration paths are written but unverified.
- **Rewrite plan:** See `REWRITE_PLAN.md` (phased: token audit/v2, plugin API, theme loader+UX, visual redesign, testing/parity). That plan is the source of truth for the UI rewrite and should be consulted on every session.

## Where the build is

- DONE — slice 1: contract, MAS login (verified end to end against
  mas.jackg.cc: discovery → registration → PKCE → callback → session restore),
  crypto init, sync reaching `syncing`.
- DONE — slice 2: 3-pane shell (guild-rail chrome + room list + timeline +
  members) on a deterministic fake client (`@tumult/core/fake`, seed 1337),
  JSON default theme compiled at build time (contract v1), renderer registry
  with an app-registered demo poll, cycle-safe `selectSpaceTree`, first
  `node --test` suites (selector + validator). Fake/real swap is one import
  in `apps/web/src/chat.ts`. Real `rooms`/`timeline()`/`send()` still throw —
  slice 3 replaces them, don't paper over.
- DONE — slice 3 (rooms half): real `rooms` feed — `snapshotRooms()` maps
  joined rooms (space links via `m.space.child`, 48px server-thumbnail
  avatars, Total/Highlight unreads), refreshed on every `ClientEvent.Sync`,
  DMs fall out of the orphan rule with no extra code. `apps/web` points at
  the real client. `send()` still throws — slice 5 replaces it, don't paper
  over. (The shell catches those throws and renders explicit "lands in slice
  N" placeholders, so a selected room can't zombie-crash later patches; core
  still throws honestly.)
- DONE — slice 4: real `timeline(roomId)` — pure `mapEvent()` (body
  fallback, redaction tombstone, local-echo statuses, pending/ok/failed via
  `clearEvent` since `isEncrypted()` stays true post-decryption), self-driving
  `TimelineFeed` (cached Observable per room, lazy per-room listeners, Sync +
  Decrypted backstops, `loadMore()` with concurrent-call collapse, 500-event
  cap), `@tanstack/vue-virtual` timeline with top-edge pagination and
  scroll-preserved prepends. Placeholders dissolve automatically now that
  `timeline()` resolves; composer stays disabled until slice 5.
- NEXT — slice 5: send with local echo.
- DONE — slice 5: send with local echo — `sendTextMessage()` helper
  (`m.text` via `MsgType.Text`) wired through `MatrixChatClient.send()`;
  the SDK owns the echo lifecycle (chronological ordering is its default, so
  no client option needed) and the feed maps every transition. Composer
  enabled with a logged-not-thrown error path; failed echoes show the
  existing "not sent" flag (retry is a follow-up). Covered by stub unit tests
  plus a gated-`fetch` integration test proving `sending → sent`.
- NEXT — slice 6: encryption polish (verification, key backup / recovery).
- NEXT — slice 6: encryption polish (verification, key backup / recovery).
- DONE — slice 6 (backup + recovery, no SAS): `SecurityStatus` feed
  (cross-signing/backup-trust/secret-storage, refreshed on crypto events),
  backup auto-enabled at start, raw-key 4S setup returning the recovery key
  once, paste-to-restore that rebuilds timelines. Banner + two Reka Dialogs
  in the shell plus an account-menu entry. No crypto in Node, so verification
  is manual against matrix.jackg.cc.
- FIX — restore speaks 4S now: setup shows the secret-storage key, so restore
  unlocks via `getSecretStorageKey` callback + `loadSessionBackupPrivateKey-
  FromSecretStorage` (direct backup-key store kept as fallback for backups
  made elsewhere). Every failure maps to a friendly message; raw SDK strings
  never reach the modal. The held key lives only for the restore call.
- FIX — restore also verifies the device: after the backup half, when 4S
  holds cross-signing keys the device lacks, `bootstrapCrossSigning({})`
  imports them and self-signs (the SDK's own recovery path). Skipped
  honestly when 4S has no keys or the device already has them — the
  identity-rotating branch is never taken. `restoreBackup()` resolves
  `true` when verification happened; the modal says so.
- FIX — the held key must span BOTH halves: the backup unlock and the
  cross-signing import both read from 4S via `getSecretStorageKey`. An
  early `finally` cleared it before `bootstrapCrossSigning` ran, so the
  import silently failed (decryption worked, verification didn't). One
  `finally` at the end of the whole restore now clears it.
- DONE — slice 7: SAS verification — interactive emoji verification for
  own-user and own-device flows. `VerificationManager` tracks active
  requests, SAS emoji/decimal display with confirm/mismatch/cancel,
  incoming/outgoing request handling. `verification: Subscribable<VerificationState>` feed
  in contract, modal in shell with account-menu entry. No crypto in Node
  for SAS flow, verified manually against matrix.jackg.cc.
- FIX — SAS hardening: `Verifier.verify()` calls `accept()` internally, so the
  manual `accept()` before `startVerification()` double-accepted (phase-2
  error, then phase-5 on retry) — removed from both paths. `getDevices()`
  before `startVerification()` populates the device cache (fixes "other
  device is unknown"). Modal auto-opens on incoming requests with an
  accept/decline state; account menu lists own devices with verification
  status. Deep SDK value imports need `.js` extensions for Node strip-mode.
- FIX — SAS ordering: `requestOwnUserVerification()` broadcasts to all own
  devices, so no `otherDeviceId` exists until the receiver sends ready —
  starting SAS immediately threw "other device is unknown" despite delivery.
  `startVerification()` now waits for Ready (120s, cancellable); the manual
  initiator-side `accept()` is gone entirely (receivers never send ready);
  incoming accepts only while Requested. Covered by stub-emitter gating tests.
- NEXT — slice 8: TBD.
- DONE — slice 8: reactions — `m.reaction` annotations aggregated in
  `TimelineFeed` (grouped counts + own flag, redacted excluded, no
  annotation rows), `toggleReaction()` (send vs redact routing) through
  `MatrixChatClient`, chips + Reka Popover palette on `TimelineRow` with a
  `+` affordance on hover. `MessageView.reactions` is additive; renderers
  untouched. Covered by stub unit tests plus a Synapse round-trip
  (react → count 2 → toggle off → other's remains).
- NEXT — slice 9: TBD (read receipts pair well — same row-decoration area).
- DONE — slice 9: read receipts — per-message `readBy` (latest-read-per-user
  markers via `getUsersReadUpTo`, self excluded, `m.read` + `m.read.private`),
  reader avatar stacks on `TimelineRow`, `markRead()` (latest-tail receipt,
  per-room throttled) fired when the live tail is visible. Viewing a room
  now clears its unread badge on the next sync — badges verified end to end
  in the harness (read → others see reader → own unread 0).
- NEXT — slice 10: TBD.
- DONE — slice 10: message edits — `m.replace` relations aggregated in
  `TimelineFeed` (latest-wins, sender-must-match, never over tombstones, no
  edit rows), `edit()` (`m.new_content` via `sendMessage`) through
  `MatrixChatClient`, pencil affordance on own sent messages with inline
  editor (Enter saves, Escape cancels) plus an "(edited)" marker.
  `MessageView.edited` is additive; the `sameTimeline` body comparison from
  the redaction fix covers republication. Stub unit tests plus a Synapse
  round-trip (edit → flag, second wins, wrong-sender ignored).
- DONE — slice 11: typing indicators — `TypingTracker` (per-room typing
  user lists from `member.typing`, self excluded, `RoomMember.typing` +
  sync backstop), `typing: Subscribable<TypingState>` feed, "X is typing…"
  indicator in the timeline header, composer sends/clears typing on
  draft input (15s throttle). Stub unit tests plus a Synapse round-trip
  (type → other side sees → send clears).
- DONE — slice 12: threads — `ThreadTracker` (per-room `ThreadSummary`
  lists, cached thread timelines with the root prepended, `sendReply`,
  threaded `markThreadRead`, `supportsThreads()` capability gate), a
  `ThreadList` + `ThreadPanel` slide-over overlaying the timeline pane (no
  grid change), the per-message thread affordance, room switch closes it.
  Thread unreads need no folding: `getUnreadNotificationCount` already sums
  them. Stub tests plus a Synapse round-trip (reply → exact count → second
  reply → participation → unread rises → mark read clears).
- VERIFIED v43 thread traps (each one shipped broken before):
  `threadSupport` is a `startClient()` option (IStartClientOpts) — on
  `createClient` it's silently ignored and NO `Thread` objects exist; a cast
  hid the type error. Thread events fire on the `Room`, never the client.
  Use the `ThreadEvent` enum — the VALUES are `"Thread.update"` etc., not
  the member names. `thread.length` already excludes the root. Participation
  counts authoring the root (server semantics).
- AUDIT (post-slice-12), each verified against v43 source and fixed:
  read receipts must skip pending local echoes (`sendReadReceipt` throws
  "Cannot set read receipt to a pending event", and the tail is usually our
  own echo); reaction/edit rows are hidden by WIRE relation (`getRelation()`
  reads cleartext `m.relates_to`, `getType()` says `m.room.encrypted` until
  decryption); an `m.space.child` with no `via` is a REMOVED link, not a
  live one; the client's typing feed must subscribe to the tracker (it was
  published once, so the indicator never showed in-app); verifier
  listeners bind by verifier identity (a request can jump Requested →
  Started); thread timelines need `RoomEvent.LocalEchoUpdated` and
  `MatrixEventEvent.Decrypted` too; a failed `start()` detaches trackers.
- DONE — authenticated media: `RoomSummary.avatarUrl` is now the raw
  `mxc://` URI; `client.resolveMedia(uri, size)` (MediaResolver) fetches
  `/_matrix/client/v1/media/thumbnail` through `client.http.authedRequest`
  with `rawResponseBody` — SDK token refresh included, unlike a bare fetch —
  and returns a `blob:` URL (2x, capped 256px, one promise per image,
  failures evicted, all revoked on stop). Servers without v1.11 fall back to
  the legacy `mxcUrlToHttp` URL. `Avatar` resolves `mxc://` itself via the
  shell-provided `MediaKey`, initials until then. Synapse round-trip proves
  the blob path AND that the endpoint 401s without a token.
- Avatars everywhere: `MessageView.senderName` / `senderAvatarUrl` (mxc)
  come from `event.sender` (member state AT that event, so history keeps
  old names); DM rooms with no avatar borrow `getAvatarFallbackMember()`'s.
  Readers/members reuse sender profiles from the loaded window. The `<img>`
  MUST be sized to its box (`object-fit: cover`): Synapse snaps thumbnails
  to configured sizes, and an unsized image renders cropped and zoomed.
- Root rows show "N replies ›" from `threads(roomId)`, joined in the UI by
  root event id — no contract change.
- Stubs that emit hand-typed event-name strings will agree with the code's
  mistakes. Dispatch through SDK enums in stubs, and keep a Synapse
  round-trip for anything event-driven.
- FIX — redaction rows: `m.room.redaction` events rendered as "Unsupported
  event" fallback rows; the filter now drops them (the target already
  tombstones via `mapEvent`). Found a deeper bug underneath: `sameTimeline`
  compared id/status/decryption only, so a body-only change (redaction
  tombstone) was discarded as unchanged and never published. Body + type
  are compared now (also future-proofs edits). Plus a Synapse quirk for the
  test: `.../redact/{event}/{txn}` 405s on this version, txn-less works.
- DONE — first integration harness: `tests/synapse/` (pinned Synapse in
  Docker, generated config + checked-in override) with a `node --test` suite
  driving two password-authed SDK clients (space, parent links, unread,
  selector — green). Raw `MatrixClient`, no crypto: rooms are unencrypted.
- Sliding sync (MSC4186) is not wired — classic `/sync` only, behind the
  abstraction.
- `pnpm test`/`test:integration` in core use `node --test "test/**/*.test.ts"`
  globs: `node --test <dir>` broke on Node 25 (treats the dir as a module).
- DONE — slice 18: inline quoted replies — `MessageView.reply: ReplyView |
  null` (additive) and `send(roomId, body, replyToEventId?)`. Send builds the
  spec fallback (`> <@mxid> quoted lines` + blank line + reply) via
  `room.findEventById`, attaches `m.relates_to.m.in_reply_to` AND
  `m.mentions.user_ids` (spec: replying mentions the target). Read:
  `mapEvent` extracts the relation and strips the fallback (spec algorithm,
  only when a relation says it IS a reply), then the feed's
  `applyReplyQuotes` overwrites the quote from the loaded target
  (post-edit, redaction-aware) — after edits, before the cap; threaded
  rebuilds call it too. UI: ↩ reply affordance on sent decrypted rows →
  quote strip in the composer (✕ cancels, TimelineBody owns the state, room
  switch clears it via the pane's `:key`) + compact quote block above the
  renderer. Stub unit tests (`test/replies.test.ts`) plus a Synapse
  round-trip: wire shape + fallback + mention, foreign-client reply strip,
  quote enrichment.
- VERIFIED reply traps: `getRelation()` returns null for plain replies —
  `isRelation()` requires `rel_type`, a bare reply has none; read
  `m.relates_to.m.in_reply_to.event_id` directly. EVERY thread message
  carries `m.in_reply_to` (`addThreadRelationIfNeeded` falls back with
  `is_falling_back: true` for unthreaded clients) — rendering those as quotes
  would quote the previous message on every thread row, so only bare replies
  or `is_falling_back: false` count. Read relations from `getContent()`
  (decrypted on E2EE); quote enrichment must run AFTER edits apply so quotes
  track edited bodies.
- DONE — slice 19: message completeness — delete/redact (`redact()` →
  `redactEvent()`; the redaction row never renders, the target tombstones on
  the next rebuild with `MessageView.redacted`), the read marker (`markRead()`
  now writes `m.fully_read` alongside the receipt via `setRoomReadMarkers`,
  surfaced as `RoomSummary.fullyReadEventId` → "New messages" divider anchored
  mid-history in the fake), server-side search (`search()` →
  `searchRoomHistory()`: room-scoped, recent-first, `next_batch` pages,
  `SearchPage` — the SDK helper has no batch input, so it's raw
  `matrix.search` + `processRoomEventsSearch`), and search navigation
  (`jumpTo()` → bounded scrollback walk → `focusRequest` flash; 🔍
  `SearchPanel` slide-over in the timeline header with honest
  out-of-window failure). Covered by `test/messages.test.ts` (stub routing,
  fake parity, marker throttle/fallback, jump bound + concurrent collapse) plus
  a Synapse round-trip (`test-integration/messages.test.ts`: wire tombstone +
  other-side row, marker account data → snapshot, 12-hit paged search with no
  repeats, jump-to-oldest then exhaustion-false).
- VERIFIED slice-19 traps: there is NO `sendReadMarker` — the API is
  `setRoomReadMarkers(roomId, rmEventId, rrEvent)` (it throws on pending
  events, hence `latestReceiptable` first), and `WritableAccountDataEvents`
  EXCLUDES `m.fully_read`, so `setAccountData` can't set the marker. The spec
  search body has NO `page_size` — page size lives in `filter.limit` (Synapse
  defaults 10) — and `IEventSearchOpts` has no batch input, so pagination is
  raw `matrix.search({ body, next_batch })` (query string) +
  `processRoomEventsSearch` on a fresh accumulator. Server search matches
  cleartext only: encrypted rooms return nothing (v1 non-goal, not an error).
  `getEventTimeline` needs `timelineSupport: true` (we don't set it), so
  `jumpTo` is a bounded `loadMore()` loop (12 pages ≤ the 500-event cap) that
  resolves `false` at the cap — callers must not scroll on `false`. A body-only
  change must republish: `sameTimeline` compares body AND `redacted` (a flag
  change with an identical body would otherwise never repaint). Deep SDK VALUE
  imports need the `.js` extension for Node strip-mode — tsc and Vite forgive
  extensionless deep imports, only `node --test` catches it (this bit
  `matrix-js-sdk/lib/@types/search`).
- DONE — slice 20: room lifecycle — contract + core: `createSpace(params)`,
  `createChannel(spaceId, params)` (visibility / `aliasLocalpart` / `encrypted`),
  `createDm(params)`, `joinRoom(idOrAlias)`, `leave()`, `invite()`,
  `searchUsers()` + their param/result types, in `rooms/lifecycle.ts` (writes
  the `m.space.child` link BOTH ways so `snapshotRooms` sees the parent) with
  fake parity. UI: one shared `RoomDialog` (Reka dialog + `<form>` + actions
  row, and it owns a full unscoped copy of the `.tumult-dialog*` chrome so
  rooms dialogs are self-contained), `UserPicker` (250 ms debounce, sequence
  race guard, exact-mxid fast path that skips search), six dialogs
  (space/channel/join/dm/invite/leave), a "+" `DropdownMenu` on the guild rail
  (Create space / Join), "+" in the room-list header (create channel in the
  selected guild) and the DMs header (new message), an Invite button in the
  members pane, and a right-click `ContextMenu` → confirm on room rows and
  guild tiles. `TumultShell` owns a `RoomAction` union + `useActions()` provide
  (list items can't reach the shell), `waitForRoom()` before navigating to a
  fresh room, `topSpaceId()` to pick the rail-level guild for joins, and a
  `[rooms, connection]` watcher that reverts a selection whose room/space
  vanished. Covered by `test/lifecycle.test.ts` (188 unit) plus a Synapse
  round-trip (`test-integration/lifecycle.test.ts`, 23: space + child links
  both directions, join by alias, dm creation, leave, invite, directory
  search).
- VERIFIED slice-20 traps: creators resolve the roomId BEFORE the room is in
  the `rooms` feed — selecting immediately renders the previous pane, so the
  shell waits for presence (5 s, resolves regardless) and the cleanup watcher
  is the backstop for anything that slips through. An `m.space.child` with no
  `via` is a REMOVED link, not a live one — that's the same trap as the audit;
  lifecycle must write `{ via: [domain] }` on child AND parent. Synapse's
  user directory needs `search_all_users` enabled and only returns people you
  share a room with, so the picker's raw `@user:server` fallback is load-
  bearing, not a nicety. `m.direct` account data IS writable (`setAccountData`
  — only `m.fully_read` is excluded). Spaces never encrypt: the checkbox only
  appears on channels/DMs. Two nested `as-child` triggers on ONE element break
  attribute merging — the context-menu trigger wraps the inner `<a>` inside
  the `<li>`, while the tooltip trigger stays on the `<li>`. Reka roots render
  slot only (safe inside `<ul>`/`<li>`), but their content needs a portal
  (Teleport defaults to `body`), and `DialogContent` unmounts on close, so
  every dialog resets its refs in an `open` watcher AND the parent drives
  `open` off the `RoomAction` union.
- DONE — slice 21: members, presence & profiles — contract: `Membership`,
  `PresenceState`, `MemberView` (userId/displayName/avatarUrl/membership/
  powerLevel/isSelf/presence/lastActiveTs), `ProfileView`, a `profile:
  Subscribable<ProfileView | null>` feed plus `members(roomId)` /
  `loadMembers(roomId)` / `setProfile({ displayName?, avatar? })` (only join
  and invite are rostered — leave/ban are slice 22 surface). Core:
  `rooms/members.ts` (`MembersTracker`: per-room cached Observable, power-
  desc/name/userId order, `loadMembersIfNeeded`, presence committed only on a
  non-cached `ClientEvent.Sync`) and `rooms/profile.ts` (`fallbackName` /
  `readProfile` / `writeProfile`, `null` avatar clears via `setAvatarUrl("")`).
  UI: `MembersPane` virtualized with section headers (Admins ≥100 / Moderators
  ≥50 / Members / Invited), honest "Loading members…" + Retry on failure,
  `MemberListItem` presence dot (green / grey / hollow-unknown + last-seen
  tooltip, "Invited" badge), `ProfileDialog` on `RoomDialog` chrome (display
  name + file-upload avatar with blob preview, Remove/Undo) opened from the
  account menu, profile avatar/name in `AccountTile`. Covered by
  `test/members.test.ts` + `test/profile.test.ts` (17 new, 205 unit) plus a
  Synapse round-trip (`test-integration/members.test.ts`: lazy roster +
  `loadMembers` + joined-member rename rebuild, live presence turn-on,
  write/read profile with mxc avatar, roster-vs-`getMembers` after a join) —
  27 integration total. Presence IS enabled on the dev Synapse (probed, no
  `override.yaml` change).
- VERIFIED slice-21 traps: `lazyLoadMembers` is a `startClient()` option (on
  `createClient` it's silently ignored; guests force it off) — the first sync
  ships a partial roster and `room.loadMembersIfNeeded()` is the only route to
  completeness; `getMembers()` returns the partial state before it, and the
  in-flight `membersPromise` CLEARS on rejection, so a failed load must
  surface + retry, not swallow. Presence must be committed-on-next-Sync, not
  on receipt: `IndexedDBStore.startup()` and the cached first-sync replay call
  `setPresenceEvent()` with a fresh `lastPresenceTs`, so trusting it would
  republish a days-old "online" on every boot — queue live presence, drop it
  when `data.fromCache`, publish after the next real Sync (self is always
  `online`). The SDK re-emits `RoomMemberEvent.Name/Typing/PowerLevel/
  Membership` on the CLIENT with `(event, member)` args and NO roomId — read
  `member.roomId`. A profile rename lands as an `m.room.member` Name event
  only for users who JOINED: renaming an invite-only user never propagates on
  Synapse (the integration test renames a joined member). `profile` is a
  plain field that exists before `start()`, while `members()`/`loadMembers()`
  throw before it — the account tile subscribes unguarded, the pane guards.
  The members pane virtualizes like the timeline (plain overflow scroller,
  header rows as virtual items, `as Row` casts — vue-tsc does not narrow
  `rows[v.index]` across `v-if`), and `MemberListItem` takes the whole
  `MemberView` so each virtual row casts once.
- DONE — slice 22: Simplified Sliding Sync (MSC4186). Phase 0 (committed
  earlier): client-side presence REST poller (`rooms/presence.ts`, no SSS
  presence extension exists) feeding the members tracker, and
  `rooms/unread.ts` recomputing unread totals because Synapse hardcodes
  `notification_count=0` over SSS. This round finishes the mode:
  - `sync/range-manager.ts` owns the room window as ONE list (`all`) whose
    range `[[0, end]]` is grown in place via `SlidingSync.setListRanges`
    (non-sticky; the supported entry point). `loadMoreRooms()` adds one page
    (500, cap 5000) and persists the bound under `tumult.sss.windowEnd`;
    the bound is restored (clamped) in `start()` before `startClient()`.
    Logout and forced-logout clear the key.
  - `setRoomSelection(roomId|null)` keeps the open room subscribed
    (`modifyRoomSubscriptions`) even when it sits outside the list window;
    the shell calls it from its `activeRoomId` watcher (immediate + cleared on
    unmount).
  - Presence poller takes an optional priority callback: the open room's
    members poll EVERY tick, everyone else on a slow cadence (every 5th tick)
    after a warm-up tick that polls everyone — previously the WIP never polled
    non-priority users at all.
  - Trackers are gated on the resolved mode: `UnreadTracker` + `PresencePoller`
    are built only under sliding sync, with the mode resolved BEFORE they are
    constructed (`activeSyncMode` is what the gating reads). Under classic
    `/sync` the SDK already ships exact unread counts with highlights and
    sync-carried presence; running the fallbacks there would override server
    truth with a timeline lower bound (and `highlight: 0`) and fire redundant
    presence REST polls.
  - Contract: `setRoomSelection` + `loadMoreRooms` + `hasMoreRooms` (window
    still has rooms behind it, from SSS `joinedCount`; false under classic and
    the fake) added, with fake parity. A shared `LoadMoreRooms` button renders
    in both room-list views while `hasMoreRooms()` is true and calls
    `loadMoreRooms()`; the shell refreshes it on `[rooms, connection]`.
  - Covered by rewritten `test/sync/range-manager.test.ts` and the presence
    cadence test (222 core unit tests).
- VERIFIED slice-22 traps: the last WIP commit was broken six ways — it
  deleted `AuthStorage.clearSession()` while three callers survived
  (logout/forced-logout), duplicated the client's sliding fields and init
  block, passed the `{sync, manager}` wrapper as `startClient({slidingSync})`,
  dropped the `ActiveSyncMode` export, deleted `jumpTo` from the contract and
  declared `loadMoreRooms` twice. `tsc` catches all of it; `node --test`
  did NOT (type-stripping ignores `readonly`, so assigning to a
  `readonly` field ran fine) — always run `pnpm typecheck` here, not just
  tests. `SlidingSync`'s third ctor arg is a ROOM SUBSCRIPTION
  (`{timeline_limit, required_state}`), not a list; a list-shaped object there
  is silently ignored. Each range must be a range ON a list — a separate list
  per range is not window growth. And SSS warm-boot is genuinely blocked in
  v43: `sliding-sync.js` keeps `pos` in a local inside `start()` and never
  calls `setSyncToken`, and `SlidingSyncSdk` only emits `Prepared` after the
  first network response (`fromCache: false`) — so persisting the window restores
  its SIZE, not offline rooms or a resumed token.
- NEXT — slice 22 integration: a Synapse round-trip for window growth +
  open-room subscription is NOT yet written (Docker was unavailable when this
  landed); add one to `test-integration/` before trusting the window path on a
  real server.
- DONE — slice 23: room settings — `RoomSummary` now carries `joinRule` /
  `historyVisibility` / `canonicalAlias`, read off the live `Room` by
  `rooms/settings.ts` `readSettingsFields` (spec defaults `invite`/`shared`,
  per-field try/catch so a throwing accessor never crashes the snapshot).
  `updateRoomSettings(roomId, patch)` sends only the changed fields, each
  independently (the `writeProfile` apply-what-works rule): `setRoomName` /
  `setRoomTopic` (empty clears → snapshot `null`), room avatar via
  `uploadContent` → `m.room.avatar` state event (`url: ""` clears),
  `m.room.join_rules` / `m.room.history_visibility` via `sendStateEvent`,
  canonical alias via `m.room.canonical_alias`. `sameRoomSummaries` compares
  the new fields so a settings change republishes (redaction-class trap).
  UI: gear IconButton in the timeline header → `RoomSettingsDialog` on the
  shared `RoomDialog` chrome (name / topic / avatar-with-preview+undo, join
  rule + history-visibility selects, alias input), closed on room switch with
  the `activeRoomId` watcher. Fake parity mutates the summary feed (empty
  name keeps the old fallback — the fake has no member-derived name). Covered
  by 12 new tests (`test/settings.test.ts`: stub routing, snapshot mapping,
  republish-on-settings-change, fake parity), 234 total; typecheck + build green.
- VERIFIED slice-23 traps: `Room` itself has `getJoinRule()` /
  `getHistoryVisibility()` / `getCanonicalAlias()` — no roomState dance — but
  the SDK has NO `setRoomAvatarUrl` / `setRoomCanonicalAlias`; both are raw
  `sendStateEvent`, and an avatar must be `uploadContent`'d BEFORE the event.
  SDK `JoinRule` / `HistoryVisibility` are string ENUMS — a plain `"public"`
  literal is NOT assignable to the enum-typed content field, so both
  directions convert (contract unions ↔ enum members). Removing a canonical
  alias means an event with `alias` absent: build the `{}` conditionally — a
  literal `{ alias: undefined }` is an exactOptionalPropertyTypes error (and
  JSON-drops the key anyway). `getJoinRule()` can throw on incomplete state —
  wrap or the whole snapshot crashes. The UI deliberately offers no
  "restricted" join rule: it needs an `allow` list (`m.room_membership` space
  links) that room settings can't express — parked for moderation's
  power-level editor.
- DONE — slice 24: moderation — contract: `RoomPowerLevelsView` (raw content —
  `users`/`usersDefault`/`eventsDefault`/`stateDefault`/`ban`/`kick`/`redact`/
  `invite`/`events` — plus `myPowerLevel` and the computed
  `canKick`/`canBan`/`canSetPowerLevel`/`canEditSettings` flags, spec defaults
  filled), feeds `powerLevels(roomId): Subscribable<RoomPowerLevelsView | null>`
  and `banned(roomId): Subscribable<MemberView[]>`, methods `kick`/`ban`
  (optional reason) / `unban` / `setPowerLevel`. Core `rooms/moderation.ts`:
  `snapshotPowerLevels` (reads `room.currentState.getStateEvents(
  EventType.RoomPowerLevels, "")`, `myPowerLevel` from
  `room.getMember(selfId)?.powerLevel` with a `users[selfId] ?? users_default`
  fallback), `snapshotBanned` (scans `room.getMembers()` for `membership ===
  "ban"`, roster ordering, presence `unknown`), `PowerLevelsTracker` (lazy
  per-room feed; rebuild on `RoomStateEvent.Events` filtered to
  `m.room.power_levels`, `RoomMemberEvent.PowerLevel`/`Membership`, every
  `ClientEvent.Sync`; room gone → `null`; `detachAll()`) and the four write
  wrappers. `banned()` lives in `MembersTracker` as a second map — `rebuild`
  now publishes both roster and banned, `detachAll` clears both, and the
  listener guards test membership in either map. UI: `actions.ts` gains
  `requestModeration({ kind, roomId, member })`; `MemberListItem` context menu
  (Change permissions… / Kick / Ban / Unban, gated on the `can*` flags AND
  target strictly below us); `MembersPane` subscribes `powerLevels` + `banned`
  and renders a "Banned" section last only when non-empty; shell
  `RoomAction` gains `{ kind: "moderate", moderation }`, split into the shared
  `ModerationConfirmDialog` (kick/ban/unban, danger chrome, reason textarea for
  kick/ban only) and `PowerLevelDialog` (Member 0 / Moderator 50 / Admin 100
  presets + a clamped 0–100 number field); a `useRoomPower` composable
  resubscribes the active room's feed on switch and drives
  `settingsAllowed` (gear hidden for non-admins once power is known). Fake
  parity: Mallory banned in `general`, roster feed filtered to join/invite,
  kick/ban/unban/set-power mutate the feeds, permission throws. Covered by 20
  new tests (`test/moderation.test.ts`: snapshot defaults/parse/flags,
  banned filtering+mapping, tracker rebuild/lazy/detach, write routing, fake
  parity), 274 total; typecheck + build green. The Synapse round-trip
  (`test-integration/moderation.test.ts`) is written but UNVERIFIED — Docker
  was unavailable.
- VERIFIED slice-24 traps: a power-level change fires `RoomStateEvent.Events`
  on the CLIENT (re-emitted from the room/currentState in both sync modes) with
  `(event, state, prevEvent)` — `RoomMemberEvent.PowerLevel` alone MISSES it
  when only a threshold like `state_default` changes, because no member's own
  effective level moves, so the `Events` listener (filtered to
  `m.room.power_levels`) is load-bearing. Banned users stay in
  `room.getMembers()` as `membership === "ban"` — they are not removed from the
  room — so the join/invite roster filter is what keeps them out of `members()`
  and `banned()` is a separate scan. The SDK has exactly four helpers and no
  dedicated ban-power setter (`kick`/`ban`/`unban`/`setPowerLevel`; the last
  writes the `users` override). `unban` returns membership to `leave`, so the
  user drops off `banned()` but does NOT reappear in the roster until they
  rejoin. Reka's `ContextMenuTrigger` has a `disabled` prop: when true it skips
  `event.preventDefault()`, so a row with no available actions gets the native
  context menu instead of an empty Reka popup — gate the trigger on "any action
  applies", not just the content. `room.getMember(selfId)` may be null while
  the roster is lazy — fall back to the raw `users`/`users_default` so
  `myPowerLevel` is never a lie.
- FIX — false unread badges on rooms read elsewhere (SSS only), four commits,
  each verified against the v43 source: (1) the read position is the LATER of
  the `m.fully_read` marker and the read receipt — old clients only ever wrote
  a receipt, so a missing marker used to light up the whole loaded window;
  (2) private read receipts (`m.read.private`) count too — a user on private
  receipts has no public one; both come from
  `getReadReceiptForUserId(selfId, true, type)`. (3) Space nesting is driven by
  `m.space.child` / `m.room.parent`, and the state key is the WILDCARD `"*"` —
  reading it under the child room id (or the space id) finds nothing, so every
  child looked parent-less (rooms leaked into DMs, spaces into the rail);
  `sync/requiredState.ts` owns the wildcarded required-state list now.
- VERIFIED unread trap — the SSS loop emits `ClientEvent.Sync` from
  `invokeLifecycleListeners(SlidingSyncState.Complete)` BEFORE
  `onPostExtensionsResponse`, and receipts are a PostProcess extension. So
  recomputing unread only on Sync always reads the PREVIOUS batch's receipt
  map, and a room read on another client (or just opened) keeps its stale
  badge until some later Sync happens to land. Recompute on the `m.receipt`
  events the extension re-emits as `ClientEvent.Event` too — that is the
  invalidation signal that actually covers read positions. `update()` also
  try/catches per room (one throwing accessor used to abandon every room after
  it, freezing their badges) and carries a re-entrancy guard (`onCounts` →
  `refreshRooms` → `update` used to rescan the whole list once per changed
  room — O(n²) and one stack frame per change). Dev check:
  `__tumult.client.debugUnread(true)` forces a recompute — if the numbers flip,
  the cache was stale; if they stay wrong, the recompute itself is wrong.
- DONE — slice 25: first-sync responsiveness — the room list now paints AS
  rooms arrive instead of after the whole batch. Under sliding sync the SDK
  emits `ClientEvent.Room` once per room as it enters the window, but the
  terminal `ClientEvent.Sync` does not fire until every room is processed, so
  on a large account the list stayed blank for seconds. `MatrixChatClient` now
  listens for `ClientEvent.Room` and recomputes through a new `ThrottledTask`
  (`util/throttle.ts`, trailing throttle, 120 ms) so ~100 room events cost ~8
  snapshots, not 100. The timer is deduped against `scheduleRefreshRooms` (a
  microtask pass cancels it) and cleared on both teardown paths. Measured live
  against matrix.jackg.cc (98 rooms): first paint 4.8 s → 2.4 s, full list
  unchanged (98 joined, 38 orphan DMs, 15 spaces). Covered by
  `test/throttle.test.ts` (4; 279 core unit total).
- VERIFIED slice-25 traps: the first sync is NOT main-thread bound — on a warm
  load rAF ran ~58 fps and total jank was ~380 ms (max 252 ms); the 900–2300 ms
  stalls seen on the very first load were one-time WASM compile. The ~4.3 s
  `starting → syncing` wait is SDK + network: crypto 4S bootstrap (~16
  account-data reads), the initial SSS request, and the biggest client-side
  chunk — `Room.addLiveEvents` `await`ing `fetchRoomEvent` SERIALLY for every
  edit/reaction whose parent fell outside `timeline_limit: 20` (~14 calls ≈
  1.9 s; confirmed with a runtime `fetchRoomEvent` stack hook, all frames
  `addLiveEvents`). That fetch only happens because `supportsThreads()` is true:
  `eventShouldLiveIn` short-circuits to "lives in room" and never fetches when
  threads are off, so it is the price of threads (raising `timeline_limit`
  would trade sync payload for it). No client code sits on that path — the
  `UnreadTracker` backfill burst (9 `/messages` at load) lands AFTER the sync,
  so it janks but does not delay the list.
- DONE — perf sweep after slice 25 (every item measured before landing):
  * Unread backfills spread instead of bursting: `UnreadTracker` fired one
    `paginateEventTimeline` per out-of-window room, concurrently, so a first
    sync processed hundreds of SDK events in a single frame (a 219 ms spike
    measured AFTER the room list had already painted). New
    `rooms/backfill-queue.ts` runs at most two at once, deduped by room; the
    tracker's run callback re-reads the read position first, so a backfill that
    was queued while the sync (or an earlier backfill) pulled that position
    into the window is skipped outright. Three reloads (98 rooms): the spike is
    gone (worst frame ~128 ms at paint), backfills 9 → 3–4 across two waves,
    first paint unchanged ~2.5 s. `test/backfill-queue.test.ts` (4).
  * Crypto-event security snapshots coalesced: each
    `KeyBackupStatus`/`KeysChanged`/`DevicesUpdated` ran a whole probe, and
    `querySecurityStatus` awaits `checkKeyBackupAndEnable()` — a NETWORK round
    trip — so a burst fanned out one request per event. The listener now
    schedules a 250 ms trailing `ThrottledTask`; explicit moments (start,
    `setupRecovery`, `restoreBackup`) still await `refreshSecurity()` directly.
    This account's load emits 0–2 such events (its rooms are mostly
    unencrypted), so the measured saving here is a bound, not a drop — the
    encrypted workload is what it protects.
  * Entry chunk code-split: the SDK is 1057 kB / 276 kB gzip — essentially the
    entire 996 kB entry — and it was in the entry graph only because
    `router.ts` imported `chat.ts` for its guard. The guard now answers from
    the new `@tumult/core/session` subpath (`hasStoredSession()`: a
    localStorage read, zero SDK), `main.ts` warms `import("./chat.ts")` only
    when a session is persisted, and `AppView` does the dynamic import +
    `restoreSession()`/`start()` behind a boot state (redirecting to /login if
    the stored session will not load). Production: first paint 97 ms, shell
    185 ms, entry 41 kB gzip, SDK a lazy `chat-*.js` (248 kB gzip) fetched in
    PARALLEL with the route chunk. `test/session.test.ts` (3).
  * Also stopped the presence poller on the start-failure teardown path, which
    previously only the orderly `stop()` did.
- VERIFIED perf traps: the `timeline_limit: 40` experiment was run and
  REJECTED — it halves the `fetchRoomEvent` fallback (14 → 9) but doubles the
  initial SSS payload (340 → 715 kB encoded, 1.33 → 1.58 s) and pushes first
  paint 2.4 → 3.3 s, because the sync response must land before anything
  paints while those fetches happen after paint anyway. Keep 20. Splitting the
  entry is worth it ONLY because the guard's question ("is a session stored?")
  needs no SDK; `LoginView`/`CallbackView` still import the client, so /login
  stays heavy until the OAuth login surface itself is split out. And
  `AuthStorage` used a TS parameter property — strip-only Node rejects that
  with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, which no test had ever hit because
  nothing imported `storage.ts`; exporting `hasStoredSession()` made it
  reachable, so its constructor is now erasable (as `util/throttle.ts`
  already was).

- DONE — slice 26: media correctness. Five defects, each measured before
  fixing: (1) the Download link on `m.video`/`m.audio`/`m.file` was a dead
  `mxc://` href; (2) encrypted non-image media fetched + AES-CTR decrypted a
  blob it then discarded, and because ciphertext evidences carry `file`, not
  `url`, it rendered no link at all; (3) no failure state — a failed resolve
  logged, `src` stayed null, and the row silently rendered as `<p>{{ body }}</p>`,
  i.e. looked like a text message; (4) a retry storm — failed resolutions
  were evicted, so every timeline rebuild re-fetched every permanently-missing
  image; (5) every non-image attachment went through `/thumbnail`, which is an
  image pipeline and answers 400 for formats it cannot render, so all
  video/file/audio failed with a console error by construction.
  - Core: `media/classify.ts` exports `isTerminalMediaError` (SDK-free, via a
    new `@tumult/core/media` subpath, so the renderer can gate its retry
    affordance without dragging matrix-js-sdk into the UI bundle). 4xx = the
    server's verdict (404 purged, 400 unsupported) and is remembered; network
    errors, 5xx, 408 and 429 stay retryable. `MediaResolver` gained
    `resolveDownload()` (`/_matrix/client/v1/media/download`, no size params),
    factored the shared full-bytes fetch out of the encrypted path, and
    negative-caches terminal failures (cap 500, FIFO) so a rebuild rejects
    without touching the network. Contract: additive `resolveMediaDownload(uri)`
    with fake parity.
  - UI: `MediaMessage` is now a `loading | ready | failed` state machine —
    `<img>` for `m.image`, `<video controls>` for `m.video`, `<audio controls>`
    for `m.audio`, filename + working `blob:` link with `download` for
    `m.file` (plus a Download link on video/audio); an honest "X unavailable"
    row with a Retry button only when the failure is retryable, and no console
    noise (the resolver logs once per terminal URI). `MediaDownloadKey` +
    `useMediaDownloadResolver()` provided by the shell.
  - Verified live against matrix.jackg.cc (Docker unavailable): video and audio
    both reach `readyState 4` (a 250 KB mp4 at 7.4 s; an uploaded 8 kHz WAV
    round-trips to `duration: 0.2`, proving `/download` returns the exact
    bytes); file links are `blob:` with the correct filename; 5 purged images
    in one room were requested exactly ONCE each across four in-app visits
    (the storm is gone — before, a rebuild re-fetched them all); console errors
    36 → 0.
- VERIFIED slice-26 traps: classify first, then code — resolving every mxc in
  the loaded windows showed ~60 images succeed, 17 genuinely 404
  (`M_NOT_FOUND`, purged), and EVERY `m.video`/`m.file`/`m.audio` 400
  `M_UNKNOWN` "Cannot find any thumbnails for the requested media … not a
  supported media format" at the thumbnail endpoint. The wrong-endpoint
  failures were ours, not the server's; `/download` serves the same URIs.
  `media-src` must be in the CSP explicitly: `img-src … blob:` already was,
  but with no `media-src` the directive falls back to `default-src 'self'` and
  `<video>`/`<audio>` are blocked — the attribute looked right while the media
  never loaded. `history.pushState` is a same-document navigation, so it
  reuses the OLD document's CSP (and a 304 reuses the old headers): verify
  media only after a full document load, and read the CSP back with a
  cache-busting `fetch('/?cb=…')` rather than trusting the header once.
  `--accent-primary` does not exist (only `--accent`); `MediaMessage` had been
  falling back to a hardcoded indigo for its link colour.

## Potential next slices

- Room tags / categories: `m.tag` room account data → category grouping in the
  room list (Discord-folder-style), tag editor in the settings dialog.
- Memory/perf follow-ups: idle-room unloading is DONE (slice 25 A — timeline
  feeds are evicted 30 s after their last subscriber, `edb81a5`+); the first
  sync paints progressively (slice 25, `ClientEvent.Room` + `ThrottledTask`);
  unread backfills are queued two-at-a-time and the entry chunk is code-split
  (the SDK is a lazy 248 kB gzip chunk). Still parked: windowed room loading,
  capped in-memory events, and splitting the SDK out of *`/login`* too (it
  needs a separate lightweight OAuth login surface — `LoginView`/`CallbackView`
  currently import the full client).
- SSS follow-ups (after slice 22): native SSS presence replacing the REST poll
  (the js-sdk has no presence extension yet — "not possible in sliding sync
  yet"); true SSS warm-boot (resume the sync token / show rooms offline) —
  blocked on the SDK, see the slice-22 trap note. Window growth,
  subscribe-to-open-room and window-size persistence are DONE.
- Game/custom event renderers (post-v1-UI; registered renderers namespaced
  under our domain, no timeline rewrite).
- Parked v1 non-goals: push notifications, voice/video, multi-account,
  encrypted search, Electron desktop, Flatpak.
- `org.matrix.msc4143/rtc/transports` 404s against this homeserver. Harmless:
  MatrixRTC discovery the SDK probes optimistically, and voice/video is a v1
  non-goal.
- MEDIA SEND (fixed in slice 27): `matrix.uploadContent()` is XHR-based with no
  401 refresh-retry, so an upload that races a token refresh (MAS rotates the
  refresh token) fails with `[401] Token is not active` on
  `/_matrix/media/v3/upload` and lands dead-ended at the caller. Routed all three
  upload call sites (media, room avatar, profile avatar) through a shared core
  wrapper gated on `httpStatus === 401` / `M_UNKNOWN_TOKEN`; surfaced through the
  failed-send path.
