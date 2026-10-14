# Theme migration — token contract v1 → v2

Created: 2026-10-13
Scope: `REWRITE_PLAN.md` §4 (Phase 1 — Token System v2). Companion to
`docs/phase0-audit.md` (the v1 inventory this was built from).

## TL;DR

- `ThemeJson.version` is now **2** (`packages/theme/src/version.ts`).
- **A v1 theme keeps working.** Every v1 token still exists except one unused
  component knob (`shell-gap`). Validator: `[1, 2]` are accepted; anything else
  is a `warning` (`unsupported-version`), never an error.
- The registry grew from **102 → 271** tokens (91 primitive / 104 semantic /
  76 component) and gained nine value kinds — `size`, `shadow`, `z-index`,
  `line-height`, `letter-spacing`, `font-weight`, `border-width`, `opacity`
  (plus the existing color/spacing/radius/typography/motion/layout).
- Themes can now carry **mode overrides** (`modes.light`), emitted as
  `:root[data-theme="x"][data-mode="y"]`. Base (dark) stays `:root[data-theme="x"]`.
- The shipped `default.json` is a **complete snapshot** of the structural
  defaults plus the light-mode overrides.

## 1. Contract changes

### 1.1 Version handling

| file | before | after |
|---|---|---|
| `ThemeJson.version` | `1` | `2` |
| `src/version.ts` | `TOKEN_CONTRACT_VERSION = 1` | `TOKEN_CONTRACT_VERSION = 2`, `SUPPORTED_TOKEN_CONTRACT_VERSIONS = [1, 2]` |
| validator | version ignored | unsupported version → `unsupported-version` **warning** (theme still renders) |

A version warning is deliberately not an error: an unknown version means "this
build may not understand every token", which is a forward-compatibility signal,
not a broken document. Unknown *token names* remain errors (with
did-you-mean suggestions).

### 1.2 New token kinds

`TokenKind` (in `src/types.ts`) gained: `size`, `shadow`, `z-index`,
`line-height`, `letter-spacing`, `font-weight`, `border-width`, `opacity`.
Each has a value grammar in `src/validate/values.ts`:

| kind | accepted | notes |
|---|---|---|
| `size` | `<length>` (signed allowed) | icon/avatar/dot/dimensions, `-8px` stack overlap |
| `border-width` | `<length>` (signed allowed) | `1px`, `1.5px`, `2px`, `3px` |
| `shadow` | 1..n comma-separated `<length> <color>` layers | multi-layer box-shadows |
| `z-index` | `<integer>` | |
| `font-weight` | `<integer>` 1–1000 | `600`, `700` |
| `line-height` | `<number>` \| `<length>` | `1`, `1.35`, `1.5rem` |
| `letter-spacing` | `<length>` (signed) | `0.04em`, `0.25em` |
| `opacity` | `0..1` | |

Any value containing `var(--…)` short-circuits validation (it is a reference,
resolved separately).

### 1.3 Token delta

| tier | v1 | v2 | added | removed |
|---|---|---|---|---|
| primitive | 39 | 91 | 52 | 0 |
| semantic | 36 | 104 | 68 | 0 |
| component | 27 | 76 | 50 | 1 (`shell-gap`) |

Added groups worth knowing about, by tier:

- **primitive** — complete scales for the new kinds: `prim-space-px…6`,
  `prim-size-2xs…xl` (+ `hairline`, `scrollbar`, `indicator`,
  `stack-overlap`), `prim-border-width{,-medium,-strong,-accent}`,
  `prim-leading-{none,tight,normal}`, `prim-tracking-{wide,wider,emoji,emoji-lg}`,
  `prim-weight-{normal,semibold,bold}`, `prim-shadow-{sm,md,panel}`,
  `prim-z-{panel,dropdown,overlay,modal,toast}`,
  `prim-opacity-{disabled,muted}`, `prim-motion-slow`, the light-mode neutral
  rungs `prim-neutral-8…12`, and `prim-black`.
