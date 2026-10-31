import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { MatrixClient } from "matrix-js-sdk";
import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import { encodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";

import { AuthStorage } from "../src/auth/storage.ts";
import type { ClientContext } from "../src/client-context.ts";
import { CryptoController, SECURITY_REFRESH_MS } from "../src/crypto/controller.ts";
import { UNCHECKED_SECURITY } from "../src/crypto/security.ts";

const KEY_ID = { abc: {} };

function context(matrix: () => MatrixClient | null): ClientContext {
    const data = new Map<string, string>();
    return {
        storage: new AuthStorage({
            getItem: (key) => data.get(key) ?? null,
            setItem: (key, value) => void data.set(key, value),
            removeItem: (key) => void data.delete(key),
        }),
        matrix,
        session: () => ({
            userId: "@alice:example.com",
            deviceId: "DEV",
            homeserverUrl: "https://hs.example.com",
            accessToken: "t",
            clientId: "c",
        }),
        selectedRoomId: () => null,
    };
}

/**
 * A CryptoApi whose every method is a no-op unless `overrides` supplies it.
 * The snapshot query (`querySecurityStatus`) tolerates the defaults.
 */
function stubCrypto(overrides: Partial<Record<keyof CryptoApi, unknown>>): CryptoApi {
    return new Proxy(overrides, {
        get: (target, prop) => {
            if (prop in target) return target[prop as keyof CryptoApi];
            if (prop === "then") return undefined;
            return async () => null;
        },
    }) as unknown as CryptoApi;
}

function client(crypto: CryptoApi | undefined): MatrixClient {
    const emitter = new EventEmitter();
    return Object.assign(emitter, { getCrypto: () => crypto }) as unknown as MatrixClient;
}

describe("CryptoController", () => {
    it("serves no key outside setupRecovery / restoreBackup", () => {
        const ctl = new CryptoController(context(() => null), { rebuildTimelines: () => undefined });
        assert.equal(ctl.serveSecretStorageKey(KEY_ID), null);
    });

    it("setupRecovery serves the generated key during bootstrapSecretStorage and clears it after", async () => {
        const privateKey = new Uint8Array([1, 2, 3]);
        let matrix: MatrixClient | null = null;
        const ctl = new CryptoController(context(() => matrix), { rebuildTimelines: () => undefined });
        let servedDuring: unknown = "not asked";
        const crypto = stubCrypto({
            userHasCrossSigningKeys: async () => true,
            createRecoveryKeyFromPassphrase: async () => ({ privateKey, encodedPrivateKey: "EsTc 1234" }),
            bootstrapSecretStorage: async (opts: { createSecretStorageKey: () => Promise<unknown> }) => {
                await opts.createSecretStorageKey();
                // The SDK asks for the key it just created, through the callback.
                servedDuring = ctl.serveSecretStorageKey(KEY_ID);
            },
        });
        matrix = client(crypto);
        assert.equal(await ctl.setupRecovery(), "EsTc 1234");
        assert.deepEqual(servedDuring, ["abc", privateKey]);
        assert.equal(ctl.serveSecretStorageKey(KEY_ID), null);
    });

    it("setupRecovery clears the held key when bootstrap throws", async () => {
        let matrix: MatrixClient | null = null;
        const ctl = new CryptoController(context(() => matrix), { rebuildTimelines: () => undefined });
        const crypto = stubCrypto({
            userHasCrossSigningKeys: async () => true,
            createRecoveryKeyFromPassphrase: async () => ({ privateKey: new Uint8Array([9]), encodedPrivateKey: "k" }),
            bootstrapSecretStorage: async (opts: { createSecretStorageKey: () => Promise<unknown> }) => {
                await opts.createSecretStorageKey();
                assert.notEqual(ctl.serveSecretStorageKey(KEY_ID), null);
                throw new Error("4S failed");
            },
        });
        matrix = client(crypto);
        await assert.rejects(ctl.setupRecovery(), /4S failed/);
        assert.equal(ctl.serveSecretStorageKey(KEY_ID), null);
    });

    it("restoreBackup holds the key across BOTH the backup unlock and the cross-signing import", async () => {
        const raw = new Uint8Array(32).fill(7);
        const recoveryKey = encodeRecoveryKey(raw);
        assert.ok(recoveryKey);
        let matrix: MatrixClient | null = null;
        let rebuilds = 0;
        const ctl = new CryptoController(context(() => matrix), { rebuildTimelines: () => void rebuilds++ });
        const served: Record<string, unknown> = {};
        const crypto = stubCrypto({
            loadSessionBackupPrivateKeyFromSecretStorage: async () => {
                served.unlock = ctl.serveSecretStorageKey(KEY_ID);
            },
            restoreKeyBackup: async () => ({ total: 1, imported: 1 }),
            // 4S holds cross-signing keys this device lacks → import them.
            getCrossSigningStatus: async () => ({
                publicKeysOnDevice: false,
                privateKeysInSecretStorage: true,
                privateKeysCachedLocally: { masterKey: false, selfSigningKey: false, userSigningKey: false },
            }),
            bootstrapCrossSigning: async () => {
                served.import = ctl.serveSecretStorageKey(KEY_ID);
            },
        });
        matrix = client(crypto);
        assert.equal(await ctl.restoreBackup(recoveryKey), true);
        assert.deepEqual(served.unlock, ["abc", raw]);
        assert.deepEqual(served.import, ["abc", raw]);
        assert.equal(rebuilds, 1);
        assert.equal(ctl.serveSecretStorageKey(KEY_ID), null);
    });

    it("restoreBackup clears the key and skips the rebuild when restore fails", async () => {
        const recoveryKey = encodeRecoveryKey(new Uint8Array(32).fill(3));
        assert.ok(recoveryKey);
        let rebuilds = 0;
        const crypto = stubCrypto({
            loadSessionBackupPrivateKeyFromSecretStorage: async () => undefined,
            restoreKeyBackup: async () => {
                throw new Error("boom");
            },
        });
        const matrix = client(crypto);
        const ctl = new CryptoController(context(() => matrix), { rebuildTimelines: () => void rebuilds++ });
        await assert.rejects(ctl.restoreBackup(recoveryKey));
        assert.equal(rebuilds, 0);
        assert.equal(ctl.serveSecretStorageKey(KEY_ID), null);
    });

    it("rejects an unparseable recovery key without holding anything", async () => {
        const matrix = client(stubCrypto({}));
        const ctl = new CryptoController(context(() => matrix), { rebuildTimelines: () => undefined });
        await assert.rejects(
            ctl.restoreBackup("not a key"),
            /^Error: That recovery key doesn't look valid\. Check for typos and try again\.$/,
        );
        assert.equal(ctl.serveSecretStorageKey(KEY_ID), null);
    });

    it("refuses recovery and device listing before start with the contract's messages", async () => {
        const ctl = new CryptoController(context(() => null), { rebuildTimelines: () => undefined });
        await assert.rejects(ctl.setupRecovery(), /^Error: Encryption isn't ready yet; wait for sync to start\.$/);
        await assert.rejects(ctl.listDevices(), /^Error: Cannot list devices before start\(\)$/);
    });

    it("coalesces a CryptoEvent burst into one refresh, and clearTimers drops it", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let queries = 0;
        // The snapshot query's first probe runs synchronously when a refresh starts.
        const crypto = stubCrypto({
            isCrossSigningReady: async () => {
                queries++;
                return true;
            },
        });
        const matrix = client(crypto);
        const ctl = new CryptoController(context(() => matrix), { rebuildTimelines: () => undefined });
        ctl.watch(matrix);
        const emit = (event: CryptoEvent): boolean => (matrix as unknown as EventEmitter).emit(event);
        emit(CryptoEvent.KeyBackupStatus);
        emit(CryptoEvent.KeysChanged);
        emit(CryptoEvent.DevicesUpdated);
        assert.equal(queries, 0);
        t.mock.timers.tick(SECURITY_REFRESH_MS);
        assert.equal(queries, 1);

        emit(CryptoEvent.KeysChanged);
        ctl.clearTimers();
        t.mock.timers.tick(SECURITY_REFRESH_MS);
        assert.equal(queries, 1);
    });

    it("resetForStop returns the feed to unchecked", () => {
        const ctl = new CryptoController(context(() => null), { rebuildTimelines: () => undefined });
        ctl.feed.set({ ...UNCHECKED_SECURITY, checked: true });
        ctl.resetForStop();
        assert.equal(ctl.feed.get(), UNCHECKED_SECURITY);
    });
});
