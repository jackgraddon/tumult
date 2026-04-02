/**
 * useAppStorage.ts
 *
 * Unified storage abstraction for Tumult.
 *
 * Two tiers:
 *   setPref / getPref / deletePref  — non-sensitive preferences, backed by
 *                                     @tauri-apps/plugin-store (plain JSON
 *                                     file in appDataDir) in Tauri, or
 *                                     IndexedDB on the web/mobile.
 *
 *   setSecret / getSecret / deleteSecret — sensitive credentials (access
 *                                          token, refresh token…), encrypted
 *                                          with AES-256-GCM via Web Crypto API
 *                                          and stored in a dedicated Tauri Store
 *                                          file, or IndexedDB on web/mobile.
 *
 * ─── ENCRYPTION DESIGN ────────────────────────────────────────────────────
 * On first launch a random AES-256-GCM key is generated via Web Crypto and
 * exported as JWK into the preferences store under "_crypto_key". Each secret
 * value is encrypted with a unique random 12-byte IV; both the IV and the
 * ciphertext are stored as base64 in a separate `secrets.json` store file.
 *
 * This provides encryption-at-rest with zero startup delay (no Argon2id).
 *
 * ─── INDEXEDDB FALLBACK (PWA/Mobile) ──────────────────────────────────────
 * On mobile browsers, localStorage can be cleared aggressively. We use
 * IndexedDB as the primary persistence layer for web to ensure session stability.
 */

import type { LazyStore } from '@tauri-apps/plugin-store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isTauri = import.meta.client && !!(window as any).__TAURI_INTERNALS__;

const DB_NAME = 'tumult-storage';
const PREF_STORE = 'preferences';
const SECRET_STORE = 'secrets';
const DB_VERSION = 1;

let _db: IDBDatabase | null = null;

async function getDb(): Promise<IDBDatabase> {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PREF_STORE)) db.createObjectStore(PREF_STORE);
            if (!db.objectStoreNames.contains(SECRET_STORE)) db.createObjectStore(SECRET_STORE);
        };
        request.onsuccess = () => {
            _db = request.result;
            resolve(_db);
        };
        request.onerror = () => reject(request.error);
    });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
    });
}

async function idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        store.put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        store.delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

// ─── Preferences (non-sensitive) ─────────────────────────────────────────────

let _prefStore: LazyStore | null = null;

async function getPrefStore(): Promise<LazyStore> {
    if (_prefStore) return _prefStore;
    const { LazyStore } = await import('@tauri-apps/plugin-store');
    _prefStore = new LazyStore('preferences.json', { autoSave: false, defaults: {} });
    return _prefStore;
}

export async function setPref<T>(key: string, value: T): Promise<void> {
    if (isTauri) {
        const store = await getPrefStore();
        await store.set(key, value);
        await store.save();
    } else {
        try {
            await idbSet(PREF_STORE, key, value);
        } catch (e) {
            console.warn('[AppStorage] setPref failed:', e);
        }
    }
}

export async function getPref<T>(key: string, defaultValue: T): Promise<T> {
    if (isTauri) {
        const store = await getPrefStore();
        const stored = await store.get<T>(key);
        return stored ?? defaultValue;
    }
    try {
        const stored = await idbGet<T>(PREF_STORE, key);
        return stored ?? defaultValue;
    } catch {
        return defaultValue;
    }
}

export async function deletePref(key: string): Promise<void> {
    if (isTauri) {
        const store = await getPrefStore();
        await store.delete(key);
        await store.save();
    } else {
        try {
            await idbDelete(PREF_STORE, key);
        } catch {
            // Ignore
        }
    }
}

// ─── Secrets (sensitive, AES-256-GCM encrypted) ─────────────────────────────

let _secretStore: LazyStore | null = null;
let _cryptoKey: CryptoKey | null = null;
let _cryptoInitPromise: Promise<void> | null = null;

interface EncryptedBlob {
    iv: string;      // base64-encoded 12-byte IV
    ct: string;      // base64-encoded ciphertext
}

/** Get or create the secrets store (separate file from preferences). */
async function getSecretStore(): Promise<LazyStore> {
    if (_secretStore) return _secretStore;
    const { LazyStore } = await import('@tauri-apps/plugin-store');
    _secretStore = new LazyStore('secrets.json', { autoSave: false, defaults: {} });
    return _secretStore;
}

/** Base64 encode/decode helpers using browser APIs. */
function toBase64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/**
 * Initialise the AES-256-GCM key. On first launch this generates a new key
 * and persists it as JWK in the preferences store. On subsequent launches it
 * imports the stored JWK.
 */
