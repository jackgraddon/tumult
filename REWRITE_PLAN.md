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

- [ ] Extend `TokenKind`/registry to cover: shadows, z-index, letter-spacing, icon sizes, line-height, breakpoints (optional), layout rail/members/roomlist fully parameterized.
- [ ] Expand primitives + semantic + component sets to reach "token-everything": buttons, inputs, badges, overlays, dialogs, lists, timeline decorations, members, rail states (hover/active/unread/highlight).
- [ ] Add state tokens (hover/active/selected/focus/disabled) consistently.
- [ ] Version bump: `ThemeJson.version` to 2, `packages/theme/src/version.ts`. Add migration notes.
- [ ] Compiler: emit CSS vars for all registered tokens, validate unknown tokens (warn or error by mode), support dark/light via `:root[data-theme][data-mode]` (default dark).
- [ ] Default theme v2: `packages/theme/themes/default.json` expanded to cover all component tokens. Keep backwards compatible with v1 where possible.
- [ ] Token-complete SFC pass: replace hardcoded values with `var(--…)` in `packages/ui/src/**.vue`, scoped styles only.

## 5. Phase 2 — Plugin API (Vencord-like, built-in)

Design: per-shell, injection-based, isolated, CSP-safe. No external code execution strings; plugins are TS modules registered at runtime (app registers, not arbitrary user JS eval). 

- [ ] `packages/ui/src/plugins/`:
  - `types.ts`: `Plugin`, `PluginManifest`, `PluginContext` (client, registry, selection, actions, media resolvers, theme APIs), `Patch`, lifecycle (mount/unmount), permissions.
  - `api.ts`: exposed safe APIs (addRenderer, addComposerAction, addMemberDecoration, addCommand, registerSettingsTab, injectStylesheet, removePatch). All return disposables.
  - `registry.ts`: `PluginRegistry` class, provide/inject via `PluginsKey`, version bump reactive.
- [ ] Extend registries: `TimelineRegistry` stays; add `ComposerActions`, `MemberDecorations`, `CommandPalette` (or slash commands), `SettingsTabs`.
- [ ] Style injection: `injectStylesheet(css)` uses `CSSStyleSheet` or `<style>` scoped to shell root, adopted stylesheets preferred; respects CSP (no external URLs except allowlist). Advanced CSS path remains separate.
- [ ] Sandbox: plugins cannot access `window`, `document` globals directly except via `PluginContext`; no network unless context allows; no `eval/new Function`.
- [ ] Discovery: manifest (id, name, version, author, description, minCore/minUI). No remote plugin loading by default (local only, app-controlled).
- [ ] Example: timeline renderer registration via API, composer reaction action, member badge. 

## 6. Phase 3 — Theming Loader & UX

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
- [ ] Snapshot: token coverage (no hardcoded values), theme v2 roundtrip.
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
- `packages/ui/src/plugins/*` (Phase 2)
- Token audit checklist and migration notes 

Created: 2026-10-13