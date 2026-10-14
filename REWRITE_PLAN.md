# Tumult Rewrite Plan: From Test UI to Themed, Extensible Client

This plan builds on the existing data/core/contract foundation, but resets UI design around a token-complete, theme-driven, extensible system. It keeps v1 focused (MAS login, sync, encrypted chat, Discord layout) while opening the door for games/plugins.

## 1. Goals & Principles

- Discord layout: parentless spaces on guild rail; nested spaces as collapsible categories inside parent; orphans as DMs; members on right. Rail is chrome, others collapsible to 0-width + `inert`.
- Token-everything: every color/spacing/radius/typography/motion/layout dimension must reference CSS vars. UI should be unstyled in structure only if no theme loaded, but default theme ships.
- JSON-first theming + advanced CSS opt-in: validate JSON (versioned), emit CSS vars. Raw CSS allowed as advanced opt-in, behind strict CSP. No arbitrary JS execution via themes.
- Vencord/BetterDiscord-like extensibility: built-in, per-shell plugins for renderers, commands, composer/actions, member decorations, settings tabs. Isolated, CSP-safe.
- Web-first v1, Electron later, Linux target. No scope creep: voice/video/multi-account/encrypted-search/push/desktop-only deferred.
- Keep contract boundary: `packages/core/src/contract.ts` unchanged by UI/theme/plugin design except additive API if strictly needed.

## 2. Non-Goals v1

- Games/custom room event UIs (registry exists, build them later)
- Voice/video, threads polish beyond current, search beyond what exists, multi-account, push notifications, desktop shell specifics
- Full layout plugins (replacing entire panes/shell regions at runtime) — with token-everything (option 1) plus a renderer/command/composer/member/decorations/settings API (option 2), users can achieve extreme customization without needing dynamic pane layout injection. This keeps the shell stable and predictable.

## 3. Phase 0 — Audit & Baseline

> DONE 2026-10-13 — full results in `docs/phase0-audit.md`.

- [x] Token audit of all UI SFCs: grep hardcoded colors/px/spacing in `packages/ui/src` and list violations. → 208 px literals / 30 files, 27 font-weight, 9 letter-spacing, 7 font-size, 4 hex, 7 rgba, 2 z-index. Per-file table in the audit doc. One real bug fixed: unregistered `--accent-primary` in `PowerLevelDialog.vue`.
- [x] Current theme coverage: compare `packages/theme/themes/default.json` and `packages/theme/src/registry/*` against used tokens. → registry 102 (39/36/27), app references 56, used-but-unregistered 0 after the fix; gap list (shadow/z-index/type metrics/state/icon-size/light-mode) in the audit doc.
- [x] Performance snapshot: bundle size of web entry, first paint against matrix.jackg.cc (or fake) to avoid regressions. → clean build: entry 104.73 kB (40.65 gzip), shell `AppView` 254.98 kB (69.77 gzip), SDK `chat` 892.94 kB (248.15 gzip), CSS total 50.22 kB (7.49 gzip). Fake-client shell paint 51 ms warm / 65.7 ms cold (headless CDP harness). Real-homeserver numbers still from AGENTS.md (~97 ms first paint, ~2.5 s room list) — not re-measured (needs the browser MCP session).
- [x] CSP review: confirm `wasm-unsafe-eval` present, `media-src blob:` ok, plan CSS loading for advanced themes. → both present and correct. **Finding: the policy is dev-only (`vite.config.ts` `server.headers`); production has no CSP.** `style-src 'unsafe-inline'` is load-bearing (Vite dev injection + Reka inline `style` attributes) — Phase 3's advanced-CSS path must decide CSP3 `style-src-attr`/nonces up front. Production delivery mechanism still undecided.

## 4. Phase 1 — Token System v2

> DONE 2026-10-13 — migration + authoring rules in `docs/theme-migration-v1-to-v2.md`.

