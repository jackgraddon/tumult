---
title: "Matrix SDK in Tauri client development"
source: "https://claude.ai/chat/b1204d9a-cbbc-47d1-ab04-1ab0a7104ab4"
model: "claude-sonnet-5-5"
exported: 2026-09-30
---

# Human — Sep 29, 2026, 7:31 PM

Could you research how the Matrix SDK works in the context of creating a Tauri client? I want a deep understanding of how it works.

# Claude — Sep 29, 2026, 7:32 PM

# How the Matrix SDK works in a Tauri client

There are two SDKs and two places they can run. Everything else follows from that choice.

## The architectural fork

**Option A: matrix-js-sdk in the webview.** This is what Tumult uses. The SDK runs in the frontend and Tauri is a native shell around it. Weave is a public example. It's a Tauri 2 client built on matrix-js-sdk with Rust crypto compiled to WASM, where Tauri's Rust side handles only notifications, the tray, the OS keychain and a persistent store. Message cache, sync tokens and crypto state all live in IndexedDB, managed by the SDK.

**Option B: matrix-rust-sdk in the Tauri backend.** The Rust process owns the client, sync and storage, and the UI talks to it over IPC. tauri-plugin-matrix-svelte follows this pattern, wrapping matrix-rust-sdk behind an adapter library, exposing room state to the frontend through reactive stores, and keeping the session in the OS keychain. The trade-off is that you get the SDK Element X uses, including its higher-level UI crates, but you have to design and serialize the IPC boundary yourself.

## How matrix-js-sdk works

- **Object model:** The SDK gives you a high-level object model over the Client-Server API and handles synchronization and state management. `MatrixClient` owns `Room` objects, which own timelines, state and members. The SDK mutates these objects in place and notifies you via events (`RoomEvent.Timeline`, `ClientEvent.Sync`, and so on). Treat those events as invalidation signals, not as data. In Vue that usually means a `shallowRef` plus a version counter, or snapshotting the fields you need into your own store when an event fires.
- **Stores:** By default the client uses a MemoryStore for received events. For persistence, `IndexedDBStore` caches sync data so restarts don't need a full initial sync. The crypto store is separate.
- **Crypto:** End-to-end encryption is built on WebAssembly bindings of the Rust matrix-sdk-crypto library. You enable it with `initRustCrypto()`, and by default it uses the browser's IndexedDB as its crypto store. The options let you set a database name prefix (default `matrix-js-sdk`), encrypt the store with a raw key or a password, or use an in-memory store instead. The `CryptoApi` from `getCrypto()` is the entry point for verification, key backup and secret storage.

**A crypto store gotcha:** The Rust crypto store holds a single account. Logging in as a different user against the same database name throws a mismatch error, because the name is fixed by default. If you plan multi-account support, or just want clean logout, give each user or device its own `cryptoDatabasePrefix` and delete the database on logout.

## Sync: /sync v2 vs. simplified sliding sync

Classic `/sync` sends a large initial payload and then incremental long-polls. Sliding sync lets the client ask for a window of rooms and receive only what it needs.

- Simplified Sliding Sync (MSC4186) has been native in Synapse since 1.114, so no proxy is needed. The old proxy was decommissioned and Element dropped the older MSC3575 client support in January 2025.
- It's implemented in both matrix-rust-sdk and matrix-js-sdk. In Element Web, though, it was introduced as a labs option that fails fast on servers running the old proxy. I couldn't confirm how mature the js-sdk sliding sync path is for a from-scratch client today, so check the js-sdk `SlidingSync` class and its open issues before committing to it.
- On the Rust side, `RoomListService` is the reference design. It's a state machine over one sliding sync list that starts with a small selective range for fast first paint, then grows to load the remaining rooms in the background. Rooms in the viewport get explicit subscriptions, and latest-event previews are computed as sync responses arrive so the list re-sorts correctly.

If your homeserver is Synapse (recent), sliding sync is available. Starting on classic sync and swapping later is a legitimate path if your sync layer is properly abstracted.

## Auth with MAS/OIDC in Tauri

Native OIDC (MSC3861), dynamic client registration (MSC2966), token revocation (MSC4254) and account-management deep-linking (MSC4191) are all merged into the spec. The js-sdk flow is:

1. Discover the issuer's metadata via `discoverAndValidateOIDCIssuerWellKnown`.
2. Register dynamically with `registerOidcClient`, which only honors URIs that share the `client_uri` base.
3. Build the authorization URL with `generateOidcAuthorizationUrl`. The scope encodes the API and a device ID.
4. Open the URL and receive the redirect.
5. Call `completeAuthorizationCodeGrant(code, state)` to exchange the code for tokens.

The Tauri-specific problem is step 4. The SDK's OIDC helper stores the in-flight state in browser storage when it starts the flow, so it has to be the same webview context that finishes it. Options:

