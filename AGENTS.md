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
  namespaced under our domain. No timeline rewrite. The registry gates
  decryption/status in `TimelineRow` BEFORE resolution, and is owned per-shell
  via provide/inject — never a singleton.
- Framework: Vue 3 + plain Vite (not Nuxt — Nuxt's SSR/server routes are
  unused; plain workspace expresses core/ui/theme separation). Behavior/a11y
  via Reka UI (headless, WAI-ARIA).
  Reka has NO general-purpose list virtualizer (only Combobox/Listbox/Tree
  virtualize) — the timeline uses `@tanstack/vue-virtual`.
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
- **Values live in the theme JSON, never in code.** The registry
  (`src/registry/`) is structure only: names, tiers, kinds, and `var(--…)`
  references. Primitives carry no `value` at all, so a literal in a component or
  the registry is a bug; `packages/theme/test/coverage.test.ts` is the gate.
  The built-in theme's values are `packages/theme/themes/default.json`;
  `compileThemes` refuses to build unless that document covers every registry
  token (a missing token is a build error, not a silent blank).
- **The built-in document is the inheritance base.** An installed theme is a
  sparse document over it — the editor's placeholders and the validator's
  effective value both read `defaults` from that same JSON, so "not set" means
  "the built-in value applies". `emitBaseCss` therefore writes the built-in
  `tokens` to `:root` *and* its `modes`/`densities` maps to
  `:root[data-theme][data-mode="…"]` (attribute-presence, not
  `[data-theme="default"]`) — otherwise installing any accent theme would drop
  light mode, because the built-in light map is what flips the surfaces. The
  extra attribute is load-bearing: it makes an inherited mode block outrank a
  theme's own *base* block, so a dark value cannot bleed into light mode, while
  a theme's own `[data-theme="x"][data-mode="light"]` ties and wins on order
  (the store appends its `<style>` after the sheet).
- Modes (`modes`) and densities (`densities`) are the same mechanism: an
  optional per-name override map in the theme JSON, validated exactly like the
  base `tokens` (the name lands in a selector, so it is checked), emitted as
  `:root[data-theme][data-mode]` / `:root[data-theme][data-density]` blocks
  after the base. The base mode (`dark`) and base density (`cozy`) are the
  theme's unmodified `tokens` map, so they mean NO attribute. Density blocks
  come last so they win a same-specificity tie with a mode. The selection lives
  in the one `tumult.themes` state (`ThemeStore`) and is applied at boot.
  Virtualized rows (`TimelineViewport`, `MembersPane`) estimate height in TS, so
  they carry a per-density pixel delta and re-measure rendered rows; the CSS is
  the source of truth, the estimate is a hint. Modes stay *theme-local*: a theme
  only offers the modes it declares (`activeModes`/`normalizeMode`), and the
  built-in theme declares `light` (dark = mint brand, light = a darker
  stormyTeal, so white stays readable on the accent).
- Colour values may be authored in any CSS Color 4 space (`oklch()` etc.); the
  validator's grammar accepts them and `packages/ui/src/theme/color.ts`
  (`toHexColor`) converts OKLab/OKLCH *and* CIELAB for pickers. Note that a
  computed colour serializes in the space it was authored in, so anything
  parsing `getComputedStyle` output (e.g. the browser smoke test's luminance
  gate) must not assume `rgb()`.
- Accent gallery: `apps/web/public/themes/{index.json,<id>.json}` ship as data
  (index carries title/blurb/swatch only, never tokens; documents are fetched
  per install). The seam is `ThemeControls.loadGallery()`/`installGallery()` and
  the controller owns the fetch, so `@tumult/ui` stays fetch-free.
  `packages/theme/test/gallery.test.ts` pins index ↔ documents ↔ validator.
- Figtree is self-hosted (`apps/web/public/fonts/`, preload + `fonts.css`,
  `font-src 'self'` in the dev CSP; OFL shipped). No third-party font request.
- JSON is the default safe path: validate → emit CSS vars. Raw CSS is
  explicit advanced opt-in (arbitrary URLs, keep strict CSP).
- Document defaults belong to the app base (`apps/web/src/styles.css`), not to
  `@tumult/theme`'s `base.css` (which defines token *values* only): the one
  global reset is a `box-sizing: border-box` floor, written by hand — no
  vendored reset sheet, which would inject hardcoded values the token gate
  exists to keep out.
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

