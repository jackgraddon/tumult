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
    // Status colors
    { name: "prim-green-3", tier: "primitive", kind: "color", value: "#23a55a", description: "Success / online." },
    { name: "prim-red-3", tier: "primitive", kind: "color", value: "#f23f43", description: "Danger." },
    { name: "prim-red-4", tier: "primitive", kind: "color", value: "#c03537", description: "Danger hover." },
    { name: "prim-amber-3", tier: "primitive", kind: "color", value: "#f0b232", description: "Warning / pending." },
    { name: "prim-mention-3", tier: "primitive", kind: "color", value: "#f0b232", description: "Mention highlight base." },
    // Spacing scale
    { name: "prim-space-1", tier: "primitive", kind: "spacing", value: "0.25rem", description: "4px." },
    { name: "prim-space-2", tier: "primitive", kind: "spacing", value: "0.5rem", description: "8px." },
    { name: "prim-space-3", tier: "primitive", kind: "spacing", value: "0.75rem", description: "12px." },
    { name: "prim-space-4", tier: "primitive", kind: "spacing", value: "1rem", description: "16px." },
    { name: "prim-space-5", tier: "primitive", kind: "spacing", value: "1.5rem", description: "24px." },
    // Radius scale
    { name: "prim-radius-sm", tier: "primitive", kind: "radius", value: "0.25rem", description: "Small radius." },
    { name: "prim-radius-md", tier: "primitive", kind: "radius", value: "0.375rem", description: "Default radius." },
    { name: "prim-radius-lg", tier: "primitive", kind: "radius", value: "0.5rem", description: "Large radius." },
    { name: "prim-radius-full", tier: "primitive", kind: "radius", value: "9999px", description: "Pills / avatars." },
    // Typography
    { name: "prim-font-sans", tier: "primitive", kind: "typography", value: "system-ui, sans-serif", description: "UI font stack." },
    { name: "prim-font-mono", tier: "primitive", kind: "typography", value: "ui-monospace, monospace", description: "Mono stack." },
    { name: "prim-text-xs", tier: "primitive", kind: "typography", value: "0.75rem", description: "12px." },
    { name: "prim-text-sm", tier: "primitive", kind: "typography", value: "0.875rem", description: "14px." },
    { name: "prim-text-md", tier: "primitive", kind: "typography", value: "1rem", description: "16px." },
    // Motion
    { name: "prim-motion-fast", tier: "primitive", kind: "motion", value: "120ms", description: "Hover fades." },
    { name: "prim-motion-base", tier: "primitive", kind: "motion", value: "200ms", description: "Default transition." },
    { name: "prim-motion-ease", tier: "primitive", kind: "motion", value: "ease-out", description: "Default easing." },
    // Layout dims
    { name: "prim-layout-rail", tier: "primitive", kind: "layout", value: "72px", description: "Guild rail width." },
    { name: "prim-layout-roomlist", tier: "primitive", kind: "layout", value: "240px", description: "Room list width." },
    { name: "prim-layout-members", tier: "primitive", kind: "layout", value: "240px", description: "Members width." },
];
