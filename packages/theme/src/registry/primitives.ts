import type { TokenDef } from "../types.ts";

export const PRIMITIVE_TOKENS: TokenDef[] = [
    // Indigo accent ramp
    { name: "prim-indigo-0", tier: "primitive", kind: "color", value: "#eef0ff", description: "Lightest indigo." },
    { name: "prim-indigo-1", tier: "primitive", kind: "color", value: "#c7cdfb", description: "Light indigo." },
    { name: "prim-indigo-2", tier: "primitive", kind: "color", value: "#8f9bf5", description: "Mid indigo." },
    { name: "prim-indigo-3", tier: "primitive", kind: "color", value: "#5865f2", description: "Primary accent." },
    { name: "prim-indigo-4", tier: "primitive", kind: "color", value: "#4752c4", description: "Accent hover." },
    { name: "prim-indigo-5", tier: "primitive", kind: "color", value: "#3c45a5", description: "Accent active." },

    // Neutral ramp (dark-first)
    { name: "prim-neutral-0", tier: "primitive", kind: "color", value: "#ffffff", description: "Pure white." },
    { name: "prim-neutral-1", tier: "primitive", kind: "color", value: "#e8e8ea", description: "Primary text on dark." },
    { name: "prim-neutral-2", tier: "primitive", kind: "color", value: "#b5bac1", description: "Secondary text." },
    { name: "prim-neutral-3", tier: "primitive", kind: "color", value: "#80848e", description: "Muted text." },
    { name: "prim-neutral-4", tier: "primitive", kind: "color", value: "#3a3b40", description: "Borders." },
    { name: "prim-neutral-5", tier: "primitive", kind: "color", value: "#2b2d31", description: "Pane background." },
    { name: "prim-neutral-6", tier: "primitive", kind: "color", value: "#1e1f22", description: "Deep background." },
    { name: "prim-neutral-7", tier: "primitive", kind: "color", value: "#111214", description: "Rail background." },
    { name: "prim-neutral-8", tier: "primitive", kind: "color", value: "#f2f3f5", description: "Light-mode surface." },
    { name: "prim-neutral-9", tier: "primitive", kind: "color", value: "#ffffff", description: "Light-mode pane." },
    { name: "prim-neutral-10", tier: "primitive", kind: "color", value: "#e3e5e8", description: "Light-mode border." },
    { name: "prim-neutral-11", tier: "primitive", kind: "color", value: "#4e5058", description: "Secondary text on light." },
    { name: "prim-neutral-12", tier: "primitive", kind: "color", value: "#6d6f78", description: "Muted text on light." },

    // Status colors
    { name: "prim-green-3", tier: "primitive", kind: "color", value: "#23a55a", description: "Success / online." },
    { name: "prim-red-3", tier: "primitive", kind: "color", value: "#f23f43", description: "Danger." },
    { name: "prim-red-4", tier: "primitive", kind: "color", value: "#c03537", description: "Danger hover." },
    { name: "prim-amber-3", tier: "primitive", kind: "color", value: "#f0b232", description: "Warning / pending." },
    { name: "prim-mention-3", tier: "primitive", kind: "color", value: "#f0b232", description: "Mention highlight base." },
    { name: "prim-black", tier: "primitive", kind: "color", value: "#000000", description: "Black." },

    // Spacing scale
    { name: "prim-space-px", tier: "primitive", kind: "spacing", value: "0.0625rem", description: "1px." },
    { name: "prim-space-0-5", tier: "primitive", kind: "spacing", value: "0.125rem", description: "2px." },
    { name: "prim-space-1", tier: "primitive", kind: "spacing", value: "0.25rem", description: "4px." },
    { name: "prim-space-1-5", tier: "primitive", kind: "spacing", value: "0.375rem", description: "6px." },
    { name: "prim-space-2", tier: "primitive", kind: "spacing", value: "0.5rem", description: "8px." },
    { name: "prim-space-3", tier: "primitive", kind: "spacing", value: "0.75rem", description: "12px." },
    { name: "prim-space-4", tier: "primitive", kind: "spacing", value: "1rem", description: "16px." },
    { name: "prim-space-5", tier: "primitive", kind: "spacing", value: "1.5rem", description: "24px." },
    { name: "prim-space-6", tier: "primitive", kind: "spacing", value: "2rem", description: "32px." },

    // Radius scale
    { name: "prim-radius-xs", tier: "primitive", kind: "radius", value: "0.125rem", description: "2px radius." },
    { name: "prim-radius-sm", tier: "primitive", kind: "radius", value: "0.25rem", description: "Small radius." },
    { name: "prim-radius-md", tier: "primitive", kind: "radius", value: "0.375rem", description: "Default radius." },
    { name: "prim-radius-lg", tier: "primitive", kind: "radius", value: "0.5rem", description: "Large radius." },
    { name: "prim-radius-full", tier: "primitive", kind: "radius", value: "9999px", description: "Pills / avatars." },

    // Typography
    { name: "prim-font-sans", tier: "primitive", kind: "typography", value: "system-ui, sans-serif", description: "UI font stack." },
    { name: "prim-font-mono", tier: "primitive", kind: "typography", value: "ui-monospace, monospace", description: "Mono stack." },
    { name: "prim-text-2xs", tier: "primitive", kind: "typography", value: "0.5625rem", description: "9px." },
    { name: "prim-text-xs", tier: "primitive", kind: "typography", value: "0.75rem", description: "12px." },
    { name: "prim-text-sm", tier: "primitive", kind: "typography", value: "0.875rem", description: "14px." },
    { name: "prim-text-md", tier: "primitive", kind: "typography", value: "1rem", description: "16px." },
    { name: "prim-text-lg", tier: "primitive", kind: "typography", value: "1.25rem", description: "20px." },
    { name: "prim-text-xl", tier: "primitive", kind: "typography", value: "1.5rem", description: "24px." },
    { name: "prim-weight-normal", tier: "primitive", kind: "font-weight", value: "400", description: "Regular weight." },
    { name: "prim-weight-semibold", tier: "primitive", kind: "font-weight", value: "600", description: "Semibold." },
    { name: "prim-weight-bold", tier: "primitive", kind: "font-weight", value: "700", description: "Bold." },
    { name: "prim-leading-none", tier: "primitive", kind: "line-height", value: "1", description: "Tight glyph leading." },
    { name: "prim-leading-tight", tier: "primitive", kind: "line-height", value: "1.25", description: "Tight leading." },
    { name: "prim-leading-normal", tier: "primitive", kind: "line-height", value: "1.5", description: "Body leading." },
    { name: "prim-tracking-wide", tier: "primitive", kind: "letter-spacing", value: "0.04em", description: "Small-caps label tracking." },
    { name: "prim-tracking-wider", tier: "primitive", kind: "letter-spacing", value: "0.08em", description: "Rail heading tracking." },
    { name: "prim-tracking-emoji", tier: "primitive", kind: "letter-spacing", value: "0.25em", description: "Verification digit spacing." },
    { name: "prim-tracking-emoji-lg", tier: "primitive", kind: "letter-spacing", value: "0.5em", description: "Verification emoji spacing." },

    // Sizes (icon boxes, avatars, controls, indicators)
    { name: "prim-size-2xs", tier: "primitive", kind: "size", value: "8px", description: "Presence dot / spacer." },
    { name: "prim-size-xs", tier: "primitive", kind: "size", value: "16px", description: "Small icon / badge." },
    { name: "prim-size-sm", tier: "primitive", kind: "size", value: "20px", description: "Small glyph." },
    { name: "prim-size-sm-plus", tier: "primitive", kind: "size", value: "22px", description: "Compact control." },
    { name: "prim-size-md", tier: "primitive", kind: "size", value: "24px", description: "Row gutter / avatar sm." },
    { name: "prim-size-lg", tier: "primitive", kind: "size", value: "32px", description: "Icon button / avatar md." },
    { name: "prim-size-xl", tier: "primitive", kind: "size", value: "48px", description: "Rail item / avatar lg." },
    { name: "prim-size-hairline", tier: "primitive", kind: "size", value: "1px", description: "Divider / separator." },
    { name: "prim-size-scrollbar", tier: "primitive", kind: "size", value: "6px", description: "Scrollbar thickness." },
    { name: "prim-size-indicator", tier: "primitive", kind: "size", value: "4px", description: "Selection pill width." },
    { name: "prim-size-stack-overlap", tier: "primitive", kind: "size", value: "-8px", description: "Read-receipt avatar stack overlap." },

    // Elevation
    { name: "prim-shadow-sm", tier: "primitive", kind: "shadow", value: "0 1px 2px rgba(0, 0, 0, 0.3)", description: "Subtle elevation." },
    { name: "prim-shadow-md", tier: "primitive", kind: "shadow", value: "0 8px 24px rgba(0, 0, 0, 0.4)", description: "Popover / chip palette." },
    { name: "prim-shadow-panel", tier: "primitive", kind: "shadow", value: "-8px 0 24px rgba(0, 0, 0, 0.25)", description: "Slide-over panel edge." },

    // Stacking order
    { name: "prim-z-panel", tier: "primitive", kind: "z-index", value: "5", description: "In-pane slide-over." },
    { name: "prim-z-dropdown", tier: "primitive", kind: "z-index", value: "50", description: "Menus / popovers." },
    { name: "prim-z-overlay", tier: "primitive", kind: "z-index", value: "100", description: "Dialog backdrop." },
    { name: "prim-z-modal", tier: "primitive", kind: "z-index", value: "110", description: "Dialog surface." },
    { name: "prim-z-toast", tier: "primitive", kind: "z-index", value: "120", description: "Toasts." },

    // Opacity
    { name: "prim-opacity-disabled", tier: "primitive", kind: "opacity", value: "0.5", description: "Disabled controls." },
    { name: "prim-opacity-muted", tier: "primitive", kind: "opacity", value: "0.7", description: "Busy / de-emphasised." },

    // Borders
    { name: "prim-border-width", tier: "primitive", kind: "border-width", value: "1px", description: "Default border." },
    { name: "prim-border-width-medium", tier: "primitive", kind: "border-width", value: "1.5px", description: "Thin ring / hollow marker." },
    { name: "prim-border-width-strong", tier: "primitive", kind: "border-width", value: "2px", description: "Emphasis border / ring." },
    { name: "prim-border-width-accent", tier: "primitive", kind: "border-width", value: "3px", description: "Quote / reply accent bar." },

    // Motion
    { name: "prim-motion-fast", tier: "primitive", kind: "motion", value: "120ms", description: "Hover fades." },
    { name: "prim-motion-base", tier: "primitive", kind: "motion", value: "200ms", description: "Default transition." },
    { name: "prim-motion-slow", tier: "primitive", kind: "motion", value: "2.4s", description: "Jump-to-message flash." },
    { name: "prim-motion-ease", tier: "primitive", kind: "motion", value: "ease-out", description: "Default easing." },

    // Layout dims
    { name: "prim-layout-rail", tier: "primitive", kind: "layout", value: "72px", description: "Guild rail width." },
    { name: "prim-layout-roomlist", tier: "primitive", kind: "layout", value: "240px", description: "Room list width." },
    { name: "prim-layout-members", tier: "primitive", kind: "layout", value: "240px", description: "Members width." },
    { name: "prim-layout-slideover", tier: "primitive", kind: "layout", value: "360px", description: "Search / thread slide-over width." },
    { name: "prim-layout-menu-min", tier: "primitive", kind: "layout", value: "200px", description: "Dropdown menu minimum width." },
];
