/**
 * useAppStorage.ts
 *
 * Unified storage abstraction for Tumult.
 *
 * Two tiers:
 *   setPref / getPref / deletePref  — non-sensitive preferences, backed by
 *                                     @tauri-apps/plugin-store (plain JSON
 *                                     file in appDataDir) in Tauri, or
 *                                     localStorage on the web.
 *
 *   setSecret / getSecret / deleteSecret — sensitive credentials (access
 *                                          token, refresh token…), encrypted
 *                                          with AES-256-GCM via Web Crypto API
 *                                          and stored in a dedicated Tauri Store
 *                                          file, or sessionStorage on web.
 *
 * ─── ENCRYPTION DESIGN ────────────────────────────────────────────────────
 * On first launch a random AES-256-GCM key is generated via Web Crypto and
 * exported as JWK into the preferences store under "_crypto_key". Each secret
 * value is encrypted with a unique random 12-byte IV; both the IV and the
 * ciphertext are stored as base64 in a separate `secrets.json` store file.
 *
 * This provides encryption-at-rest with zero startup delay (no Argon2id).
 */

import type { LazyStore } from '@tauri-apps/plugin-store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTauri(): boolean {
    return import.meta.client && !!(window as any).__TAURI_INTERNALS__;
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
    if (isTauri()) {
        const store = await getPrefStore();
        await store.set(key, value);
        await store.save();
    } else {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Quota exceeded or SSR — ignore
        }
    }
}

export async function getPref<T>(key: string, defaultValue: T): Promise<T> {
    if (isTauri()) {
        const store = await getPrefStore();
        const stored = await store.get<T>(key);
        return stored ?? defaultValue;
    }
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaultValue;
        return JSON.parse(raw) as T;
    } catch {
        return defaultValue;
    }
}

export async function deletePref(key: string): Promise<void> {
    if (isTauri()) {
        const store = await getPrefStore();
        await store.delete(key);
        await store.save();
    } else {
        try {
            localStorage.removeItem(key);
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
        const store = await getPrefStore();
        const existingJwk = await store.get<JsonWebKey>('_crypto_key');

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
            await store.set('_crypto_key', jwk);
            await store.save();

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
    if (isTauri()) {
        const store = await getSecretStore();
        const encrypted = await _encrypt(value);
        await store.set(key, encrypted);
        await store.save();
    } else {
        try { sessionStorage.setItem(`secret:${key}`, value); } catch { /* SSR */ }
    }
}

export async function getSecret(key: string): Promise<string | null> {
    if (isTauri()) {
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
    try { return sessionStorage.getItem(`secret:${key}`); } catch { return null; }
}

export async function deleteSecrets(keys: string[]): Promise<void> {
    if (isTauri()) {
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
                sessionStorage.removeItem(`secret:${key}`);
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