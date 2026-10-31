/**
 * Helpers for the paste-a-recovery-key restore flow. Pure, so the key-type
 * routing and every failure message are unit-testable without a crypto stack.
 */

import { describeError } from "../errors.ts";

/**
 * Serve a user-pasted key to the SDK's secret-storage requests.
 *
 * Returns the held key only when exactly one candidate key is requested:
 * with several candidates we cannot know which one the pasted bytes open,
 * and guessing wrong produces misleading "does not match" errors.
 */
export function serveHeldKey(
    held: Uint8Array<ArrayBuffer> | null,
    keys: Record<string, unknown>,
): [string, Uint8Array<ArrayBuffer>] | null {
    const ids = Object.keys(keys);
    const id = ids[0];
    if (!held || ids.length !== 1 || !id) return null;
    return [id, held];
}

/**
 * Friendly message for a failed `restoreKeyBackup()` after the key was
 * accepted. A rotated backup (key predates the current server version) gets
 * its own message pointing at setup-again; everything else stays generic —
 * raw SDK strings never reach the modal.
 */
export function restoreFailureMessage(cause: unknown): string {
    const text = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
    if (/does not match/i.test(text)) {
        return (
            "That key doesn't open this account's current backup. " +
            "If the backup was reset since the key was saved, set up recovery again " +
            "on a device that can still read history."
        );
    }
    return describeError(cause, "Couldn't download the backup");
}

export interface CrossSigningStatusLike {
    privateKeysInSecretStorage: boolean;
    privateKeysCachedLocally: {
        masterKey: boolean;
        selfSigningKey: boolean;
        userSigningKey: boolean;
    };
}

/**
 * Should restore also import cross-signing keys and self-sign this device?
 *
 * True only when 4S holds the private keys AND the device lacks them locally —
 * the exact case `bootstrapCrossSigning({})` handles by importing and
 * self-signing. When the device already has keys, or 4S has none, the call
 * would either no-op or (worst case) rotate the identity, so we skip.
 */
export function shouldVerifyDevice(status: CrossSigningStatusLike): boolean {
    const hasLocal =
        status.privateKeysCachedLocally.masterKey &&
        status.privateKeysCachedLocally.selfSigningKey &&
        status.privateKeysCachedLocally.userSigningKey;
    return status.privateKeysInSecretStorage && !hasLocal;
}