- [x] Extend `TokenKind`/registry to cover: shadows, z-index, letter-spacing, icon sizes, line-height, breakpoints (optional), layout rail/members/roomlist fully parameterized. → kinds added: `size`, `shadow`, `z-index`, `line-height`, `letter-spacing`, `font-weight`, `border-width`, `opacity`; icon sizes are the semantic `icon-*` scale. Breakpoints **not** added (a CSS var cannot drive `@media`; documented as deferred). Rail/roomlist/members widths were already parameterized; `layout-*` gained slide-over/menu/dialog widths.
- [x] Expand primitives + semantic + component sets to reach "token-everything": buttons, inputs, badges, overlays, dialogs, lists, timeline decorations, members, rail states (hover/active/unread/highlight). → registry 102 → **271** (91/104/76); every component token is now referenced (coverage test).
- [x] Add state tokens (hover/active/selected/focus/disabled) consistently. → `state-hover`, `state-selected`, `state-disabled-opacity`, `state-muted-opacity` (+ `focus-ring-color`/`focus-ring-outline`/`focus-ring-width`/`focus-ring-offset`). `state-*` are reference tokens; no new visual states were invented in Phase 1 (see the migration doc's normalization list).
- [x] Version bump: `ThemeJson.version` to 2, `packages/theme/src/version.ts`. Add migration notes. → `TOKEN_CONTRACT_VERSION = 2`, `SUPPORTED_TOKEN_CONTRACT_VERSIONS = [1, 2]`, unsupported → `warning`; `docs/theme-migration-v1-to-v2.md`. v1 themes stay valid (one removed token: `shell-gap`).
- [x] Compiler: emit CSS vars for all registered tokens, validate unknown tokens (warn or error by mode), support dark/light via `:root[data-theme][data-mode]` (default dark). → `base.css` emits all 271; unknown token = error (with did-you-mean), unsupported version = warning; modes validated as scoped override maps and emitted as `:root[data-theme][data-mode="…"]`.
- [x] Default theme v2: `packages/theme/themes/default.json` expanded to cover all component tokens. Keep backwards compatible with v1 where possible. → complete snapshot of the structural defaults (271) + 14 light-mode overrides; a drift test fails if it disagrees with the registry.
- [x] Token-complete SFC pass: replace hardcoded values with `var(--…)` in `packages/ui/src/**.vue`, scoped styles only. → 44 SFCs (plus the app's own `DemoPoll.vue`/`AppView.vue`, which the new scan also covers); nothing hardcoded remains outside allowed geometry. Verified mechanically: 319 declarations paired, 14 differ only in notation, **2 intentional changes** (danger-button rest→hover direction, start-error toast 13px→14px) — see the migration doc §3.

## 5. Phase 2 — Plugin API (Vencord-like, built-in) [DONE]

Design: per-shell, injection-based, isolated, CSP-safe. No external code execution strings; plugins are TS modules registered at runtime (app registers, not arbitrary user JS eval). 

- [x] `packages/ui/src/plugins/`:
  - `types.ts`: `Plugin`, `PluginManifest` (id, name, version, author, description, minCore/minUI, permissions), `PluginContext` (client, selection, actions, media resolvers — theme APIs come with Phase 3), `PluginApi`, lifecycle (install/uninstall + returned disposables), `Permission` union. Note: the `Patch` type from the original sketch is deliberately dropped — plugins register TS modules; nothing in the API rewrites or evaluates code strings, so a patch type would promise a surface we never want to build.
  - `api.ts`: the permission-checked, disposable-tracking API surface. `addRenderer(type, entry)`, `addComposerAction(action)`, `addCommand(command)` and `addMemberDecoration(decoration)` each return a disposable through the same `require`/`track` machinery; `addSettingsTab(tab)` and `injectStylesheet(css)` complete the six permission-gated APIs (and `plugins/styles.ts` holds the CSP-aware injector).
  - `registry.ts`: `PluginRegistry` class (per-shell, provide/inject via `PluginsKey`/`usePluginRegistry`, `version` bump reactive, install with duplicate-id refusal + atomic rollback on throw, uninstall with ordered cleanup: context disposables → install teardown → `plugin.uninstall()`, each guarded; `uninstallAll` on shell unmount), plus the manifest permission gate.
  - `contributions.ts`: `ContributionList<T>` — the shared keyed list (keyed add with duplicate refusal, compare-ordered snapshot, identity-checked idempotent disposer, `version` counter so late registrations repaint) behind the three registries below.
- [x] Extend registries: `TimelineRegistry` stays and gained `unregister()` (the disposer half). `ComposerActionsRegistry` (`timeline/composer-actions.ts`), `CommandsRegistry` (`timeline/commands.ts` — name normalization, `resolve()` exact-match parsing, `suggest()` prefix list) and `MemberDecorationsRegistry` (`members/decorations.ts` — `match` predicate + priority) are per-shell, each with a `Key` + hook. The composer renders action buttons and a `/prefix` suggestion list (click completes, Enter runs), and member rows render matching decorations after the built-in badges. `SettingsTabsRegistry` (`settings/tabs.ts` — `id`/`title`/`component`/`priority`) hosts tabs in `settings/SettingsDialog.vue`, opened from the account menu, with the shell contributing its own `Plugins` tab (`settings/PluginsTab.vue`, listing what `PluginRegistry.list()` returns).
- [x] Style injection: `injectStylesheet(css)` lives in `plugins/styles.ts` and appends one owner-tagged `<style>` element, returning a disposable (removed on uninstall). Deliberately NOT scoped: the shell has no shadow root, so a plugin stylesheet is app-wide CSS at the same trust level as the plugin module. The guard is CSP-honesty — `@import` and any `url()` that is not `data:`/`blob:`/a `#fragment` throw at install (rolling it back) instead of failing silently against `style-src 'self'` or turning into an image request. Advanced CSS path remains separate (Phase 3).
- [x] Sandbox (structural): no `eval`/`new Function`/remote loading exists anywhere in the plugin path; isolation is by API surface — the `PluginContext` carries no `window`/`document`. Documented honestly in `types.ts`: plugins are app-authored modules (first-party trust), an extension seam, not a hard boundary against hostile code.
- [x] Discovery: manifest complete (`id`, `name`, `version`, `author`, `description`, `minCore`/`minUI`, `permissions`), local/app-controlled only — no remote loading path exists.
- [x] Example: `DemoPoll` migrated from a direct `registry.register` call to a manifest-declared plugin in `AppView.vue` (permissions: `timeline-renderers`), verified in the browser smoke test (`.tumult-poll` renders through the full manifest → permission → `addRenderer` → resolve path). Each extension point has an app-registered reference plugin (`apps/web/src/plugins/showcase.ts`): `shrugCommand` (`/shrug <text>`), `reactLastAction` (a 👍 composer button reacting to the newest message), `adminBadge` (`AdminBadge.vue`, a crown on power ≥ 100 members) and `settingsShowcase` (`SettingsShowcaseTab.vue` — a `settings-tabs` tab styled by an injected `styles` sheet) — all asserted in the browser smoke test.

## 6. Phase 3 — Theming Loader & UX [NEXT]

- [ ] JSON loader: validate against schema (Zod), version check, unknown token warnings, cycle/var resolution checks.
- [ ] Theme management: `apps/web` stores user themes (localStorage), list/select, preview (hot swap), reset to default. No sync.
- [ ] Advanced CSS opt-in: `<textarea>` + "Enable advanced CSS (CSP-aware)" flag. Loaded via scoped style element, CSP review noted; warn about arbitrary CSS.
- [ ] Theme editor (minimal): token tree + color pickers + JSON view, live preview.
- [ ] Developer docs: `docs/themes.md` with token contract, examples, migration.

## 7. Phase 4 — Visual Redesign (Discord-like, token-driven)

- [ ] Guild rail: parentless spaces only. Nested spaces render as collapsible categories (icon+title), nestable down to channels. Unread/highlight states via tokens.
- [ ] DMs: orphans (rooms with no parent spaces) in DMs tab. Document rule (uses `m.direct` where applicable).
- [ ] Room list: channels under categories/spaces, dividers, active/hover, badges via tokens.
- [ ] Timeline: message grouping (by day), compact/cozy (density token), reactions, replies, edits, read markers, typing all token-driven.
- [ ] Members: lazy loaded, virtualized, roles (power levels) as sections, presence dots, badges.
- [ ] Shell chrome: toolbars, banners, dialogs use Reka, fully tokenized. Collapsible panes (0-width+inert) preserved.
- [ ] Design tokens for elevation/shadows, focus rings, transitions.

## 8. Phase 5 — Testing & Parity

- [ ] Unit: selectors, theme validator/compiler, plugin registry, token expansion.
- [ ] Snapshot: token coverage (no hardcoded values), theme v2 roundtrip. → both coverage halves landed early in Phase 1 (`packages/theme/test/coverage.test.ts`: no orphan component/role tokens, no unresolved `var(--…)`, no hardcoded values in SFC style blocks). Still missing: the theme v2 roundtrip.
- [ ] Integration: MAS login/sync/E2EE still work (no core contract changes). Fake/real swap unchanged.
- [ ] Visual regression: compare shell layout against existing (grid tracks, chrome vs panes).
- [ ] Linux target smoke: Wayland/X11, secret storage fallback messaging, packaging notes.

## 9. Rollout Strategy

1. Phase 0–1 in parallel (audit + extend tokens). Land token-complete SFCs behind default theme v2.
2. Phase 2 plugin API: additive, off by default, no behavior change.
3. Phase 3 loader: user-visible but safe.
4. Phase 4 redesign: incremental, can branch or feature-flag shell styles.
5. Keep `apps/web` using existing `chat.ts` import swap (fake/real) throughout.

## 10. Notes & Rationale

- See `AGENTS.md` → "Context for agents" for concrete repo ops, stack pins, invariants, and test conventions. All work must respect those.
- Vue 3 + Vite + Reka + TanStack stay unless Phase 4 uncovers blocker; framework choice left open in principle but switch cost high. Prefer iterating current stack.
- Timeline registry already supports custom events (games later). Plugin API generalizes this.
- Advanced CSS is opt-in, CSP-aware. JSON is the default safe path.
- Contract remains the stable boundary (`UI knows UI, data knows data`). No SDK types leak. (`packages/core/src/contract.ts` is the source of truth.)
- This matches the README goals: Discord replacement, modular, customizable, unique via theming, extensible like Vencord.

## 11. Deliverables

- `REWRITE_PLAN.md` (this file)
- `docs/themes.md` (Phase 3)
- `packages/theme/themes/default.json` v2
- `packages/ui/src/plugins/*` (Phase 2) — see Phase 2 checklist below
- Token audit checklist and migration notes

## Status (2026-10-13)

- Phase 0–1 (Token System v2): DONE — contract v2, registry 271 tokens, modes dark/light, SFC tokenization, 310 core + 33 theme tests passing, build green. (commits cd78a04–62d4ed0 locally; repo now has the fix in a7a9ba4)
- Phase 1b follow-up (SDK-free fake build + guard): DONE — fixed verbatimModuleSyntax side-effect import (three files), added `packages/core/test/imports.test.ts`, fake build chunk 839KB→17KB. (a7a9ba4)
- Browser verification: DONE — fake-mode build switch (`@chat-impl` via Vite --mode fake), Playwright/Firefox smoke test asserts shell renders/navigates, light/dark flips reversibly, rail width from token, no console errors, no SDK in fake build. (045cdb9)
- Phase 2: DONE — renderer seam, 2026-10-14: `packages/ui/src/plugins/{types,api,registry}.ts` (manifest + `Permission` gate + per-shell `PluginRegistry` with atomic install rollback and ordered uninstall, `PluginsKey` provide/inject), `TimelineRegistry.unregister()`, shell built-ins re-routed through the host, `DemoPoll` migrated to a manifest-declared plugin in `AppView.vue`.
- Phase 2 (extension points) DONE 2026-10-14: `plugins/contributions.ts` (`ContributionList<T>`), `timeline/composer-actions.ts`, `timeline/commands.ts`, `members/decorations.ts` — each per-shell with a `Key` + hook; `PluginApi`/`PluginDeps` grew `addComposerAction`/`addCommand`/`addMemberDecoration` and the three `Permission`s are enforced (undeclared → throw + rollback). `MessageComposer.vue` renders the action row and the `/prefix` suggestion list (click completes, Enter runs; unknown commands send literally) and `MemberListItem.vue` renders matching decorations. Reference plugins in `apps/web/src/plugins/showcase.ts` (+ `AdminBadge.vue`). Covered by `packages/ui/test/contributions.test.ts` (13) and the extended `plugins.test.ts` (16 more) plus four browser-smoke assertions (action button, `/shrug` suggestion + run, action reacts, admin badge); core(310)/theme(33)/ui(33)/browser(12) tests, typecheck and build all green.
- Phase 2 (settings tabs + style injection) DONE 2026-10-14: `settings/tabs.ts` (`SettingsTabsRegistry`; `SettingsTabProps` = `{ client, close }`) + `settings/SettingsDialog.vue` (Reka dialog with a `TabsRoot` strip; account menu → "Settings…"; the selection follows the registry as tabs appear/disappear) + the shell's own `settings/PluginsTab.vue` (lists `PluginRegistry.list()`). `plugins/styles.ts` `injectStylesheet(css, owner)` appends one owner-tagged `<style>` and returns its disposer; the exported `findExternalStylesheetReferences` refuses `@import` and every non-`data:`/`blob:`/fragment `url()` at install (throw → rollback) so a plugin sheet cannot become a third-party request. `PluginApi`/`PluginDeps` gained `addSettingsTab`/`injectStylesheet`; all six permissions are now enforced, and the registry binds the plugin's manifest id as the stylesheet owner (shell-level injection is owned by `"shell"`). Reference plugin `settingsShowcase` (`SettingsShowcaseTab.vue`) injects the sheet that styles its own tab. Tests: `packages/ui/test/styles.test.ts` (7 — the guard; the DOM half is browser-only), 2 `SettingsTabsRegistry` cases plus extended `plugins.test.ts` (permission refusal for both new APIs, owner id, tracked disposal on uninstall) and 1 new browser assertion (tab strip, built-in plugin list, injected-CSS marker + computed style, Escape closes). core(310)/theme(33)/ui(42)/browser(13) green, typecheck + build green, bundle unchanged (entry 40.66 kB gzip, SDK still the lazy 248 kB `chat-*.js`).

Created: 2026-10-13