/**
 * useAppStorage.ts
 *
 * Unified storage abstraction for Ruby Chat.
 *
 * Two tiers:
 *   setPref / getPref / deletePref  — non-sensitive preferences, backed by
 *                                     @tauri-apps/plugin-store (plain JSON
 *                                     file in appDataDir) in Tauri, or
 *                                     localStorage on the web.
 *
 *   setSecret / getSecret / deleteSecret — sensitive credentials (access
 *                                          token, refresh token…), backed by
 *                                          @tauri-apps/plugin-stronghold
 *                                          (AES-GCM-encrypted vault on disk)
 *                                          in Tauri, or sessionStorage on web.
 *
 * ─── WHY NO OS KEYCHAIN ─────────────────────────────────────────────────────
 * The vault password is a random 32-byte salt stored in the preferences store
 * under the key "_vault_salt". This deliberately bypasses the OS keychain so
 * no authentication dialog is ever shown. The salt is not secret — Argon2id
 * (on the Rust side) stretches it into the actual AES encryption key, so the
 * raw salt never appears in the vault itself.
 *
 * ─── RUST SETUP REQUIRED ────────────────────────────────────────────────────
 * In src-tauri/src/lib.rs, register Stronghold with an Argon2id hasher:
 *
 *   use argon2::{hash_raw, Config, Variant, Version};
 *
 *   tauri::Builder::default()
 *     .plugin(tauri_plugin_store::Builder::default().build())
 *     .plugin(
 *       tauri_plugin_stronghold::Builder::new(|password| {
 *         let config = Config {
 *           lanes: 2,
 *           mem_cost: 65_536,
 *           time_cost: 3,
 *           variant: Variant::Argon2id,
 *           version: Version::Version13,
 *           ..Default::default()
 *         };
 *         hash_raw(password.as_ref(), b"ruby-stronghold-v1", &config)
 *           .expect("argon2 hash failed")
 *       })
 *       .build(),
 *     )
 *     .run(tauri::generate_context!())
 *     .expect("error while running tauri application");
 *
 * Cargo.toml additions:
 *   tauri-plugin-stronghold = "2"
 *   tauri-plugin-store      = "2"
 *   argon2                  = "0.5"
 */

import type { LazyStore } from '@tauri-apps/plugin-store';
import type { Stronghold, Client } from '@tauri-apps/plugin-stronghold';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTauri(): boolean {
    return import.meta.client && !!(window as any).__TAURI_INTERNALS__;
}

// ─── Preferences (non-sensitive) ─────────────────────────────────────────────

// _prefStore is initialised lazily on first use, NOT at module level.
// Constructing LazyStore at module level causes it to evaluate during Nuxt's
// SSR pass where @tauri-apps/api/core is unavailable — that import throws and
// prevents the app from mounting, resulting in a black screen.
let _prefStore: LazyStore | null = null;

async function getPrefStore(): Promise<LazyStore> {
    if (_prefStore) return _prefStore;
    // Dynamic import so the module is never evaluated during SSR
    const { LazyStore } = await import('@tauri-apps/plugin-store');
    // `defaults: {}` is required by StoreOptions — empty object means no defaults
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

// ─── Secrets (sensitive) ─────────────────────────────────────────────────────

// The Stronghold v2 API separates the vault handle (Stronghold) from the
// named client (Client). save() lives on Stronghold; getStore() lives on
// Client and takes no arguments — the client itself is the named collection.
let _stronghold: Stronghold | null = null;
let _strongholdClient: Client | null = null;

const STRONGHOLD_CLIENT_NAME = 'app-secrets';

/**
 * Returns the vault password: a hex-encoded random salt stored in the plain
 * preferences file under the key "_vault_salt". Written once on first launch,
 * reused on every subsequent open.
 *
 * The salt is not sensitive — Argon2id on the Rust side stretches it into
 * the real AES encryption key. Storing it in the prefs file avoids any OS
 * keychain involvement while still providing per-installation entropy.
 */
async function _loadOrCreateVaultPassword(): Promise<string> {
    const store = await getPrefStore();
    const existing = await store.get<string>('_vault_salt');
    if (existing && existing.length >= 32) return existing;

    // First run — generate and persist a new random salt
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const salt = Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    await store.set('_vault_salt', salt);
    await store.save();
    console.log('[AppStorage] Generated new vault salt (first launch)');
    return salt;
}

/**
 * Opens (or creates) the Stronghold vault and returns the cached handles.
 * Subsequent calls return the existing handles without re-opening.
 *
 * Stronghold v2 API shape:
 *   Stronghold.load(path, password) → Stronghold
 *   stronghold.loadClient(name)     → Client  (throws if not found yet)
 *   stronghold.createClient(name)   → Client  (creates on fresh install)
 *   client.getStore()               → Store   (no arguments)
 *   stronghold.save()               → void    (NOT client.save())
 */
async function _getClient(): Promise<{ client: Client; stronghold: Stronghold }> {
    if (_strongholdClient && _stronghold) {
        return { client: _strongholdClient, stronghold: _stronghold };
    }

    // Dynamic imports — never evaluated during SSR
    const { Stronghold } = await import('@tauri-apps/plugin-stronghold');
    const { appDataDir, join } = await import('@tauri-apps/api/path');

    const dataDir = await appDataDir();
    const vaultPath = await join(dataDir, 'secrets.hold');
    const password = await _loadOrCreateVaultPassword();

    _stronghold = await Stronghold.load(vaultPath, password);

    try {
        _strongholdClient = await _stronghold.loadClient(STRONGHOLD_CLIENT_NAME);
    } catch {
        // Client doesn't exist yet on a fresh install — create it
        _strongholdClient = await _stronghold.createClient(STRONGHOLD_CLIENT_NAME);
    }

    console.log('[AppStorage] Stronghold vault opened');
    return { client: _strongholdClient, stronghold: _stronghold };
}

export async function setSecret(key: string, value: string): Promise<void> {
    if (isTauri()) {
        const { client, stronghold } = await _getClient();
        const store = client.getStore();
        const encoded = Array.from(new TextEncoder().encode(value));
        await store.insert(key, encoded);
        await stronghold.save();
    } else {
        try { sessionStorage.setItem(`secret:${key}`, value); } catch { /* SSR */ }
    }
}

export async function getSecret(key: string): Promise<string | null> {
    if (isTauri()) {
        try {
            const { client } = await _getClient();
            const store = client.getStore();
            const raw = await store.get(key);
            if (!raw) return null;
            return new TextDecoder().decode(new Uint8Array(raw));
        } catch (e) {
            console.warn(`[AppStorage] getSecret("${key}") failed:`, e);
            return null;
        }
    }
    try { return sessionStorage.getItem(`secret:${key}`); } catch { return null; }
}

export async function deleteSecret(key: string): Promise<void> {
    if (isTauri()) {
        try {
            const { client, stronghold } = await _getClient();
            const store = client.getStore();
            await store.remove(key);
            await stronghold.save();
        } catch (e) {
            console.warn(`[AppStorage] deleteSecret("${key}") failed:`, e);
        }
    } else {
        try { sessionStorage.removeItem(`secret:${key}`); } catch { /* SSR */ }
    }
}

/**
 * Flush the vault to disk. Every write already calls stronghold.save()
 * immediately, so this is only needed as a safety net on app teardown
 * (e.g. in a Tauri window-close event handler).
 */
export async function flushSecrets(): Promise<void> {
    if (_stronghold) {
        try {
            await _stronghold.save();
        } catch (e) {
            console.warn('[AppStorage] flushSecrets failed:', e);
        }
    }
}