import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { hasStoredSession } from "../src/auth/session.ts";
import { AuthStorage, type AuthStore, type StoredSession } from "../src/auth/storage.ts";

function memoryStore(seed: Record<string, string> = {}): AuthStore {
    const map = new Map(Object.entries(seed));
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => {
            map.set(key, value);
        },
        removeItem: (key) => {
            map.delete(key);
        },
    };
}

const sample: StoredSession = {
    homeserverUrl: "https://matrix.example.org",
    userId: "@alice:matrix.example.org",
    deviceId: "DEVICEID",
    clientId: "client-id",
    accessToken: "token",
};

type Global = { localStorage?: unknown };
const globalWithStorage = globalThis as Global;

describe("hasStoredSession", () => {
    // The helper reads the *global* localStorage — that is the browser path the
    // router guard takes — so these tests install a memory-backed global for the
    // duration and put back whatever was there before.
    const original = globalWithStorage.localStorage;

    afterEach(() => {
        if (original === undefined) delete globalWithStorage.localStorage;
        else globalWithStorage.localStorage = original;
    });

    it("is false when there is no localStorage at all", () => {
        delete globalWithStorage.localStorage;
        assert.equal(hasStoredSession(), false);
    });

    it("tracks save/clear through the shared storage key", () => {
        const store = memoryStore();
        globalWithStorage.localStorage = store;
        const storage = new AuthStorage(store);

        assert.equal(hasStoredSession(), false);
        storage.saveSession(sample);
        assert.equal(hasStoredSession(), true);
        storage.clearSession();
        assert.equal(hasStoredSession(), false);
    });

    it("is false for a corrupt session entry rather than throwing", () => {
        const store = memoryStore({ "tumult.session": "{ not json" });
        globalWithStorage.localStorage = store;
        assert.equal(hasStoredSession(), false);
    });
});
