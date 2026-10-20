/**
 * The trust arithmetic of a third-party install — the parts that must be right
 * even when the network lies.
 *
 * Three jobs, all pure or nearly so (the only I/O is `hashBundle`, which uses
 * WebCrypto):
 *
 * 1. **Hash** a downloaded bundle to the `sha256-<base64>` form the manifest
 *    carries, so a mismatch can be shown as two comparable strings.
 * 2. **Decide** whether an install may go ahead: is the manifest valid, is the
 *    hash a match, does this version ask for permissions the user already
 *    agreed to?
 * 3. **Explain** a refusal in plain language, naming the field or hash.
 *
 * The re-consent rule lives here because it is the one the doc promises (§11,
 * "a changed permission list always re-asks"): {@link needsConsent} is true
 * whenever there is no prior record, or the prior record's permission set
 * differs in ANY way — added, removed or reordered are all "ask again", since a
 * removal changes what the plugin may do too.
 */

import { validatePluginManifest } from "./schema.ts";
import { deriveLane, type PluginLane } from "./lane.ts";
import type { Permission, PluginManifest } from "./types.ts";

/** A stored/performed install, reduced to what the decision needs. */
export interface InstallRecordSummary {
    id: string;
    version: string;
    permissions: Permission[];
    /** `sha256-<base64>` of the bundle that was consented to. */
    integrity: string;
}

/** `sha256-<base64>` — the exact shape `INTEGRITY_PATTERN` accepts. */
export async function hashBundle(bytes: ArrayBuffer | Uint8Array): Promise<string> {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // A copy keeps the digest indifferent to a caller's later mutation of the
    // buffer and to a typed-array view over a larger backing store.
    const digest = await crypto.subtle.digest("SHA-256", data.slice().buffer);
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return `sha256-${btoa(binary)}`;
}

/** The outcome of checking a fetched manifest against the release it claims to be. */
export type ManifestCheck =
    | { ok: true; manifest: PluginManifest; lane: PluginLane }
    | { ok: false; reason: string };

/**
 * Validate a fetched `tumult.plugin.json` as a RELEASE document (so `integrity`
 * is required) and derive its lane. The lane is returned with the manifest so
 * the consent screen shows exactly what the host computed, never a claim from
 * the document.
 */
export function checkReleaseManifest(value: unknown): ManifestCheck {
    const errors = validatePluginManifest(value, { requireIntegrity: true });
    if (errors.length > 0) {
        return { ok: false, reason: `The release manifest is not usable: ${errors.join("; ")}.` };
    }
    // `validatePluginManifest` has already proven these fields, so the cast is
    // narrow: it checked presence, string-ness and the permission enum.
    const manifest = value as PluginManifest;
    return { ok: true, manifest, lane: deriveLane(manifest) };
}

/**
 * Whether the user must be asked before this install runs.
 *
 * `true` when there is no prior record of the id, and when the version, the
 * permission set or the hash differ. Same version and same permissions but a
 * different hash is still a re-ask: the bytes changed, and the user consented
 * to bytes. (A pure version bump with identical permissions and a fresh hash
 * therefore re-asks — which is the same flow the doc describes; updates are a
 * user action, not a background one.)
 */
export function needsConsent(
    manifest: PluginManifest,
    previous: InstallRecordSummary | null,
): boolean {
    if (!previous) return true;
    if (previous.version !== manifest.version) return true;
    if (previous.integrity !== manifest.integrity) return true;
    return !samePermissionSet(previous.permissions, manifest.permissions);
}

/** Set equality, order-insensitive — the permission list is a set, not a list. */
export function samePermissionSet(a: readonly Permission[], b: readonly Permission[]): boolean {
    if (a.length !== b.length) return false;
    const set = new Set<string>(a);
    return b.every((permission) => set.has(permission));
}

/** Permissions this manifest gained relative to a prior record (for the copy). */
export function addedPermissions(
    manifest: PluginManifest,
    previous: InstallRecordSummary | null,
): Permission[] {
    if (!previous) return [...manifest.permissions];
    const before = new Set<string>(previous.permissions);
    return manifest.permissions.filter((permission) => !before.has(permission));
}

/** The refusal when a downloaded bundle does not hash to what was promised. */
export function hashMismatchReason(expected: string, actual: string): string {
    return (
        `The downloaded bundle does not match the manifest's hash — refusing to install. ` +
        `Expected ${expected}, got ${actual}. This means the file served is not the file ` +
        `the author published; do not retry, and tell the author.`
    );
}
