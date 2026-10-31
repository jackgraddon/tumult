import type { MatrixClient } from "matrix-js-sdk";
import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";

import type { DeviceView, SecurityStatus } from "../contract.ts";
import type { ClientContext } from "../client-context.ts";
import { Observable } from "../observable.ts";
import { ThrottledTask } from "../util/throttle.ts";
import { UNCHECKED_SECURITY, querySecurityStatus } from "./security.ts";
import { restoreFailureMessage, serveHeldKey, shouldVerifyDevice } from "./restore.ts";

/**
 * Coalesce window for crypto-event-driven security snapshots. A single sync or
 * device-list batch re-emits `KeysChanged` / `DevicesUpdated` many times, and
 * each snapshot walks cross-signing, backup trust and secret storage. Explicit
 * moments (start, restore, setup) still refresh immediately.
 */
export const SECURITY_REFRESH_MS = 250;

export interface CryptoControllerHooks {
    /** Re-run every timeline snapshot (newly restored keys upgrade `pending`). */
    rebuildTimelines: () => void;
}

/**
 * Encryption status and recovery: the security feed, recovery setup, backup
 * restore, the device list, and the recovery key the SDK's
 * `getSecretStorageKey` callback serves while one of those is in flight.
 *
 * SAS verification is NOT here: it is a per-start tracker with thin
 * delegates, and stays in the client.
 */
export class CryptoController {
    public readonly feed = new Observable<SecurityStatus>(UNCHECKED_SECURITY);

    private readonly ctx: ClientContext;
    private readonly hooks: CryptoControllerHooks;
    /**
     * A recovery key, held ONLY while setupRecovery() or restoreBackup() runs,
     * so the SDK's secret-storage requests can use it. Cleared in a `finally`
     * — never retained, never persisted. Read at call time by
     * {@link serveSecretStorageKey}; never captured by value.
     */
    private heldSecretKey: Uint8Array<ArrayBuffer> | null = null;
    /**
     * Coalesces crypto-event security refreshes (see {@link SECURITY_REFRESH_MS}).
     * Explicit call sites stay immediate and await the query directly.
     */
    private readonly securityRefresh: ThrottledTask;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(ctx: ClientContext, hooks: CryptoControllerHooks) {
        this.ctx = ctx;
        this.hooks = hooks;
        this.securityRefresh = new ThrottledTask(() => {
            void this.refresh();
        }, SECURITY_REFRESH_MS);
    }

    /**
     * Answer the SDK's `getSecretStorageKey` callback: the held key during
     * setupRecovery() / restoreBackup(), null otherwise (fresh setup has
     * nothing cached yet, and we never retain keys).
     */
    public serveSecretStorageKey(keys: Record<string, unknown>): [string, Uint8Array<ArrayBuffer>] | null {
        return serveHeldKey(this.heldSecretKey, keys);
    }

    /**
     * Key backup state can move at any time (another device rotates keys, a
     * backup completes). These three cover it; the snapshot recomputes
     * wholesale on each — but a single crypto batch re-emits them many times,
     * so the refresh is coalesced (see SECURITY_REFRESH_MS) rather than run
     * per event. Registers on the client passed in.
     */
    public watch(client: MatrixClient): void {
        for (const event of [
            CryptoEvent.KeyBackupStatus,
            CryptoEvent.KeysChanged,
            CryptoEvent.DevicesUpdated,
        ]) {
            client.on(event, () => {
                this.securityRefresh.schedule();
            });
        }
    }

    /** Drop a pending coalesced refresh. Idempotent. */
    public clearTimers(): void {
        this.securityRefresh.clear();
    }

    /** Stop-only reset: back to "not checked yet". */
    public resetForStop(): void {
        this.feed.set(UNCHECKED_SECURITY);
    }

    /**
     * Recompute the security snapshot. Never throws: crypto queries must not
     * take down event listeners.
     */
    public async refresh(): Promise<void> {
        const crypto = this.ctx.matrix()?.getCrypto();
        if (!crypto) return;
        try {
            this.feed.set(await querySecurityStatus(crypto));
        } catch (error) {
            console.error("[tumult] security snapshot failed", error);
        }
    }

