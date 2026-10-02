import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";

import type { SecurityStatus } from "../contract.ts";

export interface SecurityQueryInput {
    crossSigningReady: boolean;
    /** A key backup exists on the server (regardless of trust). */
    backupPresent: boolean;
    /** This device holds the backup decryption key. */
    backupTrusted: boolean;
    secretStorageReady: boolean;
}

/**
 * Fold raw crypto state into the contract snapshot. Pure, so the banner
 * logic and the edge cases (fresh device, no backup at all, backup this
 * device can't open) are unit-testable without a crypto stack.
 */
export function toSecurityStatus(input: SecurityQueryInput): SecurityStatus {
    return {
        crossSigningReady: input.crossSigningReady,
        backupEnabled: input.backupPresent,
        backupTrusted: input.backupPresent && input.backupTrusted,
        secretStorageReady: input.secretStorageReady,
    };
}

/**
 * Query live crypto state. Each probe fails independently to `false`/absent:
 * a backup query must never break the whole snapshot.
 */
export async function querySecurityStatus(crypto: CryptoApi): Promise<SecurityStatus> {
    const [crossSigningReady, secretStorageReady] = await Promise.all([
        crypto.isCrossSigningReady().catch(() => false),
        crypto.isSecretStorageReady().catch(() => false),
    ]);
    let backupPresent = false;
    let backupTrusted = false;
    try {
        // Idempotent: also switches the backup engine on, which is what we
        // want running from login onward.
        const check = await crypto.checkKeyBackupAndEnable();
        backupPresent = check != null;
        backupTrusted = check?.trustInfo.trusted ?? false;
    } catch {
        // Leave both false; the banner will prompt setup.
    }
    return toSecurityStatus({ crossSigningReady, backupPresent, backupTrusted, secretStorageReady });
}