- **Deep link plus system browser.** Register a custom scheme with Tauri's deep-link plugin and open the login page with the opener plugin. Note that `client_uri` and redirect URI rules from step 2 constrain which schemes MAS will accept, so test this against your MAS config early.
- **Do the exchange in Rust.** RapidMX does PKCE in the Rust process via a deep link so tokens never enter the webview's JS context. That's a stronger security posture, but it means you can't use the js-sdk helpers for the grant and must hand the resulting tokens to the SDK yourself.
- For token refresh, the js-sdk provides an `OidcTokenRefresher`. Store refresh tokens in the OS keychain rather than in localStorage. Weave, for example, keeps recovery keys there via the keyring plugin.

## Tauri-specific pitfalls

- **CSP:** If your frontend uses WebAssembly, Tauri's CSP needs `'wasm-unsafe-eval'` in `script-src`. The crypto WASM depends on this.
- **Bundling the WASM:** Weave needed the WASM file served from `public/` plus Vite's wasm, top-level-await and Node-polyfill plugins. Expect some Vite configuration work in a monorepo.
- **Origin and CORS:** In production the webview origin is `tauri://localhost`, and webviews enforce CORS like browsers. Matrix homeservers normally send permissive CORS headers, so plain `fetch` usually works, but it's a common source of "works in dev, fails in build." The official fix is `@tauri-apps/plugin-http`, which routes requests through Rust. As far as I know, `createClient` accepts a custom `fetchFn`, which is how you'd plug that in; verify that in the current typings.
- **Storage durability:** I haven't verified how each platform's webview (WKWebView on macOS, WebView2, WebKitGTK) treats IndexedDB eviction and quota. Since losing the crypto store means losing device keys, test what happens across restarts and OS updates, and make sure secret storage/key backup is set up so a wiped store is recoverable.

## Where I'd land

For a Vue SPA that also targets web, Option A is the natural fit. One codebase runs in both places, and the SDK is exercised by Element Web daily. The rough edges are IndexedDB durability and the OIDC redirect, and both are manageable. Option B is worth it if you later want native-grade performance, on-disk SQLite storage, or mobile targets. Keep the Matrix code behind your own service interface (which you already have with the anti-corruption sync layer) so that a swap stays possible.

Areas I'd verify against the current js-sdk source before building on them: the sliding sync API surface, the exact `IndexedDBStore` worker options, and the OIDC state-storage behavior under a deep-link flow. If you tell me which of these matters most, I can dig into that one further.

# Human — Sep 29, 2026, 8:16 PM

Treat it as if we are starting from scratch, no Tumult. How do other clients work? Cinny, Element, etc. They all have pretty great cross platform desktop support.

# Claude — Sep 29, 2026, 8:17 PM

# How the established Matrix clients are built

The clients with good cross-platform support fall into three families. Each made a different bet on where the Matrix logic lives.

| Family | Examples | SDK and crypto | Local storage |
|---|---|---|---|
| Web app in a native shell | Element Desktop, Cinny Desktop | matrix-js-sdk with Rust crypto as WASM | Browser IndexedDB, plus native add-ons |
| Shared Rust core, native UI per platform | Element X (iOS and Android) | matrix-rust-sdk via FFI bindings | SQLite via the Rust SDK |
| Own SDK per framework | FluffyChat (Flutter), Nheko (Qt/C++) | matrix-dart-sdk with vodozemac; mtxclient with libolm | SQLCipher; LMDB |

## Family 1: web app in a shell

**Element Desktop** is an Electron wrapper around Element Web. It's a small codebase, roughly 1,700 lines, that adds desktop integrations, native module support and packaging. The web app is delivered as a bundled asar archive with integrity checking. The notable native pieces are:

- **Seshat:** A Rust/SQLCipher module that indexes and searches encrypted rooms locally. This is a real gap in a pure-web design. Once messages are end-to-end encrypted, the server can't search them, and the browser has nothing comparable to a proper full-text index.
- **Keychain access:** Element used keytar, which is deprecated upstream, and has been migrating to Electron's safeStorage.

**Cinny Desktop** is even thinner. It wraps the Cinny web client, included as a git submodule, in Tauri. Its dependency list shows what a real Tauri chat client ends up needing: plugins for HTTP, notifications, the updater, global shortcuts, clipboard, filesystem and process control. Its CSP explicitly allows the ws, wss and tauri protocols. The HTTP plugin is the same CORS-bypass mechanism I described earlier. Cinny's original motivation for Tauri was smaller app size without bundling Chromium. Its README has long said the project was replacing matrix-js-sdk with its own SDK, but that text looks old and I couldn't confirm whether it ever happened, so treat it as unverified.

The lesson from both: they are the same web app everywhere, and the native layer only covers the things a webview can't do well: notifications, tray, secure secret storage, updates, deep links, and search over encrypted history.

## Family 2: shared Rust core

