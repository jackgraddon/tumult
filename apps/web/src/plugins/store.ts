/**
 * Persistence for installed third-party plugins — one IndexedDB store, owned
 * by the app.
 *
 * `@tumult/ui`'s `PluginRegistry` is in-memory and per shell (by design: two
 * shells must not share install state). Surviving a reload is app business, so
 * the record lives here. Each record is everything needed to re-install without
 * the network: the manifest, where it came from, the lane, the bundle text and
 * its hash. Boot re-hashes the stored bundle before loading it (see
 * `installer.ts`), so a hand-edited store fails closed rather than running.
 *
 * A separate database from the Matrix sync/crypto store on purpose: those are
 * the SDK's, and losing or clearing a plugin install must never touch them.
 */

import type { PluginLane, PluginManifest } from "@tumult/ui";

const DB_NAME = "tumult.plugins";
const DB_VERSION = 1;
const STORE = "installs";

/** One installed plugin, as persisted. */
export interface InstallRecord {
    /** `manifest.id` — the store's key. */
    id: string;
    /** The repository it came from, as `owner/repo`. */
    source: string;
    /** The release tag (or ref) it came from; `""` for a raw-file install. */
    tag: string;
    manifest: PluginManifest;
    /** Derived at install time by the host, stored so the UI can label it offline. */
    lane: PluginLane;
    /** The bundle source text, exactly as hashed. */
    bundle: string;
    /** `sha256-<base64>` of `bundle` — re-checked on every boot. */
    integrity: string;
    /** Disabled installs keep their record but are not loaded. */
    enabled: boolean;
    /** Milliseconds since the epoch. */
    installedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * Coerce one stored value into an `InstallRecord`, or `null` when it is not
 * usable. A store entry written by a future (or corrupted) version must be
 * dropped, not crash the boot — the caller skips `null`s.
 */
export function parseInstallRecord(value: unknown): InstallRecord | null {
    if (!isRecord(value)) return null;
    const { id, source, tag, manifest, lane, bundle, integrity, enabled, installedAt } = value;
    if (typeof id !== "string" || id === "") return null;
    if (typeof source !== "string" || typeof tag !== "string") return null;
    if (typeof bundle !== "string" || typeof integrity !== "string") return null;
    if (lane !== "sandbox" && lane !== "trusted") return null;
    if (!isRecord(manifest) || typeof manifest["id"] !== "string") return null;
    return {
        id,
        source,
        tag,
        manifest: manifest as unknown as PluginManifest,
        lane,
        bundle,
        integrity,
        enabled: enabled !== false,
        installedAt: typeof installedAt === "number" ? installedAt : 0,
    };
}

/** Open (and, on first use, create) the store. */
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("could not open the plugin store"));
    });
}

/** Run one transaction and resolve when it commits. */
function transact<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | undefined> {
    return openDatabase().then(
        (db) =>
            new Promise<T | undefined>((resolve, reject) => {
                const transaction = db.transaction(STORE, mode);
                const request = run(transaction.objectStore(STORE));
                transaction.oncomplete = () => {
                    db.close();
                    resolve(request ? (request.result as T) : undefined);
                };
                transaction.onerror = () => {
                    db.close();
                    reject(transaction.error ?? new Error("plugin store transaction failed"));
                };
                transaction.onabort = () => {
                    db.close();
                    reject(transaction.error ?? new Error("plugin store transaction aborted"));
                };
            }),
    );
}

/** Every stored install, unusable entries skipped, newest first. */
export async function listInstalls(): Promise<InstallRecord[]> {
    const all = await transact<unknown[]>("readonly", (store) => store.getAll());
    const records = (all ?? []).map(parseInstallRecord).filter((record) => record !== null);
    return records.sort((a, b) => b.installedAt - a.installedAt);
}

/** Write (or overwrite) one install. */
export async function putInstall(record: InstallRecord): Promise<void> {
    await transact("readwrite", (store) => store.put(record));
}

/** Drop one install by id. Resolves whether or not it existed. */
export async function deleteInstall(id: string): Promise<void> {
    await transact("readwrite", (store) => store.delete(id));
}

/**
 * Flip the enabled flag without touching the bundle — disabling keeps the
 * record (and the consented hash) so re-enabling never re-downloads.
 */
export async function setInstallEnabled(id: string, enabled: boolean): Promise<void> {
    const all = await listInstalls();
    const record = all.find((entry) => entry.id === id);
    if (!record) return;
    await putInstall({ ...record, enabled });
}
