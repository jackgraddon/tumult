import type { TokenDef } from "../types.ts";

const v = (name: string): string => `var(--${name})`;

/**
 * Component tier. Components reference semantic/component tokens only —
 * never primitives.
 */
export const COMPONENT_TOKENS: TokenDef[] = [
    // Shell
    { name: "control-radius", tier: "component", kind: "radius", value: v("radius-md"), description: "Inputs / buttons / rows." },
    { name: "focus-ring-color", tier: "component", kind: "color", value: v("focus-ring"), description: "Focus outline colour." },
    { name: "focus-ring-outline", tier: "component", kind: "border-width", value: v("focus-ring-width"), description: "Focus outline thickness." },

    // Guild rail
    { name: "rail-indicator", tier: "component", kind: "color", value: v("accent"), description: "Selected guild indicator." },
    { name: "rail-item-bg-hover", tier: "component", kind: "color", value: v("state-hover"), description: "Rail item hover." },
    { name: "rail-item-bg-active", tier: "component", kind: "color", value: v("state-selected"), description: "Rail item active." },

    // Room list
    { name: "roomlist-bg", tier: "component", kind: "color", value: v("surface-pane"), description: "Room list background." },
    { name: "roomlist-item-bg-hover", tier: "component", kind: "color", value: v("state-hover"), description: "Room item hover." },
    { name: "roomlist-item-bg-active", tier: "component", kind: "color", value: v("state-selected"), description: "Room item active." },
    { name: "roomlist-item-text", tier: "component", kind: "color", value: v("text-secondary"), description: "Room item text." },
    { name: "roomlist-item-text-active", tier: "component", kind: "color", value: v("text-primary"), description: "Active room text." },
    { name: "roomlist-item-radius", tier: "component", kind: "radius", value: v("control-radius"), description: "Room item radius." },
    { name: "roomlist-item-padding-y", tier: "component", kind: "spacing", value: v("space-1"), description: "Room item vertical padding (density anchor)." },

    // Timeline
    { name: "timeline-bg", tier: "component", kind: "color", value: v("surface-base"), description: "Timeline background." },
    { name: "timeline-day-divider", tier: "component", kind: "color", value: v("text-muted"), description: "Day divider text." },
    { name: "timeline-unread-divider", tier: "component", kind: "color", value: v("danger"), description: "Unread divider." },
    { name: "timeline-mention-bg", tier: "component", kind: "color", value: v("mention"), description: "Mention / jump flash highlight." },
    { name: "timeline-row-gap", tier: "component", kind: "spacing", value: v("space-2"), description: "Message gap." },
    { name: "timeline-row-padding-x", tier: "component", kind: "spacing", value: v("space-3"), description: "Message horizontal padding." },
    { name: "timeline-row-padding-y", tier: "component", kind: "spacing", value: v("space-1"), description: "Message vertical padding." },
    { name: "timeline-quote-bar-width", tier: "component", kind: "border-width", value: v("border-width-accent"), description: "Quote / reply accent bar." },
    { name: "timeline-flash-duration", tier: "component", kind: "motion", value: v("motion-slow"), description: "Jump-to-message flash." },

    // Media renderer
    { name: "media-image-max-width", tier: "component", kind: "size", description: "Inline image max width." },
    { name: "media-image-max-height", tier: "component", kind: "size", description: "Inline image max height." },
    { name: "media-video-max-width", tier: "component", kind: "size", description: "Inline video max width." },
    { name: "media-video-max-height", tier: "component", kind: "size", description: "Inline video max height." },
    { name: "media-audio-max-width", tier: "component", kind: "size", description: "Inline audio max width." },

    // Composer
    { name: "composer-bg", tier: "component", kind: "color", value: v("surface-pane"), description: "Composer background." },
    { name: "composer-input-bg", tier: "component", kind: "color", value: v("surface-inset"), description: "Composer input background." },
    { name: "composer-input-border", tier: "component", kind: "color", value: v("border-default"), description: "Composer input border." },

    // Members
    { name: "members-bg", tier: "component", kind: "color", value: v("surface-pane"), description: "Members pane." },
    { name: "member-dot-size", tier: "component", kind: "size", value: v("presence-dot-size"), description: "Presence dot." },
    { name: "member-badge-radius", tier: "component", kind: "radius", value: v("radius-full"), description: "Member role badge." },
    { name: "member-item-padding-y", tier: "component", kind: "spacing", value: v("space-1"), description: "Member row vertical padding (density anchor)." },

    // Buttons
    { name: "button-primary-bg", tier: "component", kind: "color", value: v("accent"), description: "Primary button." },
    { name: "button-primary-bg-hover", tier: "component", kind: "color", value: v("accent-hover"), description: "Primary button hover." },
    { name: "button-primary-text", tier: "component", kind: "color", value: v("accent-contrast"), description: "Primary button text." },
    { name: "button-secondary-bg", tier: "component", kind: "color", value: v("surface-inset"), description: "Secondary button." },
    { name: "button-secondary-bg-hover", tier: "component", kind: "color", value: v("state-hover"), description: "Secondary button hover." },
    { name: "button-secondary-text", tier: "component", kind: "color", value: v("text-primary"), description: "Secondary button text." },
    { name: "button-secondary-border", tier: "component", kind: "color", value: v("border-default"), description: "Secondary button border." },
    { name: "button-danger-bg", tier: "component", kind: "color", value: v("danger"), description: "Danger button." },
    { name: "button-danger-bg-hover", tier: "component", kind: "color", value: v("danger-hover"), description: "Danger button hover." },
    { name: "button-danger-text", tier: "component", kind: "color", value: v("text-on-danger"), description: "Danger button text." },

    // Inputs
    { name: "input-bg", tier: "component", kind: "color", value: v("surface-inset"), description: "Text field background." },
    { name: "input-border", tier: "component", kind: "color", value: v("border-default"), description: "Text field border." },
    { name: "input-text", tier: "component", kind: "color", value: v("text-primary"), description: "Text field text." },
    { name: "input-placeholder", tier: "component", kind: "color", value: v("text-muted"), description: "Text field placeholder." },
    { name: "input-textarea-min-height", tier: "component", kind: "size", description: "Textarea minimum height." },

    // Badges
    { name: "badge-bg", tier: "component", kind: "color", value: v("danger"), description: "Unread badge." },
    { name: "badge-highlight-bg", tier: "component", kind: "color", value: v("danger"), description: "Mention badge." },
    { name: "badge-text", tier: "component", kind: "color", value: v("text-on-danger"), description: "Badge text." },

    // Avatars
    { name: "avatar-bg", tier: "component", kind: "color", value: v("accent"), description: "Avatar fallback." },
    { name: "avatar-text", tier: "component", kind: "color", value: v("accent-contrast"), description: "Avatar initials." },
    { name: "avatar-initials-size", tier: "component", kind: "size", description: "Avatar initials font size." },

    // Overlays / dialogs / menus
    { name: "overlay-bg", tier: "component", kind: "color", value: v("surface-overlay"), description: "Dialog backdrop." },
    { name: "dialog-bg", tier: "component", kind: "color", value: v("surface-raised"), description: "Dialog surface." },
    { name: "dialog-border", tier: "component", kind: "color", value: v("border-default"), description: "Dialog border." },
    { name: "dialog-width", tier: "component", kind: "layout", value: v("layout-dialog-width"), description: "Dialog width before clamp." },
    { name: "dialog-gutter", tier: "component", kind: "spacing", value: v("space-6"), description: "Dialog viewport clamp gutter." },
    { name: "menu-bg", tier: "component", kind: "color", value: v("surface-raised"), description: "Menu background." },
    { name: "menu-border", tier: "component", kind: "color", value: v("border-default"), description: "Menu border." },
    { name: "menu-min-width", tier: "component", kind: "layout", value: v("layout-menu-min-width"), description: "Menu minimum width." },
    { name: "menu-devices-max-height", tier: "component", kind: "size", description: "Device list max height." },
    { name: "menu-item-danger", tier: "component", kind: "color", value: v("danger"), description: "Destructive menu item text." },
    { name: "popover-bg", tier: "component", kind: "color", value: v("surface-raised"), description: "Popover background." },
    { name: "popover-border", tier: "component", kind: "color", value: v("border-default"), description: "Popover border." },
    { name: "popover-shadow", tier: "component", kind: "shadow", value: v("shadow-md"), description: "Popover elevation." },

    // Slide-over panels (search, threads)
    { name: "panel-bg", tier: "component", kind: "color", value: v("surface-raised"), description: "Slide-over background." },
    { name: "panel-border", tier: "component", kind: "color", value: v("border-default"), description: "Slide-over border." },
    { name: "panel-width", tier: "component", kind: "layout", value: v("layout-slideover-width"), description: "Slide-over width." },
    { name: "panel-shadow", tier: "component", kind: "shadow", value: v("shadow-panel"), description: "Slide-over edge shadow." },
    { name: "panel-z", tier: "component", kind: "z-index", value: v("z-panel"), description: "In-pane slide-over stacking." },

    // Banners
    { name: "banner-error-bg", tier: "component", kind: "color", value: v("danger"), description: "Error banner." },
    { name: "banner-error-text", tier: "component", kind: "color", value: v("text-on-danger"), description: "Error banner text." },
    { name: "banner-reconnect-bg", tier: "component", kind: "color", value: v("warning"), description: "Warning banner." },
    { name: "banner-reconnect-text", tier: "component", kind: "color", value: v("text-on-warning"), description: "Warning banner text." },
    { name: "banner-action-hover", tier: "component", kind: "color", value: v("surface-hover-contrast"), description: "Banner action hover." },

    // Pickers
    { name: "picker-results-max-height", tier: "component", kind: "size", description: "User picker results height." },
];
