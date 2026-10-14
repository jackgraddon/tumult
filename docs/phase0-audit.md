# Phase 0 — Audit & Baseline

Created: 2026-10-13
Scope: `REWRITE_PLAN.md` §3 (Phase 0). Read-only except one token bug fix; all
figures below are reproducible from the commands in §0.

## 0. Method (reproduce everything)

```sh
# Hardcoded-value inventory (from packages/ui/src)
grep -rnE '#[0-9a-fA-F]{3,8}\b'                    packages/ui/src --include='*.vue'
grep -rnE '(rgba?\(|hsla?\()'                      packages/ui/src --include='*.vue'
grep -rnE '[0-9.]+px'                              packages/ui/src --include='*.vue'
grep -rn  'font-size'                              packages/ui/src --include='*.vue' | grep -v 'var(--text'
grep -rnE 'font-weight: *[0-9]'                    packages/ui/src --include='*.vue'
grep -rnE '(z-index|line-height|letter-spacing|border-radius|box-shadow|opacity): *[^;]+' \
     packages/ui/src --include='*.vue' | grep -v 'var(--'

# Used-vs-registered tokens
grep -rhoE 'var\(--[a-z0-9-]+' packages/ui/src apps/web/src --include='*.vue' --include='*.css' \
  | sed 's/var(--//' | sort -u                                   # used
grep -rhoE '\{ name: "[a-z0-9-]+"' packages/theme/src/registry/*.ts \
  | sed 's/.*name: "//; s/"//' | sort -u                         # registered
comm -23 <(used) <(registered)    # used but unregistered
comm -13 <(used) <(registered)    # registered but unused

# Bundle baseline
rm -rf apps/web/dist && pnpm build
cat apps/web/dist/index.html
du -ch apps/web/dist/assets/*.css | tail -1
```

Runtime paint baseline (§1.3): production preview of the fake-client build
(`apps/web/src/chat.ts` temporarily pointed at `chat.fake.ts`, session seeded
into `localStorage` so the router guard passes), driven over CDP by
`chrome-headless-shell` 155 with a `MutationObserver` marking
`.tumult-shell` / `.tumult-room-item` / `.tumult-row` plus a buffered
`paint` PerformanceObserver. Harness: `measure.mjs` in the session temp dir
(not committed). The source swap was reverted and the tree rebuilt with the
real client afterwards.

## 1. Baseline metrics

### 1.1 Production bundle (clean build, gzip)

| asset | raw | gzip | role |
|---|---|---|---|
| `index.html` | 0.51 kB | 0.31 kB | shell |
| `index-*.js` (entry) | 104.73 kB | 40.65 kB | app bootstrap + router |
| `AppView-*.js` | 254.98 kB | 69.77 kB | shell + `@tumult/ui` (statically imported by entry) |
| `index-*.js` (second) | 227.39 kB | 46.02 kB | imported only by the chat chunk |
| `chat-*.js` | 892.94 kB | 248.15 kB | matrix-js-sdk (lazy) |
| `LoginView-*.js` / `CallbackView-*.js` / `classify-*.js` | 1.11 / 0.87 / 0.11 kB | 0.69 / 0.57 / 0.13 kB | lazy routes |
| `index-*.css` (entry) | 5.06 kB | 1.34 kB | reset + theme |
| `AppView-*.css` | 45.16 kB | 6.15 kB | all SFC styles for the shell |
| **CSS total** | **50.22 kB** | **7.49 kB** | |
| `matrix_sdk_crypto_wasm_bg-*.wasm` | 7805.49 kB | 2114.89 kB | Rust crypto (lazy, cached) |

Initial signed-in route ≈ entry + AppView ≈ **110 kB gzip JS / 7.5 kB gzip CSS**;
the SDK chunk (248 kB gzip) streams in parallel and is the lazy boundary.
Theme CSS is tiny: `base.css` 3.9 kB (102 tokens), `default.css` 1.2 kB (27).

> Note: the pre-existing `apps/web/dist` was stale (two orphan `index-*.js`,
> one a 940 kB leftover). Deleted before measuring — treat any older local
> numbers as invalid.

### 1.2 Vite build warning
One warning only, expected: `chat-*.js` > 500 kB (the SDK). No new warnings.