Element X was a total rewrite on the Rust SDK. It reaches the SDK through an FFI layer packaged as a Swift package, and Android uses the same SDK, so the point is code sharing across platforms. The bindings are generated with UniFFI for Swift and Kotlin. The Rust SDK also ships crypto-only bindings and separate WASM and Node bindings for the crypto crate.

Two practical notes:

- UniFFI serializes values across the boundary, so a chatty API surface has a cost. Design coarse-grained calls and stream updates, as the SDK's room-list and timeline APIs do.
- The Rust SDK is travelling toward the browser too. The SDK itself compiles to WASM targets, and at a hackathon a team built a rebooted Element Web on it in three days. The full FFI bindings for WASM depend on UniFFI work that was in progress, so I'd treat that as promising rather than production-ready.

A striking data point: a Sailfish OS client bundles the entire Rust stack statically, including SDK, vodozemac and SQLite, because the platform has no usable system libraries. It comes out around 48 MB versus about 100 MB for Element X, so the core really is portable.

## Family 3: own SDK per framework

- **FluffyChat** uses Flutter and the Dart SDK, with vodozemac (the Rust-based replacement for libolm) plus OpenSSL for E2EE. Its desktop and mobile share one SQLCipher database accessed over FFI. A later release added a fallback to an unencrypted database on Linux when no keyring is available, which is a good reminder that "store the DB key in the OS keychain" has platform edge cases.
- **Nheko** is native Qt/C++20 on mtxclient, libolm and LMDB, with Qt keychain for secrets. It gives the most native feel but has the heaviest build and dependency story.
- I believe Fractal (GTK, Rust) also builds on matrix-rust-sdk, but I didn't verify it.

## Patterns worth copying

1. **Never hand-roll crypto.** Every client reuses a shared implementation: WASM for the Rust crypto crate in JS, vodozemac in Dart, libolm in C++.
2. **Secrets go in the OS keychain, and the database key wraps the data.** Everyone ends up here (keytar or safeStorage, Qt keychain, keyring plugins). Plan the fallback for Linux without a keyring.
3. **Searching encrypted history needs a native index.** Element's answer is Seshat. In a Tauri app the equivalent would be SQLite FTS5 over SQLCipher in Rust. RapidMX's Tauri client, for instance, uses a native SQLCipher + FTS5 schema.
4. **OAuth returns via a custom URL scheme or a loopback address, and delivery differs by platform.** In Electron, macOS raises an open-url event while Windows and Linux forward the URL through a second-instance launch. Tauri's deep-link plugin has the same class of platform differences, so test cold start and already-running paths on every OS.
5. **Enforce a single instance early.** Deep links, the tray and crypto store locking all assume it.

## What I'd do starting from scratch

If your UI is web-first and you want desktop as a second target, use Family 1: matrix-js-sdk in the webview plus a deliberately thin Tauri layer. Element and Cinny show it scales, and one codebase covers web and desktop. Plan the native pieces up front: keychain, tray and notifications, updater, deep links, and eventually a Rust search index. One trade-off Tauri has versus Electron is that it uses each OS's own webview rather than a bundled Chromium. That saves size, but it means rendering, IndexedDB and WASM behavior can differ across macOS, Windows and especially Linux. I'm going from general knowledge on that difference, not a source, so test on all three early.

If you're targeting mobile with real native UI, or you want SQLite storage and an SDK maintained by the protocol's core team, Family 2 is the stronger long-term choice. The cost is designing an IPC or FFI boundary and doing the UI work per platform. Keeping your own thin interface between UI and SDK keeps that option open either way.

I didn't find Element Desktop's specific OIDC redirect handling, so I can't tell you how it does it. If you want, I can dig into that or into the Rust-side search index next.

# Human — Sep 29, 2026, 8:27 PM

I am thinking web client wrapped in some sort of desktop app, doesnt need to be Tauri. I am aiming for a Discord style replacement, and it uses Electron as well, but I think Electron is a bit more usage heavy than I want.

# Claude — Sep 29, 2026, 8:27 PM

# Electron vs. Tauri for a Discord-style client