async function _ensureCryptoKey(): Promise<void> {
    if (_cryptoKey) return;

    if (_cryptoInitPromise) {
        await _cryptoInitPromise;
        return;
    }

    _cryptoInitPromise = (async () => {
        let existingJwk: JsonWebKey | null = null;
        if (isTauri) {
            const store = await getPrefStore();
            const stored = await store.get<JsonWebKey>('_crypto_key');
            existingJwk = stored ?? null;
        } else {
            try {
                existingJwk = await idbGet<JsonWebKey>(PREF_STORE, '_crypto_key');
            } catch { /* ignore */ }
        }

        if (existingJwk) {
            _cryptoKey = await crypto.subtle.importKey(
                'jwk',
                existingJwk,
                { name: 'AES-GCM', length: 256 },
                false,       // not extractable after import
                ['encrypt', 'decrypt']
            );
            console.log('[AppStorage] Crypto key loaded from preferences');
        } else {
            // First launch — generate and persist
            _cryptoKey = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,        // extractable so we can export as JWK
                ['encrypt', 'decrypt']
            );
            const jwk = await crypto.subtle.exportKey('jwk', _cryptoKey);

            if (isTauri) {
                const store = await getPrefStore();
                await store.set('_crypto_key', jwk);
                await store.save();
            } else {
                try {
                    await idbSet(PREF_STORE, '_crypto_key', jwk);
                } catch { /* ignore */ }
            }

            // Re-import as non-extractable for runtime use
            _cryptoKey = await crypto.subtle.importKey(
                'jwk',
                jwk,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
            console.log('[AppStorage] Generated new crypto key (first launch)');
        }

        // --- 2026 Standards: Sync Master Key to IndexedDB for Service Worker ---
        // Service Workers cannot access localStorage, so we mirror the master key
        // into a shared IndexedDB store so the SW can decrypt push notifications.
        try {
            const { saveCryptoKey } = await import('~/utils/crypto-db');
            await saveCryptoKey(_cryptoKey);
            console.log('[AppStorage] Master key synced to IndexedDB for SW access');
        } catch (dbErr) {
            console.warn('[AppStorage] Failed to sync key to IndexedDB:', dbErr);
        }
    })();

    await _cryptoInitPromise;
}

/** Encrypt a plaintext string → EncryptedBlob */
async function _encrypt(plaintext: string): Promise<EncryptedBlob> {
    await _ensureCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        _cryptoKey!,
        encoded
    );
    return {
        iv: toBase64(iv.buffer),
        ct: toBase64(ciphertext),
    };
}

/** Decrypt an EncryptedBlob → plaintext string */
async function _decrypt(blob: EncryptedBlob): Promise<string> {
    await _ensureCryptoKey();
    const iv = fromBase64(blob.iv);
    const ct = fromBase64(blob.ct);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource },
        _cryptoKey!,
        ct as unknown as BufferSource
    );
    return new TextDecoder().decode(decrypted);
}

// ─── Public Secret API ───────────────────────────────────────────────────────

export async function setSecret(key: string, value: string): Promise<void> {
    if (isTauri) {
        const store = await getSecretStore();
        const encrypted = await _encrypt(value);
        await store.set(key, encrypted);
        await store.save();
    } else {
        try {
            const encrypted = await _encrypt(value);
            await idbSet(SECRET_STORE, key, encrypted);
        } catch { /* SSR */ }
    }
}

export async function getSecret(key: string): Promise<string | null> {
    if (isTauri) {
        try {
            const store = await getSecretStore();
            const blob = await store.get<EncryptedBlob>(key);
            if (!blob || !blob.iv || !blob.ct) return null;
            return await _decrypt(blob);
        } catch (e) {
            console.warn(`[AppStorage] getSecret("${key}") failed:`, e);
            return null;
        }
    }
    try {
        const blob = await idbGet<EncryptedBlob>(SECRET_STORE, key);
        if (!blob) return null;
        return await _decrypt(blob);
    } catch { return null; }
}

export async function deleteSecrets(keys: string[]): Promise<void> {
    if (isTauri) {
        try {
            const store = await getSecretStore();
            for (const key of keys) {
                await store.delete(key);
            }
            await store.save();
        } catch (e) {
            console.warn('[AppStorage] deleteSecrets() failed:', e);
        }
    } else {
        try {
            for (const key of keys) {
                await idbDelete(SECRET_STORE, key);
            }
        } catch { /* SSR */ }
    }
}

export async function deleteSecret(key: string): Promise<void> {
    return await deleteSecrets([key]);
}

/**
 * No-op kept for API compatibility. The Tauri Store auto-persists on save(),
 * which is already called by every write operation above.
 */
export async function flushSecrets(): Promise<void> {
    // Nothing to do — every setSecret/deleteSecret already calls store.save()
}

/**
 * No-op kept for API compatibility. There is no file lock to release with
 * the Tauri Store backend (unlike Stronghold).
 */
export async function unloadSecrets(): Promise<void> {
    // Nothing to do — Tauri Store has no file locks to release
}