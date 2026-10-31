/**
 * The trust-lane rule — derived, never declared.
 *
 * A plugin's lane is computed from the permissions it asks for, at load
 * time, by the host: nothing in the manifest can claim a lane, and there is
 * no reviewer to petition. A plugin that only needs data-in/capability-out
 * APIs (commands, composer actions, stylesheets) is loaded into a Worker inside an
 * opaque-origin sandbox frame (`sandbox/frame.ts`) and
 * reaches the shell exclusively through the RPC bridge — no DOM, no window,
 * no session storage. A plugin that contributes a live Vue component (a
 * timeline renderer, a member decoration, a settings tab) cannot be
 * marshalled across a postMessage boundary, so it runs in-page, at the app's
 * own trust level, and the installer says exactly that before installing.
 *
 * The double enforcement: this rule decides WHERE the module loads, and
 * `api.ts`'s permission gate decides WHAT the bridge answers — a sandboxed
 * plugin never has a component permission to spend, and an in-page plugin
 * never has a DOM handle from us.
 */

import type { Permission } from "./types.ts";

/** `"sandbox"`: loaded in a Worker, bridged. `"trusted"`: loaded in-page. */
export type PluginLane = "sandbox" | "trusted";

/**
 * The permissions the sandbox lane can serve. Everything else hands the host
 * a live component and therefore requires the trusted lane. Keep this list
 * in step with the extension APIs: an API that takes or returns plain data is
 * sandboxable; one that takes a `Component` is not.
 */
export const SANDBOXABLE_PERMISSIONS: readonly Permission[] = [
    "commands",
    "composer-actions",
    "styles",
];

const SANDBOXABLE = new Set<string>(SANDBOXABLE_PERMISSIONS);

/**
 * Derive a plugin's lane from its declared permissions: `sandbox` when every
 * permission is sandboxable (including the degenerate none), `trusted` when
 * any component-capable permission appears. The installer calls this before
 * showing consent, so the badge the user sees is this function — not a claim
 * from the manifest.
 */
export function deriveLane(manifest: { permissions: readonly Permission[] }): PluginLane {
    return manifest.permissions.every((permission) => SANDBOXABLE.has(permission))
        ? "sandbox"
        : "trusted";
}