- **Where truth lives:** `packages/core/src/contract.ts` is the UI↔data boundary, `AGENTS.md` is repo ops + verified Matrix traps. Reference both rather than duplicating. Author-facing references: `docs/themes.md` (theme documents + loader), the generated `docs/tokens.md` + `docs/theme.schema.json` (emitted by the theme build, guarded by `packages/theme/test/docs.test.ts`), and `docs/plugins.md` (extension API for authors + hosts, guarded by `packages/ui/test/docs.test.ts`).
- **Stack pins:** Vue 3 + Vite (not Nuxt), Reka headless, `@tanstack/vue-virtual`, TypeScript 5.x (vue-tsc compatible), `rewriteRelativeImportExtensions` on for packages / off for `apps/web`, `optimizeDeps.exclude` must list `@matrix-org/matrix-sdk-crypto-wasm` and it is an explicit dependency of `apps/web`.
- **Invariants to preserve:** one `ChatClient` per renderer, recompute-not-patch, chrome-vs-panes (`inert` + 0-width tracks), per-shell registry via provide/inject (never a module singleton), use whole-statement `import type` in SFCs (not inline `type` specifiers), CSP must allow `'wasm-unsafe-eval'` and `media-src blob:`, hover affordances in the virtualized timeline are out-of-flow (`.tumult-row-actions`, absolutely positioned at the row's top-right) — an in-flow hover control grows the row and shifts every message under the pointer.
- **Theme v1 baseline:** registry (structure only) in `packages/theme/src/registry/`, compiler/validator/loader/store in `packages/theme/src/`, the built-in theme's *values* in `packages/theme/themes/default.json` (the inheritance base, completeness enforced by `compileThemes`), scoped on `:root[data-theme="name"]`; accent gallery data in `apps/web/public/themes/`, self-hosted Figtree in `apps/web/public/fonts/`. The node-only build lives in `packages/theme/src/build/` (`cli.ts` = `compileThemes()` → `dist/themes/*.css` **and** `emitDocs()` → `docs/tokens.md` + `docs/theme.schema.json`); `compile.ts` is a side-effect-free library (no import-time self-exec). Changing the registry or a built-in value means re-running `pnpm --filter @tumult/theme build` and committing the regenerated docs — `packages/theme/test/docs.test.ts` fails on drift.
- **Test conventions:** use `node --test "test/**/*.test.ts"` (not `node --test <dir>`), stub via SDK enums (not hand-typed strings), integration tests via Docker Synapse (`tests/synapse/`, `packages/core/test-integration/`) — Docker may be unavailable; some integration paths are written but unverified. The browser smoke test (`pnpm --filter @tumult/web test:browser`) needs Firefox via `playwright install firefox`; on macOS 27 it fails with "Could not find profile folder" unless `CFFIXED_USER_HOME` points at an EXISTING fresh dir (TCC blocks Firefox's shared app-data lookup; playwright#42768) — VERIFIED working: `mkdir -p ~/.cache/tumult-ff-home && CFFIXED_USER_HOME=~/.cache/tumult-ff-home pnpm --filter @tumult/web test:browser` (27 pass). It is the only end-to-end check of the token pipeline (theme install, mode/density flip, login font), so run it when theme CSS or the auth surface changes.

## Verified traps from build-out

Hard-won SDK/browser behavior, each verified against the SDK source or a real
homeserver. A trap listed here has shipped broken at least once.

### Sliding sync (MSC4186)

- `SlidingSync`'s third ctor arg is a ROOM SUBSCRIPTION
  (`{ timeline_limit, required_state }`), not a list — a list-shaped object is
  silently ignored. Each range must be a range ON a list; a separate list per
  range is not window growth.
- SSS warm-boot is blocked in v43: `sliding-sync.js` keeps `pos` in a local
  inside `start()` and never calls `setSyncToken`, and `SlidingSyncSdk` only
  emits `Prepared` after the first network response (`fromCache: false`) — so
  persisting the window restores its SIZE, not offline rooms or a resumed token.
- The SSS loop emits `ClientEvent.Sync` from
  `invokeLifecycleListeners(SlidingSyncState.Complete)` BEFORE
  `onPostExtensionsResponse`, and receipts are a PostProcess extension — so
  recomputing unread only on Sync reads the PREVIOUS batch's receipt map and a
  room read on another client keeps its stale badge. Recompute on the `m.receipt`
  events the extension re-emits as `ClientEvent.Event` too.
- `tsc` catches more than `node --test` here: strip-only Node ignores
  `readonly`, so assigning to a readonly field runs fine. Always run
  `pnpm typecheck`, not just tests.

### Unread & read receipts

- `sendReadReceipt` throws "Cannot set read receipt to a pending event" — and
  the live tail is usually our own local echo, so skip pending events.
- The read position is the LATER of the `m.fully_read` marker and the read
  receipt (old clients only ever wrote a receipt, so a missing marker used to
  light up the whole loaded window).
- Private receipts (`m.read.private`) count too; both come from
  `getReadReceiptForUserId(selfId, true, type)`.
- Space nesting is driven by `m.space.child` / `m.room.parent`, and the state
  key is the WILDCARD `"*"` — reading it under the child room id (or the space
  id) finds nothing, so every child looks parent-less (rooms leak into DMs,
  spaces into the rail). `sync/requiredState.ts` owns the wildcarded list.
- `UnreadTracker.update()` try/catches per room (one throwing accessor used to
  freeze every room after it) and guards re-entrancy. Dev check:

  `__tumult.client.debugUnread(true)` forces a recompute — if the numbers flip,
  the cache was stale; if they stay wrong, the recompute itself is wrong.

### Relations, replies & threads

- `getRelation()` reads the cleartext `m.relates_to`, while `getType()` says
  `m.room.encrypted` until decryption — hide reaction/edit rows by WIRE relation.
- `getRelation()` returns null for a plain reply (`isRelation()` requires a
  `rel_type`); read `m.relates_to.m.in_reply_to.event_id` directly.
- EVERY thread message carries `m.in_reply_to` (`addThreadRelationIfNeeded` falls
  back with `is_falling_back: true` for unthreaded clients) — only bare replies
  or `is_falling_back: false` count as quotes.
- Read relations from `getContent()` (decrypted on E2EE), and run quote
  enrichment AFTER edits apply so quotes track edited bodies.
- `threadSupport` is a `startClient()` option (`IStartClientOpts`) — on
  `createClient` it is silently ignored and NO `Thread` objects exist. Thread
  events fire on the `Room`, never the client, via the `ThreadEvent` enum (whose
  VALUES are `"Thread.update"` etc., not the member names). `thread.length`
  already excludes the root; participation counts authoring the root. Thread
  timelines also need `RoomEvent.LocalEchoUpdated` and
  `MatrixEventEvent.Decrypted`.
- `sameTimeline` must compare body AND `redacted`: a body-only change (a
  redaction tombstone) was otherwise discarded as unchanged and never published.
- `m.room.redaction` events must be filtered out of the timeline (the target
  tombstones via `mapEvent`; the redaction event itself renders a fallback row).
  Synapse quirk: `.../redact/{event}/{txn}` 405s; the txn-less route works.
- `m.space.child` with no `via` is a REMOVED link, not a live one — write
  `{ via: [domain] }` on child AND parent.
- The client's typing feed must subscribe to the tracker (published once, the
  indicator never showed in-app). Verifier listeners bind by verifier identity
  (a request can jump Requested → Started). A failed `start()` must detach
  trackers.
- Stubs that emit hand-typed event-name strings agree with the code's mistakes —
  dispatch through SDK enums, and keep a Synapse round-trip for anything
  event-driven.

### Search & read markers

- There is NO `sendReadMarker`: the API is
  `setRoomReadMarkers(roomId, rmEventId, rrEvent)` (it throws on pending events,
  hence `latestReceiptable` first).
- `WritableAccountDataEvents` EXCLUDES `m.fully_read` (so `setAccountData` can't
  set the marker); `m.direct` IS writable.
- The search body has NO `page_size` (page size lives in `filter.limit`, Synapse
  defaults 10) and `IEventSearchOpts` has no batch input — pagination is raw
  `matrix.search({ body, next_batch })` (query string) +
  `processRoomEventsSearch` on a fresh accumulator. Server search matches
  cleartext only: encrypted rooms return nothing (not an error).
- `getEventTimeline` needs `timelineSupport: true` (we don't set it), so `jumpTo`
  is a bounded `loadMore()` loop that resolves `false` at the cap — callers must
  not scroll on `false`.

### Rooms, members & moderation

- Creators resolve the roomId BEFORE the room is in the `rooms` feed; the shell
  waits for presence (5 s, resolves regardless) and the cleanup watcher is the
  backstop for anything that slips through.
- Synapse's user directory needs `search_all_users` and only returns people you
  share a room with — the picker's raw `@user:server` fallback is load-bearing.
- Spaces never encrypt (the checkbox only appears on channels/DMs).
- `lazyLoadMembers` is a `startClient()` option (ignored on `createClient`;
  guests force it off). The first sync ships a partial roster and
  `room.loadMembersIfNeeded()` is the only route to completeness; the in-flight
  `membersPromise` CLEARS on rejection, so a failed load must surface + retry,
  not swallow.
- Presence must be committed on the NEXT Sync, not on receipt:
  `IndexedDBStore.startup()` and the cached first-sync replay call
  `setPresenceEvent()` with a fresh `lastPresenceTs`, so trusting it republishes
  a days-old "online" every boot.
- The SDK re-emits `RoomMemberEvent.Name/Typing/PowerLevel/Membership` on the
  CLIENT with `(event, member)` args and NO roomId — read `member.roomId`. A
  profile rename lands as an `m.room.member` Name event only for users who
  JOINED (renaming an invite-only user never propagates on Synapse).
- `profile` is a plain field that exists before `start()`, while
  `members()`/`loadMembers()` throw before it.
- `Room` has `getJoinRule()` / `getHistoryVisibility()` / `getCanonicalAlias()`
  and NO `setRoomAvatarUrl` / `setRoomCanonicalAlias` — both are raw
  `sendStateEvent`, and an avatar must be `uploadContent`'d first. `JoinRule` /
  `HistoryVisibility` are string ENUMS (convert both ways). Removing a canonical
  alias means an event with `alias` absent (build `{}` conditionally — a literal
  `{ alias: undefined }` is an exactOptionalPropertyTypes error and JSON-drops
  the key anyway). `getJoinRule()` can throw on incomplete state. The settings UI
  offers no "restricted" join rule (it needs an `allow` list room settings can't
  express).
- A power-level change fires `RoomStateEvent.Events` on the CLIENT with
  `(event, state, prevEvent)`; `RoomMemberEvent.PowerLevel` alone MISSES a
  threshold-only change (e.g. `state_default`). Banned users stay in
  `room.getMembers()` as `membership === "ban"`. `unban` returns membership to
  `leave` (they drop off `banned()` but not back into the roster). The SDK has
  exactly four helpers (`kick`/`ban`/`unban`/`setPowerLevel`) and no ban-power
  setter. `room.getMember(selfId)` may be null while the roster is lazy — fall
  back to raw `users`/`users_default`.

### Reka (headless UI)

- Two nested `as-child` triggers on ONE element break attribute merging (the
  context-menu trigger wraps the inner `<a>`, the tooltip trigger stays on the
  `<li>`).
- Roots render slot only (safe inside `<ul>`/`<li>`), but their content needs a
  portal (Teleport → `body`), and `DialogContent` unmounts on close — every
  dialog resets its refs in an `open` watcher AND the parent drives `open`.
- `ContextMenuTrigger`'s `disabled` prop skips `event.preventDefault()`, so a row
  with no available actions gets the native context menu — gate the trigger on
  "any action applies", not just on the content.
- The members pane virtualizes like the timeline (plain overflow scroller, header
  rows as virtual items, `as Row` casts — vue-tsc does not narrow `rows[v.index]`
  across `v-if`).

### Media & avatars

- Classify first, then code: `/thumbnail` is an image pipeline and answers 400
  "not a supported media format" for video/file/audio by construction;
  `/_matrix/client/v1/media/download` serves the same URIs as exact bytes. 4xx is
  the server's verdict (remembered); network/5xx/408/429 stay retryable.
- `media-src` must be named in the CSP explicitly — with no `media-src`,
  `<video>`/`<audio>` fall back to `default-src 'self'` and are blocked while the
  attribute looks right.
- `history.pushState` is a same-document navigation, so it reuses the OLD
  document's CSP (a 304 reuses old headers) — verify media only after a full
  document load, and read the CSP back with a cache-busting `fetch('/?cb=…')`.
- `RoomSummary.avatarUrl` is the raw `mxc://`; `resolveMedia` / `resolveDownload`
  fetch through `client.http.authedRequest` (SDK token refresh, unlike a bare
  fetch) and return `blob:` URLs, revoked on stop. An `<img>` MUST be sized to
  its box (`object-fit: cover`) — Synapse snaps thumbnails and an unsized image
  renders cropped/zoomed.
- `matrix.uploadContent()` is XHR-based with no 401 refresh-retry, so an upload
  racing a token refresh fails `[401] Token is not active`. All three upload
  sites (media, room avatar, profile avatar) go through one core wrapper gated on
  `httpStatus === 401` / `M_UNKNOWN_TOKEN`.
- `--accent-primary` does not exist (only `--accent`).

### Crypto

- `isEncrypted()` stays true after decryption — detect the pending state via
  `clearEvent` / `MatrixEventEvent.Decrypted`, not by type.
- Restore speaks 4S: unlock via the `getSecretStorageKey` callback +
  `loadSessionBackupPrivateKeyFromSecretStorage` (a direct backup-key store is
  kept as fallback for backups made elsewhere). Restore then verifies the device:
  when 4S holds cross-signing keys the device lacks, `bootstrapCrossSigning({})`
  imports them and self-signs (skipped honestly when 4S has none or the device
  already has them). The held key must span BOTH halves — backup unlock AND the
  cross-signing import — cleared once at the very end; an early clear made the
  import silently fail (decryption worked, verification didn't).
- SAS: `Verifier.verify()` calls `accept()` internally, so a manual `accept()`
  double-accepts. `getDevices()` before `startVerification()` populates the
  device cache. `requestOwnUserVerification()` broadcasts to all own devices, so
  no `otherDeviceId` exists until the receiver sends ready — wait for Ready
  (120 s, cancellable); receivers never send ready; incoming accepts only while
  Requested.
- No crypto in Node: verification / 4S paths are manual against matrix.jackg.cc.

### Performance

- The first sync is NOT main-thread bound: the 900–2300 ms stalls on a cold load
  are one-time WASM compile. The real client-side chunk is `Room.addLiveEvents`
  `await`ing `fetchRoomEvent` SERIALLY for every edit/reaction whose parent fell
  outside `timeline_limit: 20` — the price of `supportsThreads()`.
- `timeline_limit: 40` was measured and REJECTED: it halves the fallback fetches
  but doubles the initial SSS payload (340 → 715 kB) and pushes first paint
  2.4 → 3.3 s. Keep 20.
- `AuthStorage` used a TS parameter property — strip-only Node rejects that with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; core classes keep erasable constructors.

### Theme

- Installing any accent theme used to kill light mode: the built-in mode/density
  maps must be emitted on the *attribute-presence* selector
  `:root[data-theme][data-mode="…"]` (0,2,1) so a theme's own base block (0,1,1)
  cannot bleed dark values into light, while a theme's own
  `[data-theme="x"][data-mode]` ties on specificity and wins on order.
- A computed colour serializes in the space it was authored in — the theme is
  oklch, so `getComputedStyle(…).backgroundColor` returns `oklch(…)`, never
  `rgb()`.
- `--accent` is NOT mode-independent (it flips in light mode).
- `.tumult-appearance-row` is a shared class (installed + gallery rows) — assert
  on `[data-theme-name]`.
- Self-hosted Figtree is the only font request (`font-src 'self'`).

### Test & module tooling

- Deep SDK VALUE imports need the `.js` extension for Node strip-mode — tsc and
  Vite forgive extensionless deep imports, only `node --test` catches it (this
  bit `matrix-js-sdk/lib/@types/search`).
- `node --test <dir>` broke on Node 25 (it treats the dir as a module) — always
  glob with `"test/**/*.test.ts"`.

### Known harmless

- `org.matrix.msc4143/rtc/transports` 404s against this homeserver — MatrixRTC
  discovery the SDK probes optimistically; voice/video is a v1 non-goal.
