import { getTauriStore, getStrongholdClient } from '~/plugins/tauri-storage.client';

const isTauri = () => !!(window as any).__TAURI_INTERNALS__;

// --- Non-sensitive preferences (Tauri Store / localStorage) ---

export async function setPref(key: string, value: any): Promise<void> {
    if (isTauri()) {
        const store = await getTauriStore();
        await store.set(key, value);
    } else {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
}

export async function getPref<T>(key: string, fallback: T): Promise<T> {
    if (isTauri()) {
        const store = await getTauriStore();
        const val = await store.get<T>(key);
        return val ?? fallback;
    } else {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
    }
}

export async function deletePref(key: string): Promise<void> {
    if (isTauri()) {
        const store = await getTauriStore();
        await store.delete(key);
    } else {
        localStorage.removeItem(key);
    }
}

// --- Sensitive credentials (Stronghold / localStorage) ---

export async function setSecret(key: string, value: string): Promise<void> {
    if (isTauri()) {
        const client = await getStrongholdClient();
        if (client) {
            const store = client.getStore();
            await store.insert(key, Array.from(new TextEncoder().encode(value)));
            return;
        }
    }
    // Web fallback (sessionStorage is slightly safer than localStorage for tokens)
    localStorage.setItem(key, value);
}

export async function getSecret(key: string): Promise<string | null> {
    if (isTauri()) {
        const client = await getStrongholdClient();
        if (client) {
            try {
                const store = client.getStore();
                const bytes = await store.get(key);
                if (bytes) return new TextDecoder().decode(new Uint8Array(bytes));
            } catch {
                return null;
            }
        }
    }
    return localStorage.getItem(key);
}

export async function deleteSecret(key: string): Promise<void> {
    if (isTauri()) {
        const client = await getStrongholdClient();
        if (client) {
            try {
                const store = client.getStore();
                await store.remove(key);
                return;
            } catch { /* key didn't exist */ }
        }
    }
    localStorage.removeItem(key);
}