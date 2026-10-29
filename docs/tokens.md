# Tumult token reference

Generated — **do not edit by hand**. Structure comes from the registry
(`packages/theme/src/registry/`); the values come from the built-in theme
document (`packages/theme/themes/default.json`). Regenerate with
`pnpm --filter @tumult/theme build`.

The **built-in value** column is what a theme inherits when it does not set
the token — an installed theme is a sparse overlay on this document (see
[`themes.md`](./themes.md)). Semantic and component values are `var(…)`
references rather than colours: overriding the primitive they point at moves
everything built on it.

**289 tokens** — 91 primitives, 108 semantic, 90 component.

## Primitives

| token | kind | built-in value | description |
|---|---|---|---|
| `--prim-brand-0` | color | `oklch(93% 0.06 165.23)` | Lightest brand tint. |
| `--prim-brand-1` | color | `oklch(85% 0.11 165.23)` | Light brand. |
| `--prim-brand-2` | color | `oklch(78% 0.15 165.23)` | Mid brand. |
| `--prim-brand-3` | color | `oklch(70.4% 0.191 165.23)` | Primary accent. |
| `--prim-brand-4` | color | `oklch(64% 0.17 165.23)` | Accent hover. |
| `--prim-brand-5` | color | `oklch(54% 0.13 165.23)` | Accent active. |
| `--prim-neutral-0` | color | `oklch(100% 0 0)` | Pure white. |
| `--prim-neutral-1` | color | `oklch(98% 0 0)` | Primary text on dark. |
| `--prim-neutral-2` | color | `oklch(60% 0 0)` | Secondary text. |
| `--prim-neutral-3` | color | `oklch(50% 0 0)` | Muted text. |
| `--prim-neutral-4` | color | `oklch(100% 0 0 / 0.08)` | Borders. |
| `--prim-neutral-5` | color | `oklch(12% 0 0)` | Pane background. |
| `--prim-neutral-6` | color | `oklch(0% 0 0)` | Deep background. |
| `--prim-neutral-7` | color | `oklch(16% 0 0)` | Rail background. |
| `--prim-neutral-8` | color | `oklch(100% 0 0)` | Light-mode surface. |
| `--prim-neutral-9` | color | `oklch(96% 0 0)` | Light-mode pane. |
| `--prim-neutral-10` | color | `oklch(90% 0 0)` | Light-mode border. |
| `--prim-neutral-11` | color | `oklch(50% 0 0)` | Secondary text on light. |
| `--prim-neutral-12` | color | `oklch(58% 0 0)` | Muted text on light. |
| `--prim-green-3` | color | `#23a55a` | Success / online. |
| `--prim-red-3` | color | `#f23f43` | Danger. |
| `--prim-red-4` | color | `#c03537` | Danger hover. |
| `--prim-amber-3` | color | `#f0b232` | Warning / pending. |
| `--prim-mention-3` | color | `#f0b232` | Mention highlight base. |
| `--prim-black` | color | `#000000` | Black. |
| `--prim-space-px` | spacing | `0.0625rem` | 1px. |
| `--prim-space-0-5` | spacing | `0.125rem` | 2px. |
| `--prim-space-1` | spacing | `0.25rem` | 4px. |
| `--prim-space-1-5` | spacing | `0.375rem` | 6px. |
| `--prim-space-2` | spacing | `0.5rem` | 8px. |
| `--prim-space-3` | spacing | `0.75rem` | 12px. |
| `--prim-space-4` | spacing | `1rem` | 16px. |
| `--prim-space-5` | spacing | `1.5rem` | 24px. |
| `--prim-space-6` | spacing | `2rem` | 32px. |
| `--prim-radius-xs` | radius | `0.125rem` | 2px radius. |
| `--prim-radius-sm` | radius | `0.375rem` | Small radius. |
| `--prim-radius-md` | radius | `0.5rem` | Default radius. |
| `--prim-radius-lg` | radius | `0.625rem` | Large radius. |
| `--prim-radius-full` | radius | `9999px` | Pills / avatars. |
| `--prim-font-sans` | typography | `Figtree, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif` | UI font stack. |
| `--prim-font-mono` | typography | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` | Mono stack. |
| `--prim-text-2xs` | typography | `0.5625rem` | 9px. |
| `--prim-text-xs` | typography | `0.75rem` | 12px. |
| `--prim-text-sm` | typography | `0.875rem` | 14px. |
| `--prim-text-md` | typography | `1rem` | 16px. |
| `--prim-text-lg` | typography | `1.25rem` | 20px. |
| `--prim-text-xl` | typography | `1.5rem` | 24px. |
| `--prim-weight-normal` | font-weight | `400` | Regular weight. |
| `--prim-weight-semibold` | font-weight | `600` | Semibold. |
| `--prim-weight-bold` | font-weight | `700` | Bold. |
| `--prim-leading-none` | line-height | `1` | Tight glyph leading. |
| `--prim-leading-tight` | line-height | `1.25` | Tight leading. |
| `--prim-leading-normal` | line-height | `1.5` | Body leading. |
| `--prim-tracking-wide` | letter-spacing | `0.04em` | Small-caps label tracking. |
| `--prim-tracking-wider` | letter-spacing | `0.08em` | Rail heading tracking. |
| `--prim-tracking-emoji` | letter-spacing | `0.25em` | Verification digit spacing. |
| `--prim-tracking-emoji-lg` | letter-spacing | `0.5em` | Verification emoji spacing. |
| `--prim-size-2xs` | size | `8px` | Presence dot / spacer. |
| `--prim-size-xs` | size | `16px` | Small icon / badge. |
| `--prim-size-sm` | size | `20px` | Small glyph. |
| `--prim-size-sm-plus` | size | `22px` | Compact control. |
| `--prim-size-md` | size | `24px` | Row gutter / avatar sm. |
| `--prim-size-lg` | size | `32px` | Icon button / avatar md. |
| `--prim-size-xl` | size | `48px` | Rail item / avatar lg. |
| `--prim-size-hairline` | size | `1px` | Divider / separator. |
| `--prim-size-scrollbar` | size | `6px` | Scrollbar thickness. |
| `--prim-size-indicator` | size | `4px` | Selection pill width. |
| `--prim-size-stack-overlap` | size | `-8px` | Read-receipt avatar stack overlap. |
| `--prim-shadow-sm` | shadow | `0 1px 2px rgba(0, 0, 0, 0.3)` | Subtle elevation. |
| `--prim-shadow-md` | shadow | `0 3px 3px rgba(0, 0, 0, 0.12)` | Popover / chip palette. |
| `--prim-shadow-panel` | shadow | `-8px 0 24px rgba(0, 0, 0, 0.25)` | Slide-over panel edge. |
| `--prim-z-panel` | z-index | `5` | In-pane slide-over. |
| `--prim-z-dropdown` | z-index | `50` | Menus / popovers. |
| `--prim-z-overlay` | z-index | `100` | Dialog backdrop. |
| `--prim-z-modal` | z-index | `110` | Dialog surface. |
| `--prim-z-toast` | z-index | `120` | Toasts. |
| `--prim-opacity-disabled` | opacity | `0.5` | Disabled controls. |
| `--prim-opacity-muted` | opacity | `0.7` | Busy / de-emphasised. |
| `--prim-border-width` | border-width | `1px` | Default border. |
| `--prim-border-width-medium` | border-width | `1.5px` | Thin ring / hollow marker. |
| `--prim-border-width-strong` | border-width | `2px` | Emphasis border / ring. |
| `--prim-border-width-accent` | border-width | `3px` | Quote / reply accent bar. |
| `--prim-motion-fast` | motion | `120ms` | Hover fades. |
| `--prim-motion-base` | motion | `200ms` | Default transition. |
| `--prim-motion-slow` | motion | `2.4s` | Jump-to-message flash. |
| `--prim-motion-ease` | motion | `ease-out` | Default easing. |
| `--prim-layout-rail` | layout | `72px` | Guild rail width. |
| `--prim-layout-roomlist` | layout | `240px` | Room list width. |
| `--prim-layout-members` | layout | `240px` | Members width. |
| `--prim-layout-slideover` | layout | `360px` | Search / thread slide-over width. |
| `--prim-layout-menu-min` | layout | `200px` | Dropdown menu minimum width. |

## Semantic

| token | kind | built-in value | description |
|---|---|---|---|
| `--surface-base` | color | `var(--prim-neutral-6)` | App background. |
| `--surface-pane` | color | `var(--prim-neutral-5)` | Pane background. |
| `--surface-raised` | color | `var(--prim-neutral-7)` | Menus / popovers / dialogs. |
| `--surface-rail` | color | `var(--prim-neutral-7)` | Guild rail background. |
| `--surface-inset` | color | `var(--surface-base)` | Inputs and wells inside a pane. |
| `--surface-overlay` | color | `rgba(0, 0, 0, 0.6)` | Dialog backdrop. |
| `--surface-hover` | color | `rgba(255, 255, 255, 0.06)` | Hover wash. |
| `--surface-active` | color | `rgba(255, 255, 255, 0.1)` | Active / selected wash. |
| `--surface-hover-contrast` | color | `rgba(0, 0, 0, 0.08)` | Hover wash on a bright (banner) surface. |
| `--text-primary` | color | `var(--prim-neutral-1)` | Primary text. |
| `--text-secondary` | color | `var(--prim-neutral-2)` | Secondary text. |
| `--text-muted` | color | `var(--prim-neutral-3)` | Muted text. |
| `--text-on-warning` | color | `var(--prim-neutral-7)` | Text on warning surfaces. |
| `--text-on-danger` | color | `var(--prim-neutral-0)` | Text on danger surfaces. |
| `--accent` | color | `var(--prim-brand-3)` | Primary accent. |
| `--accent-hover` | color | `var(--prim-brand-4)` | Accent hover. |
| `--accent-contrast` | color | `oklch(0% 0 0)` | Text on accent. |
| `--danger` | color | `var(--prim-red-3)` | Danger. |
| `--danger-hover` | color | `var(--prim-red-4)` | Danger hover. |
| `--success` | color | `var(--prim-green-3)` | Success / online. |
| `--warning` | color | `var(--prim-amber-3)` | Warning / pending. |
| `--mention` | color | `var(--prim-mention-3)` | Mention highlight. |
| `--border-default` | color | `var(--prim-neutral-4)` | Default border. |
| `--state-hover` | color | `var(--surface-hover)` | Generic hover background. |
| `--state-selected` | color | `var(--surface-active)` | Selected background. |
| `--state-disabled-opacity` | opacity | `var(--prim-opacity-disabled)` | Disabled controls. |
| `--state-muted-opacity` | opacity | `var(--prim-opacity-muted)` | Busy / de-emphasised. |
| `--focus-ring` | color | `var(--accent)` | Focus ring colour. |
| `--focus-ring-width` | border-width | `var(--prim-border-width-strong)` | Focus ring thickness. |
| `--focus-ring-offset` | border-width | `2px` | Default focus ring offset. |
| `--space-px` | spacing | `var(--prim-space-px)` | Hairline space (1px). |
| `--space-0-5` | spacing | `var(--prim-space-0-5)` | Semantic space 0.5 (2px). |
| `--space-1` | spacing | `var(--prim-space-1)` | Semantic space 1 (4px). |
| `--space-1-5` | spacing | `var(--prim-space-1-5)` | Semantic space 1.5 (6px). |
| `--space-2` | spacing | `var(--prim-space-2)` | Semantic space 2 (8px). |
| `--space-3` | spacing | `var(--prim-space-3)` | Semantic space 3 (12px). |
| `--space-4` | spacing | `var(--prim-space-4)` | Semantic space 4 (16px). |
| `--space-5` | spacing | `var(--prim-space-5)` | Semantic space 5 (24px). |
| `--space-6` | spacing | `var(--prim-space-6)` | Semantic space 6 (32px). |
| `--radius-xs` | radius | `var(--prim-radius-xs)` | Semantic radius xs. |
| `--radius-sm` | radius | `var(--prim-radius-sm)` | Semantic radius sm. |
| `--radius-md` | radius | `var(--prim-radius-md)` | Semantic radius md. |
| `--radius-lg` | radius | `var(--prim-radius-lg)` | Semantic radius lg. |
| `--radius-full` | radius | `var(--prim-radius-full)` | Semantic radius full. |
| `--font-sans` | typography | `var(--prim-font-sans)` | UI font. |
| `--font-mono` | typography | `var(--prim-font-mono)` | Mono font. |
| `--text-2xs` | typography | `var(--prim-text-2xs)` | 9px. |
| `--text-xs` | typography | `var(--prim-text-xs)` | 12px. |
| `--text-sm` | typography | `var(--prim-text-sm)` | 14px. |
| `--text-md` | typography | `var(--prim-text-md)` | 16px. |
| `--text-lg` | typography | `var(--prim-text-lg)` | 20px. |
| `--text-xl` | typography | `var(--prim-text-xl)` | 24px. |
| `--weight-normal` | font-weight | `var(--prim-weight-normal)` | Regular. |
| `--weight-semibold` | font-weight | `var(--prim-weight-semibold)` | Semibold. |
| `--weight-bold` | font-weight | `var(--prim-weight-bold)` | Bold. |
| `--leading-none` | line-height | `var(--prim-leading-none)` | Glyph leading. |
| `--leading-tight` | line-height | `var(--prim-leading-tight)` | Tight leading. |
| `--leading-normal` | line-height | `var(--prim-leading-normal)` | Body leading. |
| `--tracking-wide` | letter-spacing | `var(--prim-tracking-wide)` | Label tracking. |
| `--tracking-wider` | letter-spacing | `var(--prim-tracking-wider)` | Rail heading tracking. |
| `--tracking-emoji` | letter-spacing | `var(--prim-tracking-emoji)` | Verification digits. |
| `--tracking-emoji-lg` | letter-spacing | `var(--prim-tracking-emoji-lg)` | Verification emoji. |
| `--icon-xs` | size | `var(--prim-size-2xs)` | 8px glyph / dot. |
| `--icon-sm` | size | `var(--prim-size-xs)` | 16px glyph. |
| `--icon-md` | size | `var(--prim-size-sm)` | 20px glyph. |
| `--icon-lg` | size | `var(--prim-size-sm-plus)` | 22px glyph. |
| `--control-sm` | size | `var(--prim-size-sm-plus)` | 22px control. |
| `--control-md` | size | `var(--prim-size-lg)` | 32px control. |
| `--control-lg` | size | `var(--prim-size-xl)` | 48px control. |
| `--avatar-xs` | size | `var(--prim-size-xs)` | 16px avatar. |
| `--avatar-sm` | size | `var(--prim-size-md)` | 24px avatar. |
| `--avatar-md` | size | `var(--prim-size-lg)` | 32px avatar. |
| `--avatar-lg` | size | `var(--prim-size-xl)` | 48px avatar. |
| `--avatar-stack-overlap` | size | `var(--prim-size-stack-overlap)` | Read-receipt stack overlap. |
| `--hairline` | size | `var(--prim-size-hairline)` | Divider thickness. |
| `--scrollbar-width` | size | `var(--prim-size-scrollbar)` | Scrollbar thickness. |
| `--rail-pill-width` | size | `var(--prim-size-indicator)` | Guild selection pill. |
| `--rail-item-size` | size | `var(--prim-size-xl)` | Rail button size. |
| `--rail-favourite-min-width` | size | `30px` | Favourite band item. |
| `--timeline-gutter-width` | size | `var(--prim-size-md)` | Message gutter. |
| `--badge-min-size` | size | `var(--prim-size-xs)` | Unread badge. |
| `--presence-dot-size` | size | `var(--prim-size-2xs)` | Presence dot. |
| `--border-width` | border-width | `var(--prim-border-width)` | Default border. |
| `--border-width-medium` | border-width | `var(--prim-border-width-medium)` | Thin ring (hollow presence dot). |
| `--border-width-strong` | border-width | `var(--prim-border-width-strong)` | Emphasis border. |
| `--border-width-accent` | border-width | `var(--prim-border-width-accent)` | Quote / reply accent bar. |
| `--shadow-sm` | shadow | `var(--prim-shadow-sm)` | Subtle elevation. |
| `--shadow-md` | shadow | `var(--prim-shadow-md)` | Popover elevation. |
| `--shadow-panel` | shadow | `var(--prim-shadow-panel)` | Slide-over edge. |
| `--z-panel` | z-index | `var(--prim-z-panel)` | In-pane slide-over. |
| `--z-dropdown` | z-index | `var(--prim-z-dropdown)` | Menus / popovers. |
| `--z-overlay` | z-index | `var(--prim-z-overlay)` | Dialog backdrop. |
| `--z-modal` | z-index | `var(--prim-z-modal)` | Dialog surface. |
| `--z-toast` | z-index | `var(--prim-z-toast)` | Toasts. |
| `--motion-fast` | motion | `var(--prim-motion-fast)` | Fast motion. |
| `--motion-base` | motion | `var(--prim-motion-base)` | Base motion. |
| `--motion-slow` | motion | `var(--prim-motion-slow)` | Flash motion. |
| `--motion-ease` | motion | `var(--prim-motion-ease)` | Easing. |
| `--layout-guild-rail-width` | layout | `var(--prim-layout-rail)` | Guild rail width. |
| `--layout-roomlist-width` | layout | `var(--prim-layout-roomlist)` | Room list width. |
| `--layout-members-width` | layout | `var(--prim-layout-members)` | Members width. |
| `--layout-slideover-width` | layout | `var(--prim-layout-slideover)` | Search / thread panel width. |
| `--layout-menu-min-width` | layout | `var(--prim-layout-menu-min)` | Menu minimum width. |
| `--layout-dialog-width` | layout | `28rem` | Dialog width before viewport clamp. |
| `--layout-voice-tile-min-width` | layout | `14rem` | Narrowest video tile in a call; the stage fits as many per row as this allows. |
| `--layout-voice-stage-max-height` | layout | `24rem` | Tallest the video stage above the timeline may grow before it scrolls. |
| `--layout-settings-nav-width` | layout | `14rem` | Settings sidebar width. |
| `--layout-settings-content-width` | layout | `46rem` | Settings page column max width. |

## Component

| token | kind | built-in value | description |
|---|---|---|---|
| `--control-radius` | radius | `var(--radius-md)` | Inputs / buttons / rows. |
| `--focus-ring-color` | color | `var(--focus-ring)` | Focus outline colour. |
| `--focus-ring-outline` | border-width | `var(--focus-ring-width)` | Focus outline thickness. |
| `--rail-indicator` | color | `var(--accent)` | Selected guild indicator. |
| `--rail-item-bg-hover` | color | `var(--state-hover)` | Rail item hover. |
| `--rail-item-bg-active` | color | `var(--state-selected)` | Rail item active. |
| `--userbar-bg` | color | `var(--surface-raised)` | User bar background. |
| `--userbar-border` | color | `var(--border-default)` | User bar top border. |
| `--userbar-height` | size | `56px` | User bar height. |
| `--userbar-padding-x` | spacing | `var(--space-2)` | User bar horizontal padding. |
| `--userbar-gap` | spacing | `var(--space-2)` | Gap between the avatar and the status text. |
| `--roomlist-bg` | color | `var(--surface-pane)` | Room list background. |
| `--roomlist-item-bg-hover` | color | `var(--state-hover)` | Room item hover. |
| `--roomlist-item-bg-active` | color | `var(--state-selected)` | Room item active. |
| `--roomlist-item-text` | color | `var(--text-secondary)` | Room item text. |
| `--roomlist-item-text-active` | color | `var(--text-primary)` | Active room text. |
| `--roomlist-item-radius` | radius | `var(--control-radius)` | Room item radius. |
| `--roomlist-item-padding-y` | spacing | `var(--space-1)` | Room item vertical padding (density anchor). |
| `--timeline-bg` | color | `var(--surface-base)` | Timeline background. |
| `--timeline-day-divider` | color | `var(--text-muted)` | Day divider text. |
| `--timeline-unread-divider` | color | `var(--danger)` | Unread divider. |
| `--timeline-mention-bg` | color | `var(--mention)` | Mention / jump flash highlight. |
| `--timeline-row-gap` | spacing | `var(--space-2)` | Message gap. |
| `--timeline-row-padding-x` | spacing | `var(--space-3)` | Message horizontal padding. |
| `--timeline-row-padding-y` | spacing | `var(--space-1)` | Message vertical padding. |
| `--timeline-quote-bar-width` | border-width | `var(--border-width-accent)` | Quote / reply accent bar. |
| `--timeline-flash-duration` | motion | `var(--motion-slow)` | Jump-to-message flash. |
| `--media-image-max-width` | size | `320px` | Inline image max width. |
| `--media-image-max-height` | size | `240px` | Inline image max height. |
| `--media-video-max-width` | size | `360px` | Inline video max width. |
| `--media-video-max-height` | size | `280px` | Inline video max height. |
| `--media-audio-max-width` | size | `320px` | Inline audio max width. |
| `--composer-bg` | color | `var(--surface-pane)` | Composer background. |
| `--composer-input-bg` | color | `var(--surface-inset)` | Composer input background. |
| `--composer-input-border` | color | `var(--border-default)` | Composer input border. |
| `--members-bg` | color | `var(--surface-pane)` | Members pane. |
| `--member-dot-size` | size | `var(--presence-dot-size)` | Presence dot. |
| `--member-badge-radius` | radius | `var(--radius-full)` | Member role badge. |
| `--member-item-padding-y` | spacing | `var(--space-1)` | Member row vertical padding (density anchor). |
| `--button-primary-bg` | color | `var(--accent)` | Primary button. |
| `--button-primary-bg-hover` | color | `var(--accent-hover)` | Primary button hover. |
| `--button-primary-text` | color | `var(--accent-contrast)` | Primary button text. |
| `--button-secondary-bg` | color | `var(--surface-inset)` | Secondary button. |
| `--button-secondary-bg-hover` | color | `var(--state-hover)` | Secondary button hover. |
| `--button-secondary-text` | color | `var(--text-primary)` | Secondary button text. |
| `--button-secondary-border` | color | `var(--border-default)` | Secondary button border. |
| `--button-danger-bg` | color | `var(--danger)` | Danger button. |
| `--button-danger-bg-hover` | color | `var(--danger-hover)` | Danger button hover. |
| `--button-danger-text` | color | `var(--text-on-danger)` | Danger button text. |
| `--input-bg` | color | `var(--surface-inset)` | Text field background. |
| `--input-border` | color | `var(--border-default)` | Text field border. |
| `--input-text` | color | `var(--text-primary)` | Text field text. |
| `--input-placeholder` | color | `var(--text-muted)` | Text field placeholder. |
| `--input-textarea-min-height` | size | `4.5rem` | Textarea minimum height. |
| `--badge-bg` | color | `var(--danger)` | Unread badge. |
| `--badge-highlight-bg` | color | `var(--danger)` | Mention badge. |
| `--badge-text` | color | `var(--text-on-danger)` | Badge text. |
| `--avatar-bg` | color | `var(--accent)` | Avatar fallback. |
| `--avatar-text` | color | `var(--accent-contrast)` | Avatar initials. |
| `--avatar-initials-size` | size | `0.5rem` | Avatar initials font size. |
| `--overlay-bg` | color | `var(--surface-overlay)` | Dialog backdrop. |
| `--dialog-bg` | color | `var(--surface-raised)` | Dialog surface. |
| `--dialog-border` | color | `var(--border-default)` | Dialog border. |
| `--dialog-width` | layout | `var(--layout-dialog-width)` | Dialog width before clamp. |
| `--dialog-gutter` | spacing | `var(--space-6)` | Dialog viewport clamp gutter. |
| `--settings-bg` | color | `var(--surface-base)` | Settings page background. |
| `--settings-nav-bg` | color | `var(--surface-pane)` | Settings sidebar background. |
| `--settings-nav-item-bg-hover` | color | `var(--state-hover)` | Settings sidebar item hover. |
| `--settings-nav-item-bg-active` | color | `var(--state-selected)` | Settings sidebar current page. |
| `--settings-nav-item-danger` | color | `var(--danger)` | Settings sidebar destructive item (sign out). |
| `--settings-nav-width` | layout | `var(--layout-settings-nav-width)` | Settings sidebar width. |
| `--settings-content-width` | layout | `var(--layout-settings-content-width)` | Settings page column max width. |
| `--menu-bg` | color | `var(--surface-raised)` | Menu background. |
| `--menu-border` | color | `var(--border-default)` | Menu border. |
| `--menu-min-width` | layout | `var(--layout-menu-min-width)` | Menu minimum width. |
| `--menu-item-danger` | color | `var(--danger)` | Destructive menu item text. |
| `--popover-bg` | color | `var(--surface-raised)` | Popover background. |
| `--popover-border` | color | `var(--border-default)` | Popover border. |
| `--popover-shadow` | shadow | `var(--shadow-md)` | Popover elevation. |
| `--panel-bg` | color | `var(--surface-raised)` | Slide-over background. |
| `--panel-border` | color | `var(--border-default)` | Slide-over border. |
| `--panel-width` | layout | `var(--layout-slideover-width)` | Slide-over width. |
| `--panel-shadow` | shadow | `var(--shadow-panel)` | Slide-over edge shadow. |
| `--panel-z` | z-index | `var(--z-panel)` | In-pane slide-over stacking. |
| `--banner-error-bg` | color | `var(--danger)` | Error banner. |
| `--banner-error-text` | color | `var(--text-on-danger)` | Error banner text. |
| `--banner-reconnect-bg` | color | `var(--warning)` | Warning banner. |
| `--banner-reconnect-text` | color | `var(--text-on-warning)` | Warning banner text. |
| `--banner-action-hover` | color | `var(--surface-hover-contrast)` | Banner action hover. |
| `--picker-results-max-height` | size | `12rem` | User picker results height. |