For a Discord replacement, voice, video and screen sharing decide the shell choice more than idle RAM does. Those features run through WebRTC, and WebRTC is where system-webview shells (Tauri's default) have historically been weakest.

## The RAM gap is probably smaller than the benchmarks suggest

Headline comparisons show a large gap. One September 2026 comparison has a single-window Tauri app idling at 42 MB versus 168 MB for Electron 43. Those are near-empty apps, though. Even the same source concedes that a poorly optimized Tauri app can underperform a well-optimized Electron one.

In a chat client, most memory goes to the renderer: the DOM, decoded images, the crypto WASM, IndexedDB caches and the WebRTC stack. That cost exists under either shell. I'd expect a real saving from a system webview, but well below 75%. That's my inference, not a measurement, so measure it on your own app before letting it drive the decision.

## What the system webview costs you for calls

- **Windows:** WebView2 is Chromium-based, so this is the least risky platform.
- **macOS:** Tauri uses WKWebView. Reports from earlier years show `getDisplayMedia` being denied outright in Tauri because there was no permission dialog. Later status notes from a wry issue say `getUserMedia` prompted twice and the screen picker offered screens only. Those threads are one to three years old, so retest against current macOS and wry.
- **Linux:** WebKitGTK is the weak spot. A 2023 thread had to build WebKitGTK from source to get WebRTC working, and a September 2026 project note still describes WebRTC there as an upstream limitation. Separately, a long-running wry thread has contributors saying Linux performance is painful enough that they regularly discuss dropping Tauri. Treat Linux as the platform that might not work, not one that merely needs polish.

The closest real-world case is Sable, a Cinny-based Matrix client with MatrixRTC calls. It moved from Electron to Tauri, and there's an open issue where joining a voice room hangs in the Tauri app on Linux while the web client and the old Electron app work fine. Its Tauri builds can use either the system webview or a bundled Chromium (CEF). An unofficial Electron wrapper for it also exists.

## Tauri with CEF is an option but young

Tauri has an official CEF runtime in its 3.0 alpha, tracking Chromium 151. That gets you Chromium's consistent WebRTC behavior with a Rust main process instead of Node. Two caveats:

- The installer is no longer tiny, because you're bundling Chromium again. The savings come from dropping Node and a leaner native layer, not from dropping the browser.
- It's alpha and still shows rough edges. A Linux first-run crash was fixed only in early September, and Sable's CEF build has an open issue where the mic permission prompt returns on every launch and only one microphone appears. Sable's standalone port also notes that deep-link relaunch URLs are dropped on Linux and Windows, which matters for OIDC redirects.

## Your realistic options

| Option | Weight | WebRTC risk | Maturity |
|---|---|---|---|
| Electron | Heaviest | Lowest | Highest. Discord itself uses it. |
| Tauri, system webview | Lightest | Real on Linux, some on macOS | Stable, but voice is the gap |
| Tauri + CEF | Medium | Low (Chromium) | Alpha |

## What I'd do

1. **Keep the web app shell-agnostic.** Put every native call (notifications, tray, keychain, deep links, updater) behind one interface. Sable's ability to build the same app on two runtimes shows why this pays off.
2. **Spike voice before committing.** Run a LiveKit test room in each shell on all three OSes. Check mic and camera permissions, device switching, screen share with a picker and system audio, permission persistence across restarts, and the crypto WASM plus IndexedDB surviving relaunches. This is a day or two of work and settles the question with facts.
3. **Default to Tauri and be ready to switch.** If Windows and macOS pass and Linux fails, ship CEF on Linux only (Sable's build switch suggests this is workable, but I haven't seen it done). If calls are central and you can't accept a Linux gap, Electron is the safe choice, and tuned properly its memory cost may be closer to Tauri's than the benchmarks imply.

If calls are out of scope for v1, plain Tauri is the easiest way to start lean. Just keep the interface from step 1 so the runtime can change when voice arrives.

# Human — Sep 29, 2026, 8:32 PM

Are there other options other than electron or tauri? or maybe just better optimization strategies for electron? I know it can never be native performance, but being a resource hog isnt great either.

# Claude — Sep 29, 2026, 8:33 PM

# Other shells, and how to slim down Electron

Every alternative falls into one of three groups, and only one group gets you meaningfully lighter without risking calls.

## The alternatives

**System-webview shells** (Tauri, Wails, Neutralino, Electrobun, Dioxus). These are small on disk, but they share Tauri's Linux and macOS WebRTC risk from earlier because they use the same OS webviews. On Windows they use WebView2, which is Chromium-based, so one comparison notes that memory there ends up similar to Electron.

| Shell | Notes |
|---|---|
| Wails | Go backend, OS webview, roughly 10 MB |
| Neutralino | About 2 MB, but a thin API and DIY signing and updates. Suited to small utilities. |
| Electrobun | Bun plus system webview, about 61 MB. Younger ecosystem. |
| Dioxus | Rust-only, single process, no JS runtime. That means a UI rewrite, not a wrapper. |

**Bundled-Chromium shells** (Electron, NW.js, MōBrowser, Tauri+CEF). These give consistent rendering and consistent WebRTC, but you carry a full renderer regardless of the shell around it. The newest entry is `deno desktop` (Deno 2.9, June 2026). It's experimental, defaults to the OS webview, and can bundle CEF at about 150 MB. It lacks secure-storage APIs and Windows auto-update, so it isn't ready for a client like this yet.

**Non-web UI** (Flutter, Qt, native UI on the Rust SDK). This is where you get genuinely lower memory, but it's a UI rewrite rather than a wrapper. FluffyChat and Nheko show it works for Matrix. One anecdotal comparison put Flutter idle around 90 MB against about 180 for Electron, so it's better but not dramatically so.

The takeaway is that there's no free option for a web client that needs voice. Memory in a chat app mostly lives in the Chromium renderer's DOM, images and JS heap, and that exists under any Chromium-based shell. Swapping shells changes the wrapper around it, not the renderer.

## Where Electron memory actually goes, and what fixes it

Electron's own performance guide is mostly about startup and CPU: lazy-load modules, bundle your code, never block the main process, use idle callbacks and workers, drop unnecessary polyfills and remote assets, and null out the default menu. Their advice to profile and fix the biggest item first is worth following, and they note that VS Code and Slack got their results that way. For memory in a chat client, the bigger wins are architectural:

1. **One renderer, one window.** Slack's multi-workspace app used a separate renderer per workspace, and consolidating into one Electron process reportedly gave up to 50% lower memory and 33% faster startup. It also unloaded workspaces you hadn't touched in a while, the way Chrome discards tabs. For Matrix, hold multiple accounts as multiple clients inside one page, and avoid hidden helper windows.
2. **Don't keep every room hot.** Simplified sliding sync loads a window of rooms and grows it in the background instead of pulling everything up front. That should cut the in-memory room state a lot. Also cap in-memory timeline events per room, unload rooms you've left idle, and virtualize the message list.
3. **Control media.** Request server-generated thumbnails instead of full images, pause animated emoji and GIFs that are off-screen, and cap decoded image caches. Discord's own memory work reportedly turned up an issue in one of its third-party dependencies, so audit your dependencies too.
4. **Decide what closing the window means.** Destroying the window frees the renderer, but then nothing is syncing to notify you. Keeping the renderer alive costs memory. The alternatives are a lightweight background sync, which is real engineering work, or push notifications through a Matrix push gateway. This is a product decision I'd make deliberately, from general knowledge rather than a source.
5. **Measure per process.** Electron exposes per-process CPU and memory (`app.getAppMetrics()` as I recall it), and third-party auditing helpers exist. Track main, renderer, GPU and utility processes separately so you know which one you're actually shrinking.

I'd be cautious with V8 heap-cap flags like `--max-old-space-size`. They limit growth but can turn a leak into a crash rather than fix it.

## What I'd do

1. **Set a memory budget and test the web app alone in Chrome first.** If the client is heavy there, no shell will fix it, and the wins above matter more than the wrapper.
2. **Pick the shell after the voice spike.** If calls must work everywhere, choose between tuned Electron and Tauri+CEF, and expect their steady-state memory to be similar since both bundle Chromium. If you're Windows and macOS first, the lighter system-webview route is viable.
3. **Keep the native interface thin**, as before, so the shell stays swappable.

Realistically, a well-built Electron client with one renderer, windowed room loading and virtualized timelines can be perfectly acceptable. The reputation comes mostly from apps that duplicated renderers or held everything in memory, not from Electron itself.

# Human — Sep 29, 2026, 9:04 PM

Ok. Let's plan on Electron, since it is the most stable cross platform. Starting from scratch, forget everything about Tumult, the memory of that client could negatively impact the new one. I want to restart.

# Claude — Sep 29, 2026, 9:05 PM

Tumult is cleared from what I keep, and I won't build on it here. A clean slate also means I won't assume any of its stack choices, so the frontend framework, auth flow and call backend are all open.

## A lean Electron starting point

**1. Process model (the biggest memory lever)**
- One window and one renderer. No hidden helper windows.
- Run Matrix sync in the renderer to start with. It's the simplest setup, and it's how Element Desktop works.
- If you later want notifications while the window is closed, Electron's Node main process opens another option: the Rust crypto crate has Node bindings, so sync could move to a background process. Treat that as a later decision, not a v1 requirement.

**2. Matrix layer**
- matrix-js-sdk with Rust crypto (WASM) in the renderer is the well-trodden path. Use IndexedDB for persistence, with a separate crypto database per account.
- Prefer simplified sliding sync if your homeserver supports it. Synapse has had it natively since 1.114, and it loads a window of rooms instead of everything, which directly reduces memory.

**3. Electron shell essentials**
- Context isolation on, a minimal preload exposing a narrow API, and a strict CSP that allows `wasm-unsafe-eval` for the crypto WASM.
- Secrets in the OS keychain via `safeStorage`. Element is migrating from keytar to it because keytar is deprecated.
- Single-instance lock and a custom URL scheme for login redirects. Deep-link delivery differs by OS: macOS raises an open-url event, while Windows and Linux forward the URL through a second-instance launch.
- Encrypted-message search needs a native index later. Element's answer is Seshat, a Rust/SQLCipher module.

**4. Memory rules from day one**
- Virtualized message list, capped in-memory events per room, and unloading idle rooms.
- Server-side thumbnails instead of full images, and pausing off-screen animations.
- Track per-process memory in CI-style spot checks against a budget you set now.

**5. Milestones**
1. **Spike:** login, sync, one E2EE room timeline, and a memory measurement. Do the same measurement with the web app in plain Chrome so you know what the shell adds.
2. **Core chat:** room list, spaces, timeline, composer, notifications, tray.
3. **Voice/video spike:** run before you commit to a call design.
4. **Hardening:** auto-update, signing, keychain fallbacks on Linux.

Is voice and video part of v1, or a later phase? That decides how early the call spike and its backend choice need to happen.

# Human — Sep 29, 2026, 9:10 PM

I think right now, from day one, we should build the web client as it would expect to be accessed in a browser. Let's get login, sync, and encrypted chat as targets for v1. 

Should we build the backend first and then hook a frontend up to it? Is that a good idea? Or should they be intertwined? I tend to lean toward 'ui knows ui, data knows data, they talk to each other' but my experience in real time chat apps is slim to none.

# Claude — Sep 29, 2026, 9:10 PM

# Backend first, or intertwined?

Neither, strictly. There's no backend for you to build first, and your instinct about UI and data being separate is right. The catch is where the boundary should sit.

## What the "backend" is in a Matrix client

The homeserver already is the backend. The layer you're describing as "data knows data" is a client-side module in the browser that wraps matrix-js-sdk. The SDK is not a thin API wrapper. It provides a full object model, emits events for incoming data and state changes, and handles local echo of sent messages.

That shapes the boundary. The SDK mutates its objects in place and tells you what changed through events, so your UI shouldn't touch `Room` or `MatrixEvent` objects directly. Have the data layer turn SDK events into plain snapshots, and have the UI subscribe to those.

## Why I'd build vertical slices against a written contract

This is my reasoning, not a sourced rule. Real-time bugs (ordering, reconnects, late decryption) only show up when data flows end to end, and you can't know what shape the UI needs until you build some UI. Building the whole data layer first means guessing at that shape. So:

1. Write the interface between UI and data first, as TypeScript types. Keep it small.
2. Build one thin slice at a time through both sides, starting with login.
3. Stub the interface with fake data if the UI is ahead of the data layer, so neither blocks the other.

## What's different about real-time

Since you're new to this, these are the things that surprise people:

- **Sync is a lifecycle, not a request.** After `startClient()`, the SDK emits a sync state: PREPARED when the first sync is ready (which can even come from cache), SYNCING after each poll, RECONNECTING while retrying, ERROR once it gives up, plus STOPPED and CATCHUP. Your UI needs a visible connection state, and it should register its sync listener before starting the client or it can miss PREPARED.
- **Sending is optimistic.** A message you send appears as "sending" in the timeline until the server confirms it. The SDK handles the mechanics, but your UI needs a pending and failed state per message. The `pendingEventOrdering` option controls where pending events appear.
- **Events tell you something changed, not what the UI should show.** Recompute your snapshot from the SDK's current state when an event fires rather than patching incrementally.
- **Encrypted messages can arrive before you can read them.** They show up first as undecryptable and decrypt later when keys arrive. Weave, an open-source Tauri client, lists late decryption as one of its timeline features, so plan the "unable to decrypt yet" state from the start.
- **Startup is a cache question.** Whether you persist sync data decides whether a relaunch is instant or a full re-sync.

## A minimal contract to start from

```ts
// Data layer exposes plain data plus subscriptions. No SDK types leak out.
type ConnectionState = 'starting' | 'syncing' | 'reconnecting' | 'error' | 'stopped'

interface MessageView {
  id: string
  senderId: string
  body: string
  timestamp: number
  status: 'sending' | 'sent' | 'failed'
  decryption: 'ok' | 'pending' | 'failed'
}

interface ChatClient {
  login(params: LoginParams): Promise<void>
  logout(): Promise<void>
  start(): Promise<void>
  connection: Subscribable<ConnectionState>
  rooms: Subscribable<RoomSummary[]>
  timeline(roomId: string): Subscribable<MessageView[]>
  send(roomId: string, body: string): Promise<void>
}
```

`Subscribable<T>` is whatever your framework wants to consume: a store, a signal, an event emitter. The point is that the UI never imports the SDK.

## Suggested order for v1

1. **Login and session restore.** The method depends on your homeserver, since the SDK supports password, SSO and native OIDC flows and a server can require one of them. Decide this first. Done means you can log in, reload, and stay logged in.
2. **Sync and connection state.** Done means the UI reflects starting, syncing and reconnecting correctly, including after you kill the network.
3. **Room list.** Read-only.
4. **Timeline for one room, read-only.** Add pagination back through history afterward.
5. **Send with local echo and failure state.**
6. **Encryption.** Initialize crypto, then handle device verification or recovery-key restore, and finally decryption states in the timeline. This is the riskiest slice, so it's worth spiking early even if you polish it last.

For testing, run a local homeserver in Docker and write integration tests against it. Matrix's own crypto test suite uses a published Synapse image for this.

If you tell me which login method your homeserver requires, I can turn slice 1 into a concrete spec.

# Human — Sep 29, 2026, 9:20 PM

I want to target MAS as the only available login method. And I do want the goals of this rewrite to still be the goals of Tumult, just without the baggage of the scope creep and Tauri since linux is a new target for me.

# Claude — Sep 29, 2026, 9:21 PM

Since you asked me to clear Tumult, I no longer have its goals on file, so I'm working from what you've told me in this chat: a Discord-style client, web-first, Electron later, v1 = MAS login + sync + encrypted chat, Linux as a target, and no scope creep. If other goals should carry over, tell me and I'll add them.

## MAS-only login, web-first

Dropping password and SSO login simplifies the UI. It becomes a single "Sign in" action, with a homeserver field if you don't hardcode one. The js-sdk flow for native OIDC is:

1. Discover the issuer metadata from the homeserver.
2. Register the client dynamically.
3. Generate the authorization URL (PKCE), redirect the user to MAS, and receive the callback.
4. Exchange the code for tokens, create the client with them, and use the SDK's token refresher.

Three details will bite if you miss them:

- **Registration rules.** `client_uri` must be https, and every other URI (including redirects) must be on that host or a subdomain of it. A `web` client registers https redirect URIs. A `native` client registers custom-scheme or loopback (`http://127.0.0.1`) redirects. So expect two registrations: `web` for the browser build and `native` for Electron.
- **Local development.** I haven't verified how MAS treats `localhost` redirects for a `web` client. A loopback redirect registered as `native` is a likely dev workaround, but test it against your MAS.
- **Device ID.** The scope includes the device ID. Generate it once, persist it, and reuse it, because your crypto identity is tied to that device.

After login, initialize Rust crypto with a per-user database name, as we discussed. Logout should also revoke the token, since revocation (MSC4254) is part of the merged spec.

## What Linux changes for an Electron client

- **Secret storage.** Electron's `safeStorage` uses kwallet or gnome-libsecret, but not every Linux setup has a secret store. When none exists it falls back to a hardcoded password, which is effectively unprotected. `getSelectedStorageBackend()` returns `basic_text` when that happens. I'd detect that and tell the user, or refuse to store tokens and recovery keys unless they opt in.
- **Updates.** Linux has no universal update mechanism. electron-updater supports AppImage, deb and rpm, but deb/rpm users normally update through their package manager. Start with AppImage plus deb/rpm and decide on Flatpak later.
- **Wayland and X11.** Since Electron 29, an environment hint can auto-select Wayland. One Electron app in September hit a Wayland startup deadlock from calling `screen.getCursorScreenPoint()`, so test window placement on both.
- **Tray.** Reports say GNOME needs the AppIndicator extension for tray icons to appear. Test GNOME and KDE.
- **Deep links.** Custom-scheme handlers on Linux need registration in the packaged app's `.desktop` file, so login redirects for the desktop build only work from an installed package, not a bare binary.

## What I'd do before writing any Electron code

Get v1 working in a plain browser first: MAS login, sync, and an encrypted room, behind the contract from last time. If you use Nuxt, run it as a client-only SPA, since there's nothing to render server-side. Then add the Electron shell with the `native` registration, `safeStorage` and Linux packaging.

To fight scope creep, I'd write a short non-goals list up front. Voice and video, threads, search, multi-account and push notifications are natural candidates to defer. That's a proposal, though. A Discord-style layout probably needs some form of space or room grouping in v1, and that's your call.

Which goals from the earlier client do you want to carry over, and which should be explicit non-goals for v1?

# Human — Sep 29, 2026, 9:29 PM

Here is copy from the readme:

```md
# Why?

The goal of this project is to create a functional replacement for Discord that operates on the Matrix protocol. I've decided to create a Matrix client that is more in line with what I believe a good chat client should be.

## Tumult?

Discord got its name because it "sounds cool and has to do with talking". Tumult's name means 'uproar', or 'a loud noise, especially that produced by an excited crowd, or a state of confusion, change, or uncertainty'. During this time of uncertainty with the future of Discord, the community has been quite vocal in their feelings about the changes Discord is making to their platform.
```

So for web in browser features, the vertical sidebar of 'guilds' (matrix spaces), a 'dms' tab that has both groups and dms, and then a members sidebar on the right listing all people in the rooms. Desktop will have more features but they require desktop, so let's ignore them for now and focus on a rock solid, modular web ui.

I also want to eventually add custom room events for in-chat games (like chess, tic-tac-toe, etc, but those we will build after we get our rock solid, modular web ui.

I know I want the web ui customizable, so people could write custom themes, so I ideally want an unstyled ui that references a bunch of variables that we configure in a 'theme' file. I am open to framework suggestions, I am familiar with Vue via Nuxt (I am not sure Nuxt is the right thing for this so lmk).

# Claude — Sep 29, 2026, 9:31 PM

# Framework, theming and structure for the web UI

## Nuxt or plain Vue + Vite

Both work, so this comes down to what you'd actually use.

**Nuxt is viable.** It supports a client-only SPA (`ssr: false`), and in SPA mode it offers a hash-history option where the URL is never sent to a server. There's also a `nuxt-electron` module, which forces SPA mode because desktop apps don't need SSR.

**My recommendation is plain Vue 3 + Vite anyway.** This is my judgment, not a sourced rule:

- Nuxt's main strengths are SSR, server routes and hybrid rendering, and this app uses none of them. It's one shell with panes, and the Matrix client is a singleton that lives outside Vue.
- You want the core, UI and theme to be separate modules. A plain workspace with packages expresses that more directly than Nuxt's page and app conventions.
- The Nuxt-module benefit is smaller than it looks. Reka UI has a Vite resolver, and Nuxt UI is described as working in plain Vue through a Vite plugin.

Nuxt would win if you want its conventions and auto-imports for speed. That's a legitimate reason, and either choice is easy to defend.

## Layout maps onto Matrix like this

- **Guild rail:** Matrix spaces. A space's rooms come from its child relationships. Nested spaces are possible, so decide early whether you flatten them.
- **DMs tab:** DMs plus small private group rooms that aren't in a space. Matrix marks DMs in account data, which the SDK exposes through an account-data event. The "group chat" definition is a client rule you get to choose.
- **Member list:** Use the SDK's lazy member loading (it fetches members when needed instead of at initial sync) and virtualize the list for large rooms.

## Theming

Element's theme system is the cautionary tale. Its JSON themes change only a limited set of colors, and its own community notes say custom themes then produce odd-looking elements. So make the token contract broad from the start.

1. **Tokens in three tiers.** Primitives (palette), semantic tokens (surface, text, accent, border, danger) and optional per-component tokens. Components reference only semantic or component tokens, never raw values.
2. **Cover more than color.** Include spacing, radius, typography, motion, and layout dimensions like rail width and member-list width.
3. **Ship a default theme.** A truly unstyled UI looks broken. What you want is structure without opinions, with the default look supplied by a theme file.
4. **One file per theme.** Scope it on `:root[data-theme="name"]`, set the variables, and version the token list so theme authors know what's stable.
5. **Make JSON the safe path.** Let users install a JSON theme whose values you validate and turn into variables. Raw CSS themes can load arbitrary URLs, so make them an explicit opt-in, and keep a strict CSP on the app.

For behavior and accessibility, use Reka UI (formerly Radix Vue). It's headless, WAI-ARIA compliant, has virtualization support, and lets you style with any CSS approach.

```css
:root[data-theme="default"] {
  --surface-1: #1e1f22;
  --text-primary: #f2f3f5;
  --accent: #5865f2;
  --radius-md: 6px;
  --layout-guild-rail-width: 72px;
  --layout-members-width: 240px;
}
```

## Repo shape

```
packages/core     Matrix client, auth, sync, crypto. No Vue imports.
packages/ui       Vue components: headless behavior + structure, token-driven
packages/theme    Token contract, default theme, theme validator
apps/web          Shell and routing
apps/desktop      Later
```

## One hook worth building now for games

Games are out of scope for v1, but make the timeline dispatch on event type through a small registry, with a plain fallback for unknown types. That way custom room events later become a registered renderer instead of a timeline rewrite. Matrix custom event types are namespaced under your own domain by convention.

## v1 order, adjusted for your layout

1. The `core` contract and login.
2. The three-pane shell with fake data and the default theme, so the token system gets exercised immediately.
3. Wire in the guild rail and room list, then DMs.
4. Timeline reading and sending.
5. Encryption.
6. Member list with lazy loading.

Non-goals for v1 would be games, desktop-only features, and anything else you flagged for later.

Would you like me to turn this into a GOALS.md and an AGENTS.md for the first slices (contract plus login, then the shell), so you can hand them straight to a coding agent?

# Human — Sep 29, 2026, 9:43 PM

Does nuxt add bloat in a way that is meaningful for our usecase? And I would like to use Vue, is Vite recommended or needed for this, too?

Guild rail I want to only show parent-less spaces, nestes spaces show inside as 'categories' like discord (an icon on the left, space title, and it is collapsible inside that space) nestable until the rooms list out like 'channels' on discord.

The way Matrix handles dms/group chats are a bit confusing to me, because they are all just rooms, so I guess just show all orphaned rooms in a tab and call it dms because that is kinda functionally what they are?

For member list that sounds good, lazy load good.

For theming, that is a good cautionary tale. I ideally want the entire app to be themeable to be as unique as people want to get if they are comfortable writing json and we have well documented theme protocols. We for sure need a default theme of course. we can add an 'advanced' option that lets users load their own css, but I think by default a theme should just be json.

Let's not write any code, but let's write out a solid starting spec with these design decisions in mind.

