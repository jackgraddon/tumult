import type { TokenDef } from "../types.ts";

/**
 * The primitive palette — *structure only*.
 *
 * Primitives are the one tier with no `var()` default to fall back on (they are
 * the leaves), so their values live exclusively in the default theme document
 * (`themes/default.json`). `emit/base-css.ts` reads that document to emit
 * `:root`, and `build/compile.ts` refuses to build when a primitive is missing
 * from it. That is what keeps a value from ever being hardcoded here: if a
 * colour exists anywhere in the app, it exists in a theme file.
 */
export const PRIMITIVE_TOKENS: TokenDef[] = [
    // Brand accent ramp
    { name: "prim-brand-0", tier: "primitive", kind: "color", description: "Lightest brand tint." },
    { name: "prim-brand-1", tier: "primitive", kind: "color", description: "Light brand." },
    { name: "prim-brand-2", tier: "primitive", kind: "color", description: "Mid brand." },
    { name: "prim-brand-3", tier: "primitive", kind: "color", description: "Primary accent." },
    { name: "prim-brand-4", tier: "primitive", kind: "color", description: "Accent hover." },
    { name: "prim-brand-5", tier: "primitive", kind: "color", description: "Accent active." },

    // Neutral ramp (dark-first)
    { name: "prim-neutral-0", tier: "primitive", kind: "color", description: "Pure white." },
    { name: "prim-neutral-1", tier: "primitive", kind: "color", description: "Primary text on dark." },
    { name: "prim-neutral-2", tier: "primitive", kind: "color", description: "Secondary text." },
    { name: "prim-neutral-3", tier: "primitive", kind: "color", description: "Muted text." },
    { name: "prim-neutral-4", tier: "primitive", kind: "color", description: "Borders." },
    { name: "prim-neutral-5", tier: "primitive", kind: "color", description: "Pane background." },
    { name: "prim-neutral-6", tier: "primitive", kind: "color", description: "Deep background." },
    { name: "prim-neutral-7", tier: "primitive", kind: "color", description: "Rail background." },
    { name: "prim-neutral-8", tier: "primitive", kind: "color", description: "Light-mode surface." },
    { name: "prim-neutral-9", tier: "primitive", kind: "color", description: "Light-mode pane." },
    { name: "prim-neutral-10", tier: "primitive", kind: "color", description: "Light-mode border." },
    { name: "prim-neutral-11", tier: "primitive", kind: "color", description: "Secondary text on light." },
    { name: "prim-neutral-12", tier: "primitive", kind: "color", description: "Muted text on light." },

    // Status colors
    { name: "prim-green-3", tier: "primitive", kind: "color", description: "Success / online." },
    { name: "prim-red-3", tier: "primitive", kind: "color", description: "Danger." },
    { name: "prim-red-4", tier: "primitive", kind: "color", description: "Danger hover." },
    { name: "prim-amber-3", tier: "primitive", kind: "color", description: "Warning / pending." },
    { name: "prim-mention-3", tier: "primitive", kind: "color", description: "Mention highlight base." },
    { name: "prim-black", tier: "primitive", kind: "color", description: "Black." },

    // Spacing scale
    { name: "prim-space-px", tier: "primitive", kind: "spacing", description: "1px." },
    { name: "prim-space-0-5", tier: "primitive", kind: "spacing", description: "2px." },
    { name: "prim-space-1", tier: "primitive", kind: "spacing", description: "4px." },
    { name: "prim-space-1-5", tier: "primitive", kind: "spacing", description: "6px." },
    { name: "prim-space-2", tier: "primitive", kind: "spacing", description: "8px." },
    { name: "prim-space-3", tier: "primitive", kind: "spacing", description: "12px." },
    { name: "prim-space-4", tier: "primitive", kind: "spacing", description: "16px." },
    { name: "prim-space-5", tier: "primitive", kind: "spacing", description: "24px." },
    { name: "prim-space-6", tier: "primitive", kind: "spacing", description: "32px." },

    // Radius scale
    { name: "prim-radius-xs", tier: "primitive", kind: "radius", description: "2px radius." },
    { name: "prim-radius-sm", tier: "primitive", kind: "radius", description: "Small radius." },
    { name: "prim-radius-md", tier: "primitive", kind: "radius", description: "Default radius." },
    { name: "prim-radius-lg", tier: "primitive", kind: "radius", description: "Large radius." },
    { name: "prim-radius-full", tier: "primitive", kind: "radius", description: "Pills / avatars." },

    // Typography
    { name: "prim-font-sans", tier: "primitive", kind: "typography", description: "UI font stack." },
    { name: "prim-font-mono", tier: "primitive", kind: "typography", description: "Mono stack." },
    { name: "prim-text-2xs", tier: "primitive", kind: "typography", description: "9px." },
    { name: "prim-text-xs", tier: "primitive", kind: "typography", description: "12px." },
    { name: "prim-text-sm", tier: "primitive", kind: "typography", description: "14px." },
    { name: "prim-text-md", tier: "primitive", kind: "typography", description: "16px." },
    { name: "prim-text-lg", tier: "primitive", kind: "typography", description: "20px." },
    { name: "prim-text-xl", tier: "primitive", kind: "typography", description: "24px." },
    { name: "prim-weight-normal", tier: "primitive", kind: "font-weight", description: "Regular weight." },
    { name: "prim-weight-semibold", tier: "primitive", kind: "font-weight", description: "Semibold." },
    { name: "prim-weight-bold", tier: "primitive", kind: "font-weight", description: "Bold." },
    { name: "prim-leading-none", tier: "primitive", kind: "line-height", description: "Tight glyph leading." },
    { name: "prim-leading-tight", tier: "primitive", kind: "line-height", description: "Tight leading." },
    { name: "prim-leading-normal", tier: "primitive", kind: "line-height", description: "Body leading." },
    { name: "prim-tracking-wide", tier: "primitive", kind: "letter-spacing", description: "Small-caps label tracking." },
    { name: "prim-tracking-wider", tier: "primitive", kind: "letter-spacing", description: "Rail heading tracking." },
    { name: "prim-tracking-emoji", tier: "primitive", kind: "letter-spacing", description: "Verification digit spacing." },
    { name: "prim-tracking-emoji-lg", tier: "primitive", kind: "letter-spacing", description: "Verification emoji spacing." },

    // Sizes (icon boxes, avatars, controls, indicators)
    { name: "prim-size-2xs", tier: "primitive", kind: "size", description: "Presence dot / spacer." },
    { name: "prim-size-xs", tier: "primitive", kind: "size", description: "Small icon / badge." },
    { name: "prim-size-sm", tier: "primitive", kind: "size", description: "Small glyph." },
    { name: "prim-size-sm-plus", tier: "primitive", kind: "size", description: "Compact control." },
    { name: "prim-size-md", tier: "primitive", kind: "size", description: "Row gutter / avatar sm." },
    { name: "prim-size-lg", tier: "primitive", kind: "size", description: "Icon button / avatar md." },
    { name: "prim-size-xl", tier: "primitive", kind: "size", description: "Rail item / avatar lg." },
    { name: "prim-size-hairline", tier: "primitive", kind: "size", description: "Divider / separator." },
    { name: "prim-size-scrollbar", tier: "primitive", kind: "size", description: "Scrollbar thickness." },
    { name: "prim-size-indicator", tier: "primitive", kind: "size", description: "Selection pill width." },
    { name: "prim-size-stack-overlap", tier: "primitive", kind: "size", description: "Read-receipt avatar stack overlap." },

    // Elevation
    { name: "prim-shadow-sm", tier: "primitive", kind: "shadow", description: "Subtle elevation." },
    { name: "prim-shadow-md", tier: "primitive", kind: "shadow", description: "Popover / chip palette." },
    { name: "prim-shadow-panel", tier: "primitive", kind: "shadow", description: "Slide-over panel edge." },

    // Stacking order
    { name: "prim-z-panel", tier: "primitive", kind: "z-index", description: "In-pane slide-over." },
    { name: "prim-z-dropdown", tier: "primitive", kind: "z-index", description: "Menus / popovers." },
    { name: "prim-z-overlay", tier: "primitive", kind: "z-index", description: "Dialog backdrop." },
    { name: "prim-z-modal", tier: "primitive", kind: "z-index", description: "Dialog surface." },
    { name: "prim-z-toast", tier: "primitive", kind: "z-index", description: "Toasts." },

    // Opacity
    { name: "prim-opacity-disabled", tier: "primitive", kind: "opacity", description: "Disabled controls." },
    { name: "prim-opacity-muted", tier: "primitive", kind: "opacity", description: "Busy / de-emphasised." },

    // Borders
    { name: "prim-border-width", tier: "primitive", kind: "border-width", description: "Default border." },
    { name: "prim-border-width-medium", tier: "primitive", kind: "border-width", description: "Thin ring / hollow marker." },
    { name: "prim-border-width-strong", tier: "primitive", kind: "border-width", description: "Emphasis border / ring." },
    { name: "prim-border-width-accent", tier: "primitive", kind: "border-width", description: "Quote / reply accent bar." },

    // Motion
    { name: "prim-motion-fast", tier: "primitive", kind: "motion", description: "Hover fades." },
    { name: "prim-motion-base", tier: "primitive", kind: "motion", description: "Default transition." },
    { name: "prim-motion-slow", tier: "primitive", kind: "motion", description: "Jump-to-message flash." },
    { name: "prim-motion-ease", tier: "primitive", kind: "motion", description: "Default easing." },

    // Layout dims
    { name: "prim-layout-rail", tier: "primitive", kind: "layout", description: "Guild rail width." },
    { name: "prim-layout-roomlist", tier: "primitive", kind: "layout", description: "Room list width." },
    { name: "prim-layout-members", tier: "primitive", kind: "layout", description: "Members width." },
    { name: "prim-layout-slideover", tier: "primitive", kind: "layout", description: "Search / thread slide-over width." },
    { name: "prim-layout-menu-min", tier: "primitive", kind: "layout", description: "Dropdown menu minimum width." },
];
