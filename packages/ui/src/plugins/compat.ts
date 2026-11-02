/**
 * Install-time compatibility: the enforcement behind `minUI` / `minCore`.
 *
 * The two manifest fields used to be inert metadata. They are checked here,
 * against the two versions that actually exist: `PLUGIN_API_VERSION` (this
 * package's plugin surface — bumps when the contract a plugin can see
 * changes) and `CONTRACT_VERSION` (the `ChatClient` contract in
 * `@tumult/core/contract`). The registry refuses an install whose
 * requirement is newer than the running build, naming both versions, so a
 * plugin built for a future Tumult fails with a reason instead of a missing
 * feature.
 */

import { CONTRACT_VERSION } from "@tumult/core/contract";

import type { PluginManifest } from "./types.ts";

/**
 * Version of the plugin API this build of `@tumult/ui` provides. Bump when a
 * plugin could observe a difference: a new `PluginContext`/`PluginApi`
 * member, a changed permission meaning, a signature change. Additive and
 * invisible changes may keep it.
 */
export const PLUGIN_API_VERSION = "1.3.0";

/**
 * Compare two dotted numeric versions ("1.2.3"). Each segment counts its
 * leading integer (`"2-beta"` → 2, missing segments → 0); non-numeric text
 * after the digits is ignored. Returns <0, 0 or >0 like a comparator.
 */
export function compareVersions(a: string, b: string): number {
    const left = a.trim().split(".");
    const right = b.trim().split(".");
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const l = Number.parseInt(left[index] ?? "0", 10) || 0;
        const r = Number.parseInt(right[index] ?? "0", 10) || 0;
        if (l !== r) return l - r;
    }
    return 0;
}

/**
 * Check a manifest against the running build. Resolves `null` when the
 * plugin can install, otherwise a sentence naming the shortfall — the
 * registry throws it as-is, so it must read as the refusal reason.
 */
export function checkManifestCompatibility(manifest: PluginManifest): string | null {
    if (manifest.minUI && compareVersions(PLUGIN_API_VERSION, manifest.minUI) < 0) {
        return (
            `requires plugin API ${manifest.minUI}+, but this build provides ` +
            `${PLUGIN_API_VERSION} (minUI)`
        );
    }
    if (manifest.minCore && compareVersions(CONTRACT_VERSION, manifest.minCore) < 0) {
        return (
            `requires @tumult/core contract ${manifest.minCore}+, but this build provides ` +
            `${CONTRACT_VERSION} (minCore)`
        );
    }
    return null;
}
