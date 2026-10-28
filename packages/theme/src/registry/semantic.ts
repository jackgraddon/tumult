import type { TokenDef } from "../types.ts";

/**
 * Semantic tier — *structure only*: every `value` is a `var()` reference, and a
 * token whose default is a literal (an overlay wash, a dialog width) carries no
 * value at all. Literal defaults live in the default theme document; a theme
 * that omits one inherits whatever `themes/default.json` supplies. Keeping the
 * references here is what makes a sparse theme work: it overrides a token and
 * everything pointing at that token follows.
 */
const v = (name: string): string => `var(--${name})`;

export const SEMANTIC_TOKENS: TokenDef[] = [
    // Surfaces
    { name: "surface-base", tier: "semantic", kind: "color", value: v("prim-neutral-6"), description: "App background." },
    { name: "surface-pane", tier: "semantic", kind: "color", value: v("prim-neutral-5"), description: "Pane background." },
    { name: "surface-raised", tier: "semantic", kind: "color", value: v("surface-pane"), description: "Menus / popovers / dialogs." },
    { name: "surface-rail", tier: "semantic", kind: "color", value: v("prim-neutral-7"), description: "Guild rail background." },
    { name: "surface-inset", tier: "semantic", kind: "color", value: v("surface-base"), description: "Inputs and wells inside a pane." },
    { name: "surface-overlay", tier: "semantic", kind: "color", description: "Dialog backdrop." },
    { name: "surface-hover", tier: "semantic", kind: "color", description: "Hover wash." },
    { name: "surface-active", tier: "semantic", kind: "color", description: "Active / selected wash." },
    { name: "surface-hover-contrast", tier: "semantic", kind: "color", description: "Hover wash on a bright (banner) surface." },

    // Text
    { name: "text-primary", tier: "semantic", kind: "color", value: v("prim-neutral-1"), description: "Primary text." },
    { name: "text-secondary", tier: "semantic", kind: "color", value: v("prim-neutral-2"), description: "Secondary text." },
    { name: "text-muted", tier: "semantic", kind: "color", value: v("prim-neutral-3"), description: "Muted text." },
    { name: "text-on-warning", tier: "semantic", kind: "color", value: v("prim-neutral-7"), description: "Text on warning surfaces." },
    { name: "text-on-danger", tier: "semantic", kind: "color", value: v("prim-neutral-0"), description: "Text on danger surfaces." },

    // Accent / status
    { name: "accent", tier: "semantic", kind: "color", value: v("prim-brand-3"), description: "Primary accent." },
    { name: "accent-hover", tier: "semantic", kind: "color", value: v("prim-brand-4"), description: "Accent hover." },
    { name: "accent-contrast", tier: "semantic", kind: "color", value: v("prim-neutral-0"), description: "Text on accent." },
    { name: "danger", tier: "semantic", kind: "color", value: v("prim-red-3"), description: "Danger." },
    { name: "danger-hover", tier: "semantic", kind: "color", value: v("prim-red-4"), description: "Danger hover." },
    { name: "success", tier: "semantic", kind: "color", value: v("prim-green-3"), description: "Success / online." },
    { name: "warning", tier: "semantic", kind: "color", value: v("prim-amber-3"), description: "Warning / pending." },
    { name: "mention", tier: "semantic", kind: "color", value: v("prim-mention-3"), description: "Mention highlight." },
    { name: "border-default", tier: "semantic", kind: "color", value: v("prim-neutral-4"), description: "Default border." },

    // Interaction states
    { name: "state-hover", tier: "semantic", kind: "color", value: v("surface-hover"), description: "Generic hover background." },
    { name: "state-selected", tier: "semantic", kind: "color", value: v("surface-active"), description: "Selected background." },
    { name: "state-disabled-opacity", tier: "semantic", kind: "opacity", value: v("prim-opacity-disabled"), description: "Disabled controls." },
    { name: "state-muted-opacity", tier: "semantic", kind: "opacity", value: v("prim-opacity-muted"), description: "Busy / de-emphasised." },
    { name: "focus-ring", tier: "semantic", kind: "color", value: v("prim-brand-3"), description: "Focus ring colour." },
    { name: "focus-ring-width", tier: "semantic", kind: "border-width", value: v("prim-border-width-strong"), description: "Focus ring thickness." },
    { name: "focus-ring-offset", tier: "semantic", kind: "border-width", description: "Default focus ring offset." },

    // Spacing
    { name: "space-px", tier: "semantic", kind: "spacing", value: v("prim-space-px"), description: "Hairline space (1px)." },
    { name: "space-0-5", tier: "semantic", kind: "spacing", value: v("prim-space-0-5"), description: "Semantic space 0.5 (2px)." },
    { name: "space-1", tier: "semantic", kind: "spacing", value: v("prim-space-1"), description: "Semantic space 1 (4px)." },
    { name: "space-1-5", tier: "semantic", kind: "spacing", value: v("prim-space-1-5"), description: "Semantic space 1.5 (6px)." },
    { name: "space-2", tier: "semantic", kind: "spacing", value: v("prim-space-2"), description: "Semantic space 2 (8px)." },
    { name: "space-3", tier: "semantic", kind: "spacing", value: v("prim-space-3"), description: "Semantic space 3 (12px)." },
    { name: "space-4", tier: "semantic", kind: "spacing", value: v("prim-space-4"), description: "Semantic space 4 (16px)." },
    { name: "space-5", tier: "semantic", kind: "spacing", value: v("prim-space-5"), description: "Semantic space 5 (24px)." },
    { name: "space-6", tier: "semantic", kind: "spacing", value: v("prim-space-6"), description: "Semantic space 6 (32px)." },

    // Radius
    { name: "radius-xs", tier: "semantic", kind: "radius", value: v("prim-radius-xs"), description: "Semantic radius xs." },
    { name: "radius-sm", tier: "semantic", kind: "radius", value: v("prim-radius-sm"), description: "Semantic radius sm." },
    { name: "radius-md", tier: "semantic", kind: "radius", value: v("prim-radius-md"), description: "Semantic radius md." },
    { name: "radius-lg", tier: "semantic", kind: "radius", value: v("prim-radius-lg"), description: "Semantic radius lg." },
    { name: "radius-full", tier: "semantic", kind: "radius", value: v("prim-radius-full"), description: "Semantic radius full." },

    // Typography
    { name: "font-sans", tier: "semantic", kind: "typography", value: v("prim-font-sans"), description: "UI font." },
    { name: "font-mono", tier: "semantic", kind: "typography", value: v("prim-font-mono"), description: "Mono font." },
    { name: "text-2xs", tier: "semantic", kind: "typography", value: v("prim-text-2xs"), description: "9px." },
    { name: "text-xs", tier: "semantic", kind: "typography", value: v("prim-text-xs"), description: "12px." },
    { name: "text-sm", tier: "semantic", kind: "typography", value: v("prim-text-sm"), description: "14px." },
    { name: "text-md", tier: "semantic", kind: "typography", value: v("prim-text-md"), description: "16px." },
    { name: "text-lg", tier: "semantic", kind: "typography", value: v("prim-text-lg"), description: "20px." },
    { name: "text-xl", tier: "semantic", kind: "typography", value: v("prim-text-xl"), description: "24px." },
    { name: "weight-normal", tier: "semantic", kind: "font-weight", value: v("prim-weight-normal"), description: "Regular." },
    { name: "weight-semibold", tier: "semantic", kind: "font-weight", value: v("prim-weight-semibold"), description: "Semibold." },
    { name: "weight-bold", tier: "semantic", kind: "font-weight", value: v("prim-weight-bold"), description: "Bold." },
    { name: "leading-none", tier: "semantic", kind: "line-height", value: v("prim-leading-none"), description: "Glyph leading." },
    { name: "leading-tight", tier: "semantic", kind: "line-height", value: v("prim-leading-tight"), description: "Tight leading." },
    { name: "leading-normal", tier: "semantic", kind: "line-height", value: v("prim-leading-normal"), description: "Body leading." },
    { name: "tracking-wide", tier: "semantic", kind: "letter-spacing", value: v("prim-tracking-wide"), description: "Label tracking." },
    { name: "tracking-wider", tier: "semantic", kind: "letter-spacing", value: v("prim-tracking-wider"), description: "Rail heading tracking." },
    { name: "tracking-emoji", tier: "semantic", kind: "letter-spacing", value: v("prim-tracking-emoji"), description: "Verification digits." },
    { name: "tracking-emoji-lg", tier: "semantic", kind: "letter-spacing", value: v("prim-tracking-emoji-lg"), description: "Verification emoji." },

    // Sizes
    { name: "icon-xs", tier: "semantic", kind: "size", value: v("prim-size-2xs"), description: "8px glyph / dot." },
    { name: "icon-sm", tier: "semantic", kind: "size", value: v("prim-size-xs"), description: "16px glyph." },
    { name: "icon-md", tier: "semantic", kind: "size", value: v("prim-size-sm"), description: "20px glyph." },
    { name: "icon-lg", tier: "semantic", kind: "size", value: v("prim-size-sm-plus"), description: "22px glyph." },
    { name: "control-sm", tier: "semantic", kind: "size", value: v("prim-size-sm-plus"), description: "22px control." },
    { name: "control-md", tier: "semantic", kind: "size", value: v("prim-size-lg"), description: "32px control." },
    { name: "control-lg", tier: "semantic", kind: "size", value: v("prim-size-xl"), description: "48px control." },
    { name: "avatar-xs", tier: "semantic", kind: "size", value: v("prim-size-xs"), description: "16px avatar." },
    { name: "avatar-sm", tier: "semantic", kind: "size", value: v("prim-size-md"), description: "24px avatar." },
    { name: "avatar-md", tier: "semantic", kind: "size", value: v("prim-size-lg"), description: "32px avatar." },
    { name: "avatar-lg", tier: "semantic", kind: "size", value: v("prim-size-xl"), description: "48px avatar." },
    { name: "avatar-stack-overlap", tier: "semantic", kind: "size", value: v("prim-size-stack-overlap"), description: "Read-receipt stack overlap." },
    { name: "hairline", tier: "semantic", kind: "size", value: v("prim-size-hairline"), description: "Divider thickness." },
    { name: "scrollbar-width", tier: "semantic", kind: "size", value: v("prim-size-scrollbar"), description: "Scrollbar thickness." },
    { name: "rail-pill-width", tier: "semantic", kind: "size", value: v("prim-size-indicator"), description: "Guild selection pill." },
    { name: "rail-item-size", tier: "semantic", kind: "size", value: v("prim-size-xl"), description: "Rail button size." },
    { name: "rail-favourite-min-width", tier: "semantic", kind: "size", description: "Favourite band item." },
    { name: "timeline-gutter-width", tier: "semantic", kind: "size", value: v("prim-size-md"), description: "Message gutter." },
    { name: "badge-min-size", tier: "semantic", kind: "size", value: v("prim-size-xs"), description: "Unread badge." },
    { name: "presence-dot-size", tier: "semantic", kind: "size", value: v("prim-size-2xs"), description: "Presence dot." },

    // Borders
    { name: "border-width", tier: "semantic", kind: "border-width", value: v("prim-border-width"), description: "Default border." },
    { name: "border-width-medium", tier: "semantic", kind: "border-width", value: v("prim-border-width-medium"), description: "Thin ring (hollow presence dot)." },
    { name: "border-width-strong", tier: "semantic", kind: "border-width", value: v("prim-border-width-strong"), description: "Emphasis border." },
    { name: "border-width-accent", tier: "semantic", kind: "border-width", value: v("prim-border-width-accent"), description: "Quote / reply accent bar." },

    // Elevation
    { name: "shadow-sm", tier: "semantic", kind: "shadow", value: v("prim-shadow-sm"), description: "Subtle elevation." },
    { name: "shadow-md", tier: "semantic", kind: "shadow", value: v("prim-shadow-md"), description: "Popover elevation." },
    { name: "shadow-panel", tier: "semantic", kind: "shadow", value: v("prim-shadow-panel"), description: "Slide-over edge." },

    // Stacking
    { name: "z-panel", tier: "semantic", kind: "z-index", value: v("prim-z-panel"), description: "In-pane slide-over." },
    { name: "z-dropdown", tier: "semantic", kind: "z-index", value: v("prim-z-dropdown"), description: "Menus / popovers." },
    { name: "z-overlay", tier: "semantic", kind: "z-index", value: v("prim-z-overlay"), description: "Dialog backdrop." },
    { name: "z-modal", tier: "semantic", kind: "z-index", value: v("prim-z-modal"), description: "Dialog surface." },
    { name: "z-toast", tier: "semantic", kind: "z-index", value: v("prim-z-toast"), description: "Toasts." },

    // Motion
    { name: "motion-fast", tier: "semantic", kind: "motion", value: v("prim-motion-fast"), description: "Fast motion." },
    { name: "motion-base", tier: "semantic", kind: "motion", value: v("prim-motion-base"), description: "Base motion." },
    { name: "motion-slow", tier: "semantic", kind: "motion", value: v("prim-motion-slow"), description: "Flash motion." },
    { name: "motion-ease", tier: "semantic", kind: "motion", value: v("prim-motion-ease"), description: "Easing." },

    // Layout
    { name: "layout-guild-rail-width", tier: "semantic", kind: "layout", value: v("prim-layout-rail"), description: "Guild rail width." },
    { name: "layout-roomlist-width", tier: "semantic", kind: "layout", value: v("prim-layout-roomlist"), description: "Room list width." },
    { name: "layout-members-width", tier: "semantic", kind: "layout", value: v("prim-layout-members"), description: "Members width." },
    { name: "layout-slideover-width", tier: "semantic", kind: "layout", value: v("prim-layout-slideover"), description: "Search / thread panel width." },
    { name: "layout-menu-min-width", tier: "semantic", kind: "layout", value: v("prim-layout-menu-min"), description: "Menu minimum width." },
    { name: "layout-dialog-width", tier: "semantic", kind: "layout", description: "Dialog width before viewport clamp." },
    { name: "layout-settings-nav-width", tier: "semantic", kind: "layout", description: "Settings sidebar width." },
    { name: "layout-settings-content-width", tier: "semantic", kind: "layout", description: "Settings page column max width." },
];
