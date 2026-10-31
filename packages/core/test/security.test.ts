import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";

import { UNCHECKED_SECURITY, querySecurityStatus, toSecurityStatus } from "../src/crypto/security.ts";
import { restoreFailureMessage, serveHeldKey, shouldVerifyDevice } from "../src/crypto/restore.ts";

function stubCrypto(over: Record<string, unknown> = {}): CryptoApi {
    return {
        isCrossSigningReady: async () => true,
        isSecretStorageReady: async () => true,
        checkKeyBackupAndEnable: async () => ({ backupInfo: {}, trustInfo: { trusted: true } }),
        ...over,
    } as unknown as CryptoApi;
}

describe("toSecurityStatus", () => {
    it("maps a healthy device", () => {
        assert.deepEqual(
            toSecurityStatus({
                crossSigningReady: true,
                backupPresent: true,
                backupTrusted: true,
                secretStorageReady: true,
            }),
            {
                checked: true,
                crossSigningReady: true,
                backupEnabled: true,
                backupTrusted: true,
                secretStorageReady: true,
            },
        );
    });

    it("is the only way to a checked status: the placeholder is unchecked", () => {
        // The banner acts on nothing unchecked; a placeholder that claimed to
        // be checked would show "backup is off" to everyone on every boot.
        assert.equal(UNCHECKED_SECURITY.checked, false);
    });

    it("marks a fresh device with an unopenable backup", () => {
        const s = toSecurityStatus({
            crossSigningReady: false,
            backupPresent: true,
            backupTrusted: false,
            secretStorageReady: false,
        });
        assert.equal(s.backupEnabled, true);
        assert.equal(s.backupTrusted, false);
    });

    it("never reports trust without a backup", () => {
        const s = toSecurityStatus({
            crossSigningReady: false,
            backupPresent: false,
            backupTrusted: true,
            secretStorageReady: false,
        });
        assert.equal(s.backupEnabled, false);
        assert.equal(s.backupTrusted, false);
    });
});

describe("querySecurityStatus", () => {
    it("folds live crypto state", async () => {
        const s = await querySecurityStatus(stubCrypto());
        assert.equal(s.backupEnabled, true);
        assert.equal(s.backupTrusted, true);
        assert.equal(s.crossSigningReady, true);
    });

    it("degrades gracefully when probes fail", async () => {
        const s = await querySecurityStatus(
            stubCrypto({
                isCrossSigningReady: async () => {
                    throw new Error("nope");
                },
                checkKeyBackupAndEnable: async () => null,
            }),
        );
        assert.deepEqual(s, {
            checked: true,
            crossSigningReady: false,
            backupEnabled: false,
            backupTrusted: false,
            secretStorageReady: true,
        });
    });
});

describe("serveHeldKey", () => {
    const key = new Uint8Array(32) as Uint8Array<ArrayBuffer>;
    it("serves the held key for a single candidate", () => {
        assert.deepEqual(serveHeldKey(key, { abc123: {} }), ["abc123", key]);
    });
    it("refuses without a key, with none, or with several candidates", () => {
        assert.equal(serveHeldKey(null, { abc123: {} }), null);
        assert.equal(serveHeldKey(key, {}), null);
        assert.equal(serveHeldKey(key, { a: {}, b: {} }), null);
    });
});

describe("restoreFailureMessage", () => {
    it("points rotated backups at setup-again", () => {
        const msg = restoreFailureMessage(
            new Error("getBackupDecryptor: key backup on server does not match the decryption key"),
        );
        assert.match(msg, /set up recovery again/);
        assert.doesNotMatch(msg, /getBackupDecryptor/);
    });
    it("translates anything else through describeError", () => {
        const msg = restoreFailureMessage(new TypeError("NetworkError when attempting to fetch resource."));
        assert.match(msg, /^Couldn't download the backup: couldn't reach the server\. Check your connection/);
    });
});

describe("shouldVerifyDevice", () => {
    const base = {
        privateKeysInSecretStorage: true,
        privateKeysCachedLocally: { masterKey: true, selfSigningKey: true, userSigningKey: true },
    };
    it("verifies when 4S holds keys the device lacks", () => {
        assert.equal(
            shouldVerifyDevice({
                privateKeysInSecretStorage: true,
                privateKeysCachedLocally: { masterKey: false, selfSigningKey: false, userSigningKey: false },
            }),
            true,
        );
    });
    it("skips when the device already has the keys", () => {
        assert.equal(shouldVerifyDevice(base), false);
    });
    it("skips when 4S has no keys (would rotate identity)", () => {
        assert.equal(shouldVerifyDevice({ ...base, privateKeysInSecretStorage: false }), false);
    });
    it("imports on partial local cache too (matches SDK bootstrap)", () => {
        assert.equal(
            shouldVerifyDevice({
                privateKeysInSecretStorage: true,
                privateKeysCachedLocally: { masterKey: true, selfSigningKey: false, userSigningKey: true },
            }),
            true,
        );
    });
});