- **semantic** — the role layer for the above (`space-*`, `radius-*`, `text-*`
  incl. `text-lg`/`text-xl`, `icon-*`, `leading-*`, `tracking-*`, `weight-*`,
  `shadow-*`, `z-*`, `border-width*`, `motion-slow`), interaction state
  (`state-hover`, `state-selected`, `state-disabled-opacity`,
  `state-muted-opacity`), and the dimension roles the SFCs previously inlined
  (`control-sm/md/lg`, `avatar-xs/sm/md/lg`, `badge-min-size`,
  `presence-dot-size`, `rail-item-size`, `rail-pill-width`,
  `rail-favourite-min-width`, `timeline-gutter-width`, `scrollbar-width`,
  `hairline`, `focus-ring-width`, `focus-ring-offset`, `layout-dialog-width`,
  `layout-slideover-width`, `layout-menu-min-width`, `surface-{raised,inset,overlay}`,
  `surface-hover-contrast`, `text-on-{danger,warning}`).
- **component** — the knobs the audit found missing: `dialog-*`, `menu-*`,
  `popover-*`, `panel-*`, `overlay-bg`, `input-*`, `button-secondary-*`,
  `button-danger-*`, `badge-text`, `banner-*`, `composer-input-*`,
  `timeline-row-*`, `timeline-flash-duration`, `timeline-quote-bar-width`,
  `roomlist-item-radius`, `member-dot-size`, `member-badge-radius`,
  `avatar-*`, `media-*-max-width`, `picker-results-max-height`.

### 1.4 Removed / renamed

There are **no renames**. Removed since v1:

| token | why |
|---|---|
| `component/shell-gap` | never referenced; the shell uses pane-level spacing tokens |

(Tokens that were considered during Phase 1 and then dropped before shipping —
`accent-active`, `state-active`, `state-selected-border`, `overlay-z`,
`dialog-z`, `menu-shadow`, `popover-max-width`, `picker-results-gap`,
`button-primary-bg-active`, `input-placeholder`-adjacent leftovers,
`layout-popover-max-width` — never appeared in a v1 theme.)

Two **defaults** changed, which only affects a theme that overrides neither:

| token | v1 default | v2 default | effect |
|---|---|---|---|
| `component/timeline-row-gap` | `var(--space-1)` (4px) | `var(--space-2)` (8px) | now matches what `TimelineRow` always used inline; no visual change |
| `component/button-danger-bg` / `-bg-hover` | n/a | `var(--danger)` / `var(--danger-hover)` | see §3 |

### 1.5 Modes

`ThemeJson` gained an optional `modes` map:

```json
{
  "version": 2,
  "name": "my-theme",
  "tokens": { "…": "…" },
  "modes": { "light": { "surface-base": "var(--prim-neutral-9)" } }
}
```

- A mode map is an **override** map: missing tokens are not reported (unlike the
  base map, where missing tokens are `info`).
- Every mode is validated as its own scope with the base map as its parent, so
  per-mode reference cycles and per-mode tier violations are caught.
- Emission: base → `:root[data-theme="my-theme"]`; each mode →
  `:root[data-theme="my-theme"][data-mode="light"]` (same file, after the base
  block).
- The app ships dark as the default: `apps/web/index.html` sets
  `data-theme="default"` and no `data-mode`. Light is opt-in by setting
  `data-mode="light"` on the root element.
- The default theme implements light as **semantic-tier overrides only**
  (surfaces, text, border, shadows, mention) — primitives are not redefined, so
  a light theme still keeps one palette.

## 2. Authoring rules (what "token-everything" means here)

1. **Tier separation.** Component tokens reference semantic or component tokens
   only; primitives are reachable from the semantic tier. The validator errors
   on violations.
2. **Roles must be consumed; scales may not.** Every component token and every
   semantic *role* (color, layout, opacity, border-width, and non-scale sizes)
   has to be referenced somewhere — by another token or by an SFC — or it is
   dead weight. Semantic *scale* rungs (`space-*`, `radius-*`, `text-*` of kind
   `typography`, `icon-*`, plus every `font-weight`, `line-height`,
   `letter-spacing`, `shadow`, `z-index`, `motion` token) ship complete even
   when the current UI does not use every step, and primitives are a palette
   (unused rungs are expected).
   This is asserted by `packages/theme/test/coverage.test.ts`.
3. **The UI may reference any tier it likes** (`var(--space-2)` in an SFC is
   fine). What it may not do is inline a raw value: no hex/rgb/hsl, no `px`/`rem`
   in sizing except geometry (`0`, `100%`, `50%`, `auto`) and `transparent`.
   `50%` circles use `var(--radius-full)`.
   Enforced over the `<style>` blocks of every `.vue` in `packages/ui/src` and
   `apps/web/src` by `coverage.test.ts` (hex/rgb/hsl, `px`/`rem`/`em`, numeric
   `font-weight`). `apps/web/src/styles.css` is the one sanctioned exception —
   the pre-theme login surface, which is replaced wholesale in Phase 4.
