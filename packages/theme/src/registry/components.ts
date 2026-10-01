import type { TokenDef } from "../types.ts";

const v = (name: string): string => `var(--${name})`;

/**
 * Component tier. Only for components built in slice 2 — do not pre-register
 * tokens for components that do not exist yet.
 */
export const COMPONENT_TOKENS: TokenDef[] = [
    { name: "rail-indicator", tier: "component", kind: "color", value: v("accent"), description: "Selected guild indicator." },
    { name: "rail-item-bg-hover", tier: "component", kind: "color", value: v("surface-hover"), description: "Rail item hover." },
    { name: "rail-item-bg-active", tier: "component", kind: "color", value: v("surface-active"), description: "Rail item active." },
    { name: "roomlist-bg", tier: "component", kind: "color", value: v("surface-pane"), description: "Room list background." },
    { name: "roomlist-item-bg-hover", tier: "component", kind: "color", value: v("surface-hover"), description: "Room item hover." },
    { name: "roomlist-item-bg-active", tier: "component", kind: "color", value: v("surface-active"), description: "Room item active." },
    { name: "roomlist-item-text", tier: "component", kind: "color", value: v("text-secondary"), description: "Room item text." },
    { name: "roomlist-item-text-active", tier: "component", kind: "color", value: v("text-primary"), description: "Active room text." },
    { name: "timeline-bg", tier: "component", kind: "color", value: v("surface-base"), description: "Timeline background." },
    { name: "timeline-day-divider", tier: "component", kind: "color", value: v("text-muted"), description: "Day divider text." },
    { name: "timeline-mention-bg", tier: "component", kind: "color", value: v("mention"), description: "Mention highlight." },
    { name: "composer-bg", tier: "component", kind: "color", value: v("surface-pane"), description: "Composer background." },
    { name: "button-primary-bg", tier: "component", kind: "color", value: v("accent"), description: "Primary button." },
    { name: "button-primary-bg-hover", tier: "component", kind: "color", value: v("accent-hover"), description: "Primary button hover." },
    { name: "button-primary-text", tier: "component", kind: "color", value: v("accent-contrast"), description: "Primary button text." },
    { name: "button-danger-bg", tier: "component", kind: "color", value: v("danger"), description: "Danger button." },
    { name: "badge-bg", tier: "component", kind: "color", value: v("danger"), description: "Unread badge." },
    { name: "badge-highlight-bg", tier: "component", kind: "color", value: v("danger"), description: "Mention badge." },
    { name: "avatar-bg", tier: "component", kind: "color", value: v("accent"), description: "Avatar fallback." },
    { name: "members-bg", tier: "component", kind: "color", value: v("surface-pane"), description: "Members pane." },
    { name: "banner-error-bg", tier: "component", kind: "color", value: v("danger"), description: "Connection banner." },
    { name: "banner-reconnect-bg", tier: "component", kind: "color", value: v("warning"), description: "Reconnect banner." },
    { name: "focus-ring-color", tier: "component", kind: "color", value: v("focus-ring"), description: "Focus outline." },
    { name: "shell-gap", tier: "component", kind: "spacing", value: v("space-2"), description: "Shell gutter." },
    { name: "timeline-row-gap", tier: "component", kind: "spacing", value: v("space-1"), description: "Message gap." },
    { name: "control-radius", tier: "component", kind: "radius", value: v("radius-md"), description: "Inputs/buttons." },
];
