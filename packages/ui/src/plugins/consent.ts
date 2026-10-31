/**
 * Plain-language copy for the consent screen — what each permission actually
 * lets a plugin do, and what each lane means.
 *
 * Consent is only meaningful if the user can read it. "timeline-renderers" is
 * jargon; "can draw its own version of messages in the chat" is a fact someone
 * can decide about. So the wording lives here as data, keyed by the permission
 * union, and a `satisfies` clause makes the compiler refuse a permission added
 * to `PLUGIN_PERMISSIONS` without copy beside it.
 *
 * The same table drives the install dialog, the installed-plugin list, and
 * anything else that has to describe a capability.
 */

import type { PluginLane } from "./lane.ts";
import type { Permission } from "./types.ts";

/**
 * One sentence per permission, written for someone who has never read the API
 * docs. Kept deliberately concrete: what the plugin can DO, not what the API is
 * called.
 */
export const PERMISSION_SUMMARY = {
    "timeline-renderers":
        "Draw its own version of messages in the chat — including custom event types it defines.",
    "composer-actions": "Add buttons to the message composer that run when you click them.",
    "member-decorations": "Add a badge or small marker next to people's names in the member list.",
    "activity-renderers": "Show people's activity (from their profile) in place of their status line.",
    commands: "Add slash commands you can type in the composer, like /shrug.",
    "settings-tabs": "Add a tab to the settings window with its own controls.",
    "workspace-panes":
        "Add its own screen to the app — a new tile in the guild rail with a window of its own.",
    styles: "Change how the app looks by injecting CSS stylesheets.",
} as const satisfies Record<Permission, string>;

/** The lane names as a user should see them, plus the honest one-liner. */
export const LANE_SUMMARY = {
    sandbox: {
        label: "Sandboxed",
        blurb:
            "This plugin runs in an isolated background worker. When you run one of its commands " +
            "or actions, it can read and act in that room — send, reply, react — and only until it " +
            "finishes. It cannot see your other rooms, your account, your encryption keys or your " +
            "devices, and has no access to the page or the DOM.",
        warning: null,
    },
    trusted: {
        label: "Runs as part of the app",
        blurb:
            "This plugin adds its own interface components, so it has to run inside the app " +
            "itself — not in a sandbox.",
        warning:
            "A plugin in this lane runs with the same access the app has: it can read your " +
            "messages, your session, and anything else the app can. Only install it if you trust " +
            "its author. This is not a warning we can make less scary — it is what the plugin needs.",
    },
} as const satisfies Record<PluginLane, { label: string; blurb: string; warning: string | null }>;

/** Copy for each permission, falling back to the raw name for an unknown one. */
export function describePermission(permission: Permission): string {
    return PERMISSION_SUMMARY[permission] ?? permission;
}