4. **Local custom properties are allowed** (`--width: min(…); width: var(--width)`)
   — they are not tokens and not validated.

## 3. Intentional visual normalizations

Phase 1 was a *tokenization* pass: values were replaced by tokens that resolve
to the same thing. That was verified mechanically by pairing every removed and
added declaration in the SFC diff and comparing resolved values (unit-normalised):

> **319 declarations paired; 14 differ only in how the same value is written;
> 2 are intentional changes.**

The 14 non-changes are artifacts of the comparison (a `calc(2px * -1)` product,
`rgb(0 0 0 / 0.25)` vs `rgba(0, 0, 0, 0.25)`, a `var(--x, fallback)` whose
fallback was never reachable, `50%` vs `9999px` on a circle). The two real
changes:

- **Danger buttons now darken on hover.** `.tumult-dialog-danger` wrote
  `background: var(--danger-hover)` at rest and `var(--danger)` on hover — the
  inverse of the primary button (`--accent` → `--accent-hover`). It now uses
  `var(--button-danger-bg)` → `var(--button-danger-bg-hover)`, i.e.
  `#f23f43` at rest, `#c03537` on hover. This makes `button-danger-*` and
  `button-primary-*` mean the same thing (rest → hover, light → dark) instead of
  the token pair carrying an inverted convention.
- **The app's start-error toast is 14px, not 13px.** `AppView.vue`'s
  `.tumult-start-error` was the one surface in the app off the type scale
  (`font-size: 13px`); it now uses `var(--text-sm)` like every other
  banner/error surface.

Also notable, though invisible:

- `border-radius: 50%` → `var(--radius-full)` (identical for circles).
- `font-size: 22px` / `20px` glyphs now use `var(--icon-lg)` / `var(--icon-md)`,
  which resolve back to 22px / 20px (`prim-size-sm-plus` / `prim-size-sm`).
- `outline-offset: -1px` / `-2px` → `calc(var(--hairline) * -1)` /
  `calc(var(--focus-ring-offset) * -1)`.
- Dead `var(--x, fallback)` second arguments were dropped (`--surface-pane`,
  `--surface-hover`, `--radius-sm` are always defined).

## 4. Bundle impact

| asset | v1 | v2 |
|---|---|---|
| `base.css` | 102 vars, 3.9 kB raw | **271 vars, 10.8 kB raw, 2.2 kB gzip** |
| `default.css` | 27 vars, 1.2 kB raw | **271 vars + 14 mode vars, 11.5 kB raw, 2.4 kB gzip** |
| app CSS total (gzip) | 7.49 kB | **9.79 kB** |

`base.css` emitting every registered token is required by the plan ("emit CSS
vars for all registered tokens"): a theme can now replace any single value
without a build step. `default.css` doubling is the cost of the complete
default theme; a drift test (`themes.test.ts`) fails if it ever disagrees with
the registry, so it cannot rot into a stale override set.

## 5. Deferred / not in v2

- **Density** (compact/cozy row heights): a multiplier or explicit row tokens
  affects layout beyond tokens (virtualizer row heights are computed in TS).
  Parked for Phase 4.
- **Breakpoints** as tokens: CSS custom properties cannot drive `@media`
  conditions, so breakpoint tokens would be documentation only. Not added.
- **Production CSP delivery**: still undecided (host headers recommended).
  Phase 3 / deploy, see `docs/phase0-audit.md` §4.
- Unused scale rungs shipped on purpose: `space-5`, `radius-xs`, `radius-lg`,
  `leading-tight`, `leading-normal`, `weight-normal`, `icon-xs`, `icon-sm`,
  `shadow-sm`, `z-dropdown`, `z-overlay`, `z-modal`, `z-toast`, `motion-base`.

## 6. Verifying a migrated theme

```sh
pnpm --filter @tumult/theme build      # compiles themes/*.json -> dist/themes/*.css
pnpm --filter @tumult/theme test       # validator + coverage + default-theme drift
```

Or programmatically:

```ts
import { validateTheme } from "@tumult/theme";

const result = validateTheme(JSON.parse(json));
result.issues.filter((i) => i.severity === "error"); // must be empty
```