    public async setupRecovery(): Promise<string> {
        const crypto = this.requireCrypto();

        // Identity first, as Element does: bootstrapSecretStorage stores the
        // cross-signing keys this device holds, so they must exist by then or
        // the recovery key can never verify another device. Only when the
        // ACCOUNT has none — an account with an identity this device cannot
        // use must be verified (emoji / recovery key), never silently rotated,
        // which would cut off every other device. The first upload needs no
        // interactive auth (MSC3967); a server that demands it fails loudly.
        // Without this, an account set up in Tumult had no identity at all
        // ("Couldn't sign … MissingSigningKey"), found by the e2ee browser test.
        if (!(await crypto.userHasCrossSigningKeys(undefined, true))) {
            await crypto.bootstrapCrossSigning({
                authUploadDeviceSigningKeys: async (makeRequest) => {
                    await makeRequest(null);
                },
            });
        }

        // Raw random key, not passphrase-derived: MAS accounts may have no
        // password, so password-based 4S is not a safe assumption.
        let encoded: string | undefined;
        try {
            await crypto.bootstrapSecretStorage({
                createSecretStorageKey: async () => {
                    const generated = await crypto.createRecoveryKeyFromPassphrase();
                    encoded = generated.encodedPrivateKey;
                    // The SDK asks getSecretStorageKey for this very key moments
                    // later, to store the backup and cross-signing keys under it.
                    // Without it held, the callback answered null and setup died
                    // AFTER creating the server backup: a backup nobody had the
                    // key to, and no recovery key ever shown.
                    this.heldSecretKey = generated.privateKey;
                    return generated;
                },
                setupNewKeyBackup: true,
            });
        } finally {
            this.heldSecretKey = null;
        }
        await this.refresh();
        // Empty when secret storage already existed: the account keeps its
        // old key and there is nothing new to save. Never null — callers
        // distinguish "show this once" from "already set up".
        return encoded ?? "";
    }

    public async restoreBackup(recoveryKey: string): Promise<boolean> {
        const crypto = this.requireCrypto();
        let decoded: Uint8Array<ArrayBuffer>;
        try {
            decoded = decodeRecoveryKey(recoveryKey.trim());
        } catch {
            throw new Error("That recovery key doesn't look valid. Check for typos and try again.");
        }
        // The pasted key must stay stashed for BOTH halves: the backup unlock
        // (loadSessionBackupPrivateKeyFromSecretStorage) and the verification
        // half (bootstrapCrossSigning reads cross-signing keys from 4S).
        // Both go through getSecretStorageKey → serveHeldKey. Cleared in the
        // finally below — never retained past this call.
        this.heldSecretKey = decoded;
        try {
            // Primary path: the pasted key opens secret storage (this is what
            // setupRecovery() shows). The backup key comes from 4S, never from
            // the pasted bytes directly — the two keys are different.
            let unlocked = false;
            try {
                await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
                unlocked = true;
            } catch {
                unlocked = false;
            }
            if (!unlocked) {
                // Fallback: the pasted key IS the backup decryption key
                // (backups made outside Tumult never entered secret storage).
                const check = await crypto.checkKeyBackupAndEnable().catch(() => null);
                if (!check) {
                    throw new Error(
                        "Couldn't unlock secret storage with that key, and this account " +
                            "has no key backup to try it against directly.",
                    );
                }
                try {
                    await crypto.storeSessionBackupPrivateKey(decoded, check.backupInfo.version);
                } catch {
                    throw new Error("That recovery key doesn't match this account's backup.");
                }
            }
            try {
                await crypto.restoreKeyBackup();
            } catch (cause) {
                console.error("[tumult] key backup restore failed", cause);
                throw new Error(restoreFailureMessage(cause), { cause });
            }
            // Verification half: the same pasted key unlocks 4S, which also
            // holds the cross-signing private keys. Importing them and
            // self-signing this device is what flips "Unverified" → verified
            // in other clients' session lists. Only when 4S has keys the
            // device lacks — otherwise bootstrapCrossSigning would rotate
            // the identity, which we never do here.
            let verified = false;
            try {
                const status = await crypto.getCrossSigningStatus();
                if (shouldVerifyDevice(status)) {
                    await crypto.bootstrapCrossSigning({});
                    verified = true;
                }
            } catch (cause) {
                // Verification is best-effort: the backup already restored, and
                // the device can still be verified later via SAS.
                console.error("[tumult] cross-signing import failed", cause);
            }
            await this.refresh();
            // Newly arrived keys upgrade `pending` timelines in place.
            this.hooks.rebuildTimelines();
            return verified;
        } finally {
            this.heldSecretKey = null;
        }
    }

    public async listDevices(): Promise<DeviceView[]> {
        const client = this.ctx.matrix();
        const session = this.ctx.session();
        if (!client || !session) throw new Error("Cannot list devices before start()");
        const { devices } = await client.getDevices();
        const crypto = client.getCrypto();
        const out: DeviceView[] = [];
        for (const d of devices) {
            let verified = false;
            if (crypto) {
                try {
                    verified = (await crypto.getDeviceVerificationStatus(session.userId, d.device_id))?.isVerified() ?? false;
                } catch {
                    verified = false;
                }
            }
            out.push({
                id: d.device_id,
                displayName: d.display_name ?? null,
                lastSeenTs: d.last_seen_ts ?? null,
                isCurrent: d.device_id === session.deviceId,
                verified,
            });
        }
        out.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.id.localeCompare(b.id));
        return out;
    }

    private requireCrypto(): CryptoApi {
        const crypto = this.ctx.matrix()?.getCrypto();
        if (!crypto) throw new Error("Encryption isn't ready yet; wait for sync to start.");
        return crypto;
    }
}
