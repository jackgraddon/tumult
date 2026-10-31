# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.4.0](https://github.com/jackgraddon/tumult/compare/v0.3.4...v0.4.0) (2026-10-31)


### Features

* **members:** a shield in place of the presence dot for verified users ([04b53fa](https://github.com/jackgraddon/tumult/commit/04b53fad0693915daea70845cebd52653a6f3570))
* **plugins:** run the sandbox lane in an opaque-origin frame ([7b97899](https://github.com/jackgraddon/tumult/commit/7b978998a5add7729c23bde4a58598126a3c24e6))


### Bug Fixes

* **call:** address a root-deployed call app by index.html ([ef47076](https://github.com/jackgraddon/tumult/commit/ef470769e9e9cba8e47aba2e10632b7f5863ee6f))
* **call:** answer the call app's transport query under rtc_transports ([a31c115](https://github.com/jackgraddon/tumult/commit/a31c115e2714d6efe5c8ac501cdc85236e120662))
* **call:** let the embedded call app finish its handshake ([2c6cf48](https://github.com/jackgraddon/tumult/commit/2c6cf48b16f303be86583feb947df62eb5c70f6b))
* **call:** push room-state updates to the call app ([813135d](https://github.com/jackgraddon/tumult/commit/813135d48e41aaa8c7076cc75a8c28e2d5c9c2a3))
* **call:** say "In call", keep the call app's error screen, ack its requests ([de3931a](https://github.com/jackgraddon/tumult/commit/de3931a8c9d7a0ff063bc03a5721201101418397))
* **connection:** notice an outage at once and reconnect as soon as it ends ([ee74bc2](https://github.com/jackgraddon/tumult/commit/ee74bc2fb695d50be46dc19a2d873741b0a53765))
* **plugins:** cap what one sandboxed plugin can hold open (F4) ([70d91e3](https://github.com/jackgraddon/tumult/commit/70d91e3fc096786b457e3cc6c640f3dc2defe7f2))
* **plugins:** close the CSS guard's escape and image-set gaps; no plugin CSS on security screens ([2381e3d](https://github.com/jackgraddon/tumult/commit/2381e3d2ec956fee60c268686a5b85c55bd5d6bd))
* **plugins:** never serve the app into the sandbox frame; say why frame-src 'self' is safe ([17ed72c](https://github.com/jackgraddon/tumult/commit/17ed72c9907e8ef8fe5e2de95aedbe42ba904e54))
* **plugins:** no shadowing built-ins, name a publisher change, say when a reload is needed ([9fae317](https://github.com/jackgraddon/tumult/commit/9fae317f8729e768245c493aa464a161d85e4be5))
* **plugins:** police the sandbox bridge; make sandboxed commands work at all ([3f3c992](https://github.com/jackgraddon/tumult/commit/3f3c99246c372945108ee150ed6196ccd2612b7d))
* **plugins:** withdraw the app origin's storage from the sandbox Worker ([c89e1e0](https://github.com/jackgraddon/tumult/commit/c89e1e07ad7117e98144c7020f78f0bb56ae2db9))
* **send:** "try again" never worked; find failed echoes where they live ([1ae70f4](https://github.com/jackgraddon/tumult/commit/1ae70f4eb8152951879738746a553e9140149556))
* **send:** deliver messages typed during an outage once the network is back ([1f76331](https://github.com/jackgraddon/tumult/commit/1f763313d570f23786aff55928852c7a17236c15))

### [0.3.4](https://github.com/jackgraddon/tumult/compare/v0.3.3...v0.3.4) (2026-10-31)


### Features

* **rooms:** admins can open an existing room's calls to members ([24bb720](https://github.com/jackgraddon/tumult/commit/24bb720007a262640fe509969d14c891baacf8b8))


### Bug Fixes

* **deps:** clear every pnpm audit advisory, dev dependencies included ([02ec229](https://github.com/jackgraddon/tumult/commit/02ec2293d9e217b23b774f1544aa07ccdc42f158))
* **deps:** scope the minimatch override to 10.x so pnpm release works ([a049f58](https://github.com/jackgraddon/tumult/commit/a049f586326d498feba73cf6aa982a26c2f907e8))
* **rooms:** let every member join calls in rooms Tumult creates ([1882f4c](https://github.com/jackgraddon/tumult/commit/1882f4c23cb66b29801cde9546432a376b7ace73))
* **sdk:** clear matrix-js-sdk's request-timeout timer; drop --test-force-exit ([f6ce5a6](https://github.com/jackgraddon/tumult/commit/f6ce5a65a1eabc57c01bfafec0f7ef2d3517bab2))
* **security:** no "backup is off" banner before encryption has answered ([fba6dbe](https://github.com/jackgraddon/tumult/commit/fba6dbefe8e02f88d814f90391353edf94a4d01d))
* **security:** production CSP, workspace lint, capped plugin-asset proxy ([d63674e](https://github.com/jackgraddon/tumult/commit/d63674e7283f664406c17846ef327478ec3f5d1e))
* **security:** recovery setup creates an identity and shows its key ([c16b185](https://github.com/jackgraddon/tumult/commit/c16b185380bffe1f306875e2668b538b973bec0e))
* **voice:** no ghost on the SFU after a refused join; say why in a sentence ([7346fa4](https://github.com/jackgraddon/tumult/commit/7346fa420600058ca770e20f58622a5c6ab8d7c6))

### [0.3.3](https://github.com/jackgraddon/tumult/compare/v0.3.2...v0.3.3) (2026-10-30)


### Features

* **voice:** fitted video stage, screen-share audio, mic processing settings ([e1ff575](https://github.com/jackgraddon/tumult/commit/e1ff5754a8d0b734140e6c6d4e69813150d53028))

### [0.3.2](https://github.com/jackgraddon/tumult/compare/v0.3.0...v0.3.2) (2026-10-29)


### Features

* **ui:** phone-width layouts, appearance preview, slimmer account menu ([e8d7a66](https://github.com/jackgraddon/tumult/commit/e8d7a663baf90e368a327d701ed8628561bb07aa))
* **voice:** native video and screen share, one Voice/Video call menu ([42b9b8f](https://github.com/jackgraddon/tumult/commit/42b9b8f2d1870d96a3a73206860ef0648129dfc0))


### Bug Fixes

* **presence:** one source for our own dot; announce presence under SSS ([511a287](https://github.com/jackgraddon/tumult/commit/511a28715508215198ca7a8407f60c6b9039f472))

## [0.3.0](https://github.com/jackgraddon/tumult/compare/v0.2.10...v0.3.0) (2026-10-28)


### Features

* **settings:** full-screen settings with grouped sidebar ([3bd5df6](https://github.com/jackgraddon/tumult/commit/3bd5df647d1650f8eee74c867b72c232b965209a))

### [0.2.10](https://github.com/jackgraddon/tumult/compare/v0.2.9...v0.2.10) (2026-10-28)


### Features

* **presence:** profile fields and plugin activity renderers ([e2fb405](https://github.com/jackgraddon/tumult/commit/e2fb405c86457341e9cb9f3d81d4c437c3065724))

### [0.2.9](https://github.com/jackgraddon/tumult/compare/v0.2.8...v0.2.9) (2026-10-28)


### Features

* **rail:** space mark-as-read, pinned band, pin and mute ([8d1ee4b](https://github.com/jackgraddon/tumult/commit/8d1ee4b9e891dd7ee7a32db9761c8bee2d6ee9e4))
* **roomlist:** context menu on space categories; test pinned band ([914f75c](https://github.com/jackgraddon/tumult/commit/914f75c9553cd5d3f9fd2e61d648bba481b473c3))


### Bug Fixes

* **voice:** tear down on session failure and re-dial a dropped SFU ([9091cbd](https://github.com/jackgraddon/tumult/commit/9091cbd35f0a38aacd35b8dc059e83bbe84b7428))

### [0.2.8](https://github.com/jackgraddon/tumult/compare/v0.2.7...v0.2.8) (2026-10-28)

### [0.2.7](https://github.com/jackgraddon/tumult/compare/v0.2.6...v0.2.7) (2026-10-28)


### Bug Fixes

* **voice:** join a call from a homeserver that only publishes a well-known focus ([c4c3733](https://github.com/jackgraddon/tumult/commit/c4c37338ec886ba61102b2bee0cd089e4bdb8e3c))

### [0.2.6](https://github.com/jackgraddon/tumult/compare/v0.2.5...v0.2.6) (2026-10-28)

### [0.2.5](https://github.com/jackgraddon/tumult/compare/v0.2.4...v0.2.5) (2026-10-28)


### Features

* **calls:** embed Element Call as a MatrixRTC widget ([281fda2](https://github.com/jackgraddon/tumult/commit/281fda27b503ac2872dc783685580585cf0ecf56))
* **ui:** call strip above a room's timeline while it has a voice call ([be13616](https://github.com/jackgraddon/tumult/commit/be136168f5cbe9e9064ca26ddd917108ab723ee9))
* **voice:** native audio voice over MatrixRTC + LiveKit ([33fc996](https://github.com/jackgraddon/tumult/commit/33fc996d82d246505edc4af6517f4b03be875a88))


### Bug Fixes

* **core:** answer supportsVoice/supportsCalls from config, not managers ([b548126](https://github.com/jackgraddon/tumult/commit/b5481264c4dd54c2a45da2660d0ba3e5e30d40d3))
* **ui:** load the resumed room's timeline once the client has started ([531bb13](https://github.com/jackgraddon/tumult/commit/531bb13d98202e7d71c7c11c26a7ff658cc635c1))

### [0.2.4](https://github.com/jackgraddon/tumult/compare/v0.2.3...v0.2.4) (2026-10-27)


### Bug Fixes

* **ui:** paint rail/members avatars before the client starts ([9b1a4ed](https://github.com/jackgraddon/tumult/commit/9b1a4edd0cdc14603096b127c81a7e9feb899253))

### [0.2.3](https://github.com/jackgraddon/tumult/compare/v0.2.2...v0.2.3) (2026-10-26)


### Bug Fixes

* **rooms:** hold the warm cache through the first partial sync ([29df9e0](https://github.com/jackgraddon/tumult/commit/29df9e0b2fb660316c5f1bc5ca948d27f8e86c93))
* **ui:** bound scroll viewports so rail/room/DM lists scroll ([7f6fc1b](https://github.com/jackgraddon/tumult/commit/7f6fc1b8b39636a2e0ebf0f9081eff3402dede04))
* **web:** default to classic /sync so warm refreshes resume incrementally ([b8c9e85](https://github.com/jackgraddon/tumult/commit/b8c9e859174b733e7fdab9bd11b2179cdcda2707))

### [0.2.2](https://github.com/jackgraddon/tumult/compare/v0.2.1...v0.2.2) (2026-10-25)


### Features

* **ui:** per-room composer drafts ([15ee38f](https://github.com/jackgraddon/tumult/commit/15ee38ff6c8570b9e7b66840dfab0eca9aabb15d))

### [0.2.1](https://github.com/jackgraddon/tumult/compare/v0.1.2...v0.2.1) (2026-10-24)


### Features

* **release:** accept an explicit version and skip the bump ([bd7416d](https://github.com/jackgraddon/tumult/commit/bd7416ddd5957d07a943e34bdca9d0086393b9f1))
* **ui:** replace emoji chrome with bundled Material icons ([ee7b2d4](https://github.com/jackgraddon/tumult/commit/ee7b2d47a747896039f07eb11d8fb2447cd17a3d))

## [0.2.0](https://github.com/jackgraddon/tumult/compare/v0.1.2...v0.2.0) (2026-10-22)

### [0.1.2](https://github.com/jackgraddon/tumult/compare/v0.1.1...v0.1.2) (2026-10-22)


### Features

* **plugins:** add the workspace-pane extension point ([d21df5f](https://github.com/jackgraddon/tumult/commit/d21df5f259fe82969790a8ab16168052b85c9d82))
* **plugins:** migrate plugin template to Vite with SFC support ([50f816d](https://github.com/jackgraddon/tumult/commit/50f816d887eedf93b3f81bc6b8c6d0d9e0b23189))
* **plugins:** proxy release-asset downloads through the app's own origin ([a78056c](https://github.com/jackgraddon/tumult/commit/a78056c026537cab834c4e698f924a8b9d637a37))
* **plugins:** third-party plugin installation, generation, and the sandbox lane ([0336f9a](https://github.com/jackgraddon/tumult/commit/0336f9ab670aef1495b5fd1a5b112e34e79be159))
* **rail:** grow the account panel into a cross-track user bar ([915615a](https://github.com/jackgraddon/tumult/commit/915615a05364a9dd811dd6459fffe877b777f149))


### Bug Fixes

* **ci:** supply the client URI for the build gate and document the deploy trap ([d065e70](https://github.com/jackgraddon/tumult/commit/d065e70f7c48323ad0f568dceb1a82b38f1bf5cb))
* **deploy:** build workspace deps before web in Vercel build, scope vercel.json to apps/web ([b00859e](https://github.com/jackgraddon/tumult/commit/b00859e577e2a6fe32ce7c23154cd14104d6cfc7))
* **deploy:** give the plugin-asset function a valid config ([283ad9d](https://github.com/jackgraddon/tumult/commit/283ad9dc673038ff9f5f94776a679808e818e866))
* **deploy:** make a missing VITE_CLIENT_URI a failed build, not a blank page ([f7295e5](https://github.com/jackgraddon/tumult/commit/f7295e5eef3b29c12d3abdfd2ed956d934f42e79))
* **deploy:** run vercel steps from the repo root, not apps/web ([f411e0e](https://github.com/jackgraddon/tumult/commit/f411e0e964d9f0276cc5482bdec733bac348d125))
* **plugins:** download GitHub release assets via API with correct CORS headers ([2653172](https://github.com/jackgraddon/tumult/commit/26531722e0e8e88ab27a269fd30758ce2e3bf2fe))
* **plugins:** stop classifying a mid-install plugin as built-in ([1640cb9](https://github.com/jackgraddon/tumult/commit/1640cb9cbf9e5706cd6e794d96dbb117ba9907eb))
* **theme:** use real token names in the plugin install components ([83fc378](https://github.com/jackgraddon/tumult/commit/83fc378effaee76a56f675420c0ae4d49214f1fe))

### 0.1.1 (2026-10-19)


### Features

* **web:** add fake-mode build switch + browser smoke test ([045cdb9](https://github.com/jackgraddon/tumult/commit/045cdb907a3ac2cb2d1fa79f76d4f2d54c106479))


### Bug Fixes

* **core:** keep matrix-js-sdk out of the fake build ([a7a9ba4](https://github.com/jackgraddon/tumult/commit/a7a9ba433277eed2e0ff9185d61eec3c6d8bf066))
