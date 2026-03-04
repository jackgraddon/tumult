import { Store } from '@tauri-apps/plugin-store';
import { Client, Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir } from '@tauri-apps/api/path';

// Singleton instances shared across the app
let _store: Store | null = null;
let _strongholdClient: Client | null = null;

// Non-sensitive persistent storage (replaces localStorage for prefs)
export async function getTauriStore(): Promise<Store> {
    if (_store) return _store;
    _store = await Store.load('ruby-prefs.json', { autoSave: true, defaults: {} });
    return _store;
}

// Sensitive credential storage (replaces localStorage for tokens)
export async function getStrongholdClient(): Promise<Client | null> {
    if (_strongholdClient) return _strongholdClient;

    try {
        const appData = await appDataDir();
        const vaultPath = `${appData}/ruby-vault.hold`;

        // Derive stronghold password from a machine-specific value
        // so the user never has to enter one manually.
        // Use the device's hostname + app name as entropy.
        const { hostname } = await import('@tauri-apps/plugin-os');
        const host = await hostname() ?? 'ruby-chat';
        const password = `ruby-chat-vault-${host}`;

        const stronghold = await Stronghold.load(vaultPath, password);
        try {
            _strongholdClient = await stronghold.loadClient('matrix-credentials');
        } catch (err) {
            _strongholdClient = await stronghold.createClient('matrix-credentials');
        }
        return _strongholdClient;
    } catch (e) {
        console.warn('[TauriStorage] Stronghold unavailable, falling back to localStorage:', e);
        return null;
    }
}

export default defineNuxtPlugin(async () => {
    // Pre-initialise both on app start so first reads aren't slow
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        await getTauriStore().catch(console.warn);
        await getStrongholdClient().catch(console.warn);
    }
});