### 1.3 Runtime paint (fake client, warm + cold cache)
Production preview, `chrome-headless-shell` 155, 1440×900, fake client, empty
browser cache on cold runs:

| metric | warm (n=6) | cold / cache-disabled (n=5) |
|---|---|---|
| shell present (`.tumult-shell`) | 51 ms median (39.7–54.7) | 65.7 ms median |
| room items present | same frame as shell | same |
| timeline rows present | same frame as shell | same |
| DCL / load | 6–12 / 7.6–14.8 ms | — |

The fake client paints the full shell (rail + rooms + timeline) in a single
frame; there is no data waterfall to measure. This is the low-water baseline —
real-server numbers (AGENTS.md: first paint ~97 ms, shell ~185 ms, room list
~2.5 s / 98 rooms) are the one that matters for regressions and need the
browser MCP session, not this harness.

## 2. Token audit — `packages/ui/src` (44 SFCs)

### 2.1 One fixed defect
`--accent-primary` (used in `members/PowerLevelDialog.vue` for the selected
power preset) **was never registered**, so both declarations silently no-op'd.
Replaced with `--accent`. No other unregistered token is referenced: the only
other unknown, `--width`, is a *local* custom property set in
`VerificationModal.vue` — a legitimate pattern, not a violation.

### 2.2 Violation inventory (counts are occurrences, not files)

| class | count | files | samples |
|---|---|---|---|
| `px` literals | 208 | 30 | 62×`1px`, 58×`2px`, 19×`4px`, 15×`8px`, 8×`32px`, 6×`48px`, fixed widths `360/320/280/240/200/160px` |
| `font-weight` literals | 27 | 16 | `600` ×21, `700` ×6 |
| `letter-spacing` literals | 9 | 7 | `0.04em` ×5 (small-caps section labels), `0.08em`, `0.25em`, `0.5em` |
| `line-height` literals | 6 | 4 | `1` ×5 (icon glyph alignment) |
| `opacity` literals | 7 | 6 | `0.5` ×6 (muted/disabled), `0.7` |
| hex colors | 4 | 3 | `#111214` (banner/badge text), `#fff` ×2 |
| `rgba()`/`rgb()` | 7 | 7 | dialog backdrops `rgba(0,0,0,.6)` ×3, `box-shadow` ×2, `rgba(0,0,0,.08)` |
| non-token `border-radius` | 3 | 3 | `50%` ×2, `0 4px 4px 0` (rail indicator) |
| `z-index` literals | 2 | 2 | `5` ×2 (thread overlay, search panel) |
| non-token `gap` | 6 | 5 | `2px` ×4, `4px` ×2 |
| `font-size` not `var(--text-*)` | 7 of 101 | 7 | `1.5rem`, `1.25rem` (verification emoji), `8px`/`9px`/`20px`/`22px` (avatar + rail glyphs) |

Per-file, ordered by violation weight (`px` = px literals, `rgb` = rgba/rgb,
`fs` = non-token font-size, `fw` = numeric font-weight, `ls` = letter-spacing,
`lh` = line-height, `op` = opacity, `rad` = non-token border-radius, `z` =
z-index, `gap` = non-token gap). This is the Phase 1 worklist:

```
path                              px  hex rgb fs fw ls lh op rad z gap
-----------------------------------------------------------------------
timeline/TimelineRow.vue          40   0   1   1  5  0  1  1   0  0  2
rail/GuildRail.vue                16   0   0   2  1  1  2  0   1  0  1
timeline/MessageComposer.vue      14   0   0   0  2  0  2  2   0  0  0
timeline/SearchPanel.vue          13   0   1   0  1  0  0  1   0  1  1
rail/AccountTile.vue              13   0   0   0  1  0  0  0   0  0  0
rail/GuildRailItem.vue             9   0   0   0  0  0  0  0   1  0  0
primitives/Avatar.vue              9   0   0   1  1  0  0  0   0  0  0
rooms/RoomDialog.vue               6   0   1   0  3  1  0  1   0  0  0
members/MembersPane.vue            6   0   0   0  3  2  0  0   0  0  0
security/RecoveryRestoreModal.vue  6   0   0   0  1  0  0  1   0  0  0
timeline/renderers/MediaMessage.vue 6  0   0   0  0  0  0  0   0  0  0
shell/TumultShell.vue              5   0   1   0  0  0  0  0   0  1  0
members/MemberListItem.vue         5   0   0   0  0  1  0  0   0  0  0
timeline/TimelineViewport.vue      4   0   0   0  2  1  0  0   0  0  0
security/SecurityBanner.vue        4   1   1   0  1  0  0  0   0  0  0
security/RecoverySetupModal.vue    4   0   1   0  1  0  0  0   0  0  0
rail/DmsRailItem.vue               4   0   0   1  0  0  0  0   0  0  0
rooms/UserPicker.vue               4   0   0   0  0  0  0  0   0  0  1
threads/ThreadList.vue             4   0   0   0  0  0  0  0   1  0  1
primitives/IconButton.vue          4   0   0   0  0  0  0  0   0  0  0
security/VerificationModal.vue     3   0   1   2  2  2  0  1   0  0  0
primitives/UnreadBadge.vue         3   1   0   0  1  0  1  0   0  0  0
roomlist/SpaceCategory.vue         3   0   0   0  1  1  0  0   0  0  0
rooms/RoomSettingsDialog.vue       3   0   0   0  0  0  0  0   0  0  0
roomlist/LoadMoreRooms.vue         3   0   0   0  0  0  0  0   0  0  0
threads/ThreadPanel.vue            3   0   0   0  0  0  0  0   0  0  0
roomlist/RoomListPane.vue          2   0   0   0  0  0  0  0   0  0  0
timeline/TimelinePane.vue          1   0   0   0  0  0  0  0   0  0  0
roomlist/RoomListItem.vue          1   0   0   0  0  0  0  0   0  0  0
roomlist/DmList.vue                1   0   0   0  0  0  0  0   0  0  0
shell/ConnectionBanner.vue         0   2   0   0  1  0  0  0   0  0  0
```

Not violations (proposed rules in §2.4): `background: transparent` (24×),
`min-height: 0` (15×, flex idiom), `outline: none` (2×, paired with focus
rings), inline `:style` (4× — virtualizer transforms and Reka's own scroll-area
style attributes), local custom properties declared in the same rule
(`--width`).

### 2.3 App-level stylesheet
`apps/web/src/styles.css` is the pre-theme login/placeholder sheet and still
carries 7 hardcoded colors (`#1a1b1e`, `#e8e8ea`, `#3a3b40`, `#26272b`,
`#9a9aa2` ×2, `#ff8080`) plus rem-based form styling. It is explicitly stamped
"Placeholder only … Nothing in this file should be treated as a precedent".
It goes with the token-complete pass when the login surface is redesigned
(Phase 4); until then it is the one sanctioned exception in `apps/web`.

### 2.4 Rules to ratify (Phase 1 gate)
1. No hex/rgb/hsl literals in SFC styles or `apps/web` — colors come from tokens.
2. No `font-weight` literals (`600`/`700` are weights; add weight tokens).
3. No `font-size` literals: `var(--text-*)` only.
4. Spacing/`gap` values must be tokens, except `1px`/`2px` **borders and
   hairlines**, which may stay literal (or become a `border-width` token).
5. Fixed dimensions (icon sizes, avatar sizes, dialog widths, pane widths) must
   be tokens once the icon/overlay token set exists.
6. `transparent`, `min-height: 0`, `outline: none`, `100%`/`auto`/`dvh`, and
   virtualizer `:style` are allowed.
7. `50%` circles are allowed (geometry, not a design value) — or `--radius-round`.

## 3. Coverage matrix & Phase 1 gap list

- Registry: **102** tokens (39 primitive / 36 semantic / 27 component).
  App references **56**.
- Used-but-unregistered: **0** after §2.1.
- Component tier: 24 of 27 used; 3 unused — `button-danger-bg` (danger buttons
  write `background: var(--danger)` directly instead — pick one),
  `shell-gap`, `timeline-row-gap`.
- Registered-but-unused (47) is almost entirely primitives (ramp values) plus
  `accent-hover`, `accent-contrast`, `focus-ring`, `mention`, `motion-base`,
  `button-danger-bg`, `shell-gap`, `timeline-row-gap` — harmless, but
  `accent-hover`/`accent-contrast` unused means states are inlined at call sites.

