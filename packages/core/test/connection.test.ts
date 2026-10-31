import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SyncState } from "matrix-js-sdk";

import type { ConnectionState } from "../src/contract.ts";
import { Observable } from "../src/observable.ts";
import { toConnectionState, watchNetwork, type NetworkTarget } from "../src/sync/connection.ts";

describe("toConnectionState", () => {
    it("maps every SDK sync state onto the UI's coarser state", () => {
        const expected: Record<SyncState, ConnectionState> = {
            [SyncState.Prepared]: "syncing",
            [SyncState.Syncing]: "syncing",
            [SyncState.Catchup]: "syncing",
            [SyncState.Reconnecting]: "reconnecting",
            [SyncState.Error]: "error",
            [SyncState.Stopped]: "stopped",
        };
        for (const state of Object.values(SyncState)) {
            assert.equal(toConnectionState(state), expected[state], `SyncState.${state}`);
        }
    });

    it("reads no state yet as starting", () => {
        assert.equal(toConnectionState(null), "starting");
    });
});

/** A fake `window` that records its listeners and can fire them. */
function fakeTarget(): NetworkTarget & {
    listeners: Map<string, Set<() => void>>;
    fire(type: string): void;
} {
    const listeners = new Map<string, Set<() => void>>();
    return {
        listeners,
        addEventListener: (type, listener) => {
            const set = listeners.get(type) ?? new Set();
            set.add(listener);
            listeners.set(type, set);
        },
        removeEventListener: (type, listener) => {
            listeners.get(type)?.delete(listener);
        },
        fire: (type) => {
            for (const listener of listeners.get(type) ?? []) listener();
        },
    };
}

function stubClient(): { retryImmediately: () => boolean; retries: number } {
    const client = {
        retries: 0,
        retryImmediately: () => {
            client.retries += 1;
            return true;
        },
    };
    return client;
}

describe("watchNetwork", () => {
    it("flips only a syncing connection to reconnecting when the browser goes offline", () => {
        const target = fakeTarget();
        for (const state of ["starting", "syncing", "reconnecting", "error", "stopped"] as const) {
            const connection = new Observable<ConnectionState>(state);
            const unwatch = watchNetwork(stubClient(), connection, target);
            target.fire("offline");
            assert.equal(connection.get(), state === "syncing" ? "reconnecting" : state, `from ${state}`);
            unwatch?.();
        }
    });

    it("restarts the sync loop at once when the browser comes back online", () => {
        const target = fakeTarget();
        const client = stubClient();
        watchNetwork(client, new Observable<ConnectionState>("reconnecting"), target);
        target.fire("online");
        assert.equal(client.retries, 1);
    });

    it("unwatch removes exactly the two listeners it added", () => {
        const target = fakeTarget();
        const other = (): void => undefined;
        target.addEventListener?.("online", other);
        const unwatch = watchNetwork(stubClient(), new Observable<ConnectionState>("syncing"), target);
        assert.equal(target.listeners.get("online")?.size, 2);
        assert.equal(target.listeners.get("offline")?.size, 1);
        assert.ok(unwatch);
        unwatch();
        assert.deepEqual([...(target.listeners.get("online") ?? [])], [other]);
        assert.equal(target.listeners.get("offline")?.size, 0);
    });

    it("is a no-op outside a browser", () => {
        const connection = new Observable<ConnectionState>("syncing");
        assert.equal(watchNetwork(stubClient(), connection, {}), null);
        assert.equal(connection.get(), "syncing");
    });
});