Missing token *kinds* (the actual "token-everything" gap — most violations in
§2 trace to a missing token, not to laziness):

| gap | Phases |
|---|---|
| shadow / elevation scale (3 shadow literals today) | 1, 4 |
| z-index scale (overlay/menu/dialog order) | 1 |
| line-height + letter-spacing + font-weight typography tokens | 1 |
| icon-size tokens (32/48/24/20/16/9px glyphs) | 1 |
| state tokens per component: hover/active/selected/focus/disabled | 1 |
| density (compact/cozy row height) | 1, 4 |
| dialog/overlay dimensions (three different width idioms today) | 1, 4 |
| light mode (`:root[data-theme][data-mode]`) — nothing exists | 1 |

`default.json` (v1) re-declares 27 structural defaults already emitted by
`base.css`; it has no state/shadow/type tokens. Version is 1 in both the file
and `src/version.ts`.

## 4. CSP review

- **Dev only.** The whole policy lives in `apps/web/vite.config.ts`
  `server.headers`. Production (`index.html`, no meta tag, no deploy config in
  the repo) ships with **no CSP at all**.
- Current dev policy: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'`;
  `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https:`;
  `media-src 'self' blob:`; `connect-src 'self' https: wss:`; `worker-src 'self' blob:`.
- Correct today: `'wasm-unsafe-eval'` (Rust crypto) and `media-src blob:`
  (slice 26: without it `<video>`/`<audio>` fall back to `default-src`).
- **`style-src 'unsafe-inline'` is load-bearing**: Vite injects styles in dev
  and Reka writes inline `style` attributes at runtime (visible in the built
  DOM: the rail scroll area). Phase 3's advanced-CSS path must either accept
  this or move to CSP3 `style-src-attr`/nonces — decide before writing the
  loader, not after.
- `img-src https:` and `connect-src https: wss:` are broad (`https:` allows any
  origin). Media now flows through authed `/_matrix/...` requests, so a
  tightening pass is a candidate follow-up — but avatars/thumbnails must be
  re-checked first.
- Production delivery is **undecided**: recommended = host-header CSP (a meta
  tag cannot express `frame-ancestors` and is easy to bypass), with the same
  policy as dev minus dev-injection needs. Needs a deployment target decision.

## 5. Phase 1 worklist (derived from the above)

1. Extend `TokenKind` with `shadow`, `z-index`, `line-height`,
   `letter-spacing`, `font-weight`, `icon-size` (and optionally `breakpoint`).
2. Add the missing primitives/semantic tokens for those kinds, plus a shadow
   scale and z-index scale.
3. Add per-component **state** tokens (hover/active/selected/focus/disabled)
   and reconcile `button-danger-bg` vs raw `var(--danger)`, and fold the
   `accent-hover`/`accent-contrast` inlined states into tokens.
4. Version bump to 2 (`ThemeJson.version` + `src/version.ts`) with migration
   notes; `:root[data-theme][data-mode]` support (dark default, light opt-in).
5. Expand `default.json` v2 to cover every component token; keep v1 themes
   valid where possible.
6. Token-complete SFC pass driven by the §2.2 per-file table, in this order:
   TimelineRow (40 px, 5 weights) → GuildRail → MessageComposer → SearchPanel →
   AccountTile → the rest. Ratify §2.4 rules first; consider a source-scanning
   test (see §6) as the gate.

## 6. Testing gaps (for Phase 5)

- `packages/ui` has **no test script** — a "no hardcoded values" snapshot test
  has no home yet. Cheapest option: a `node --test` source scan in
  `packages/theme/test/` (it already owns registry/validator tests and needs no
  Vue toolchain), asserting the §2.4 rules over `packages/ui/src/**/*.vue`.
- `packages/theme` currently has 1 test file (`test/validate.test.ts`).

## 7. Open questions

1. Border/hairline literals: allow `1px solid` or introduce `--border-width`?
2. `50%` circles: allow or `--radius-round`?
3. Density: one `--density` multiplier or explicit compact/cozy row tokens?
4. Production CSP: host headers (recommended) vs meta; which deploy target?
5. `--text-*` naming: keep `text-xs/sm/md` or add `lg`/`xl` (dialogs use
   `1.25/1.5rem`)?
