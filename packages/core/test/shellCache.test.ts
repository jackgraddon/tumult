import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { RoomSummary } from "../src/contract.ts";
import {
    clearShellSnapshot,
    readShellSnapshot,
    SHELL_CACHE_KEY,
    SHELL_CACHE_VERSION,
    writeShellSnapshot,
    type ShellStore,
} from "../src/shellCache.ts";

/** A localStorage-shaped store backed by a Map, with optional fault injection. */
class FakeStore implements ShellStore {
    private readonly map = new Map<string, unknown>();
    public throwOnWrite = false;

    public getItem<T>(key: string): T | null {
        const value = this.map.get(key);
        return value === undefined ? null : (value as T);
    }

    public setItem<T>(key: string, value: T): void {
        if (this.throwOnWrite) throw new Error("write failed (quota)");
        this.map.set(key, value);
    }

    public removeItem(key: string): void {
        this.map.delete(key);
    }
}

const ACCOUNT = { userId: "@alice:matrix.org", homeserverUrl: "https://matrix.org" };

function summary(overrides: Partial<RoomSummary> = {}): RoomSummary {
    return {
        id: "!room:matrix.org",
        name: "General",
        topic: "Talk",
        avatarUrl: "mxc://matrix.org/abc",
        isSpace: false,
        parentSpaceIds: ["!space:matrix.org"],
        unreadCount: 0,
        highlightCount: 0,
        fullyReadEventId: null,
        joinRule: "invite",
        historyVisibility: "shared",
        canonicalAlias: null,
        favourite: false,
        favouriteOrder: null,
        ...overrides,
    };
}

describe("shellCache", () => {
    it("round-trips a written snapshot", () => {
        const store = new FakeStore();
        const rooms = [summary(), summary({ id: "!two:matrix.org", name: "Other" })];
        const ok = writeShellSnapshot(store, ACCOUNT, rooms, "!room:matrix.org");
        assert.equal(ok, true);
        const snap = readShellSnapshot(store, ACCOUNT);
        assert.equal(snap.version, SHELL_CACHE_VERSION);
        assert.equal(snap.userId, ACCOUNT.userId);
        assert.equal(snap.homeserverUrl, ACCOUNT.homeserverUrl);
        assert.equal(snap.lastRoomId, "!room:matrix.org");
        assert.deepEqual(snap.rooms, rooms);
        assert.ok(snap.savedAt > 0, "savedAt is stamped");
    });

    it("reads empty from a store that has no entry", () => {
        const store = new FakeStore();
        const snap = readShellSnapshot(store, ACCOUNT);
        assert.deepEqual(snap.rooms, []);
        assert.equal(snap.lastRoomId, null);
        assert.equal(snap.savedAt, 0);
    });

    it("a wrong version degrades to empty", () => {
        const store = new FakeStore();
        writeShellSnapshot(store, ACCOUNT, [summary()], null);
        const raw = store.getItem<{ version: number; rooms: RoomSummary[] }>(SHELL_CACHE_KEY)!;
        raw.version = 999;
        store.setItem(SHELL_CACHE_KEY, raw);
        assert.deepEqual(readShellSnapshot(store, ACCOUNT).rooms, []);
    });

    it("a different account degrades to empty", () => {
        const store = new FakeStore();
        writeShellSnapshot(store, ACCOUNT, [summary()], null);
        const other = readShellSnapshot(store, { userId: "@bob:matrix.org", homeserverUrl: ACCOUNT.homeserverUrl });
        assert.deepEqual(other.rooms, []);
        // Reading back for the original account still finds it.
        assert.equal(readShellSnapshot(store, ACCOUNT).rooms.length, 1);
    });

    it("a different homeserver degrades to empty", () => {
        const store = new FakeStore();
        writeShellSnapshot(store, ACCOUNT, [summary()], null);
        const other = readShellSnapshot(store, { userId: ACCOUNT.userId, homeserverUrl: "https://other.org" });
        assert.deepEqual(other.rooms, []);
    });

    it("drops half-written summaries but keeps the good ones", () => {
        const store = new FakeStore();
        // Bypass writeShellSnapshot's own sanitiser to simulate a corrupt row:
        // a record missing required fields must be dropped, a valid one kept.
        store.setItem<unknown>(SHELL_CACHE_KEY, {
            version: SHELL_CACHE_VERSION,
            savedAt: 1,
            userId: ACCOUNT.userId,
            homeserverUrl: ACCOUNT.homeserverUrl,
            lastRoomId: null,
            rooms: [{ garbled: true }, summary({ id: "!ok:matrix.org" }), null, 42],
        });
        const snap = readShellSnapshot(store, ACCOUNT);
        assert.equal(snap.rooms.length, 1);
        assert.equal(snap.rooms[0]!.id, "!ok:matrix.org");
    });

    it("a wrong-typed field falls back to its default, not a throw", () => {
        const store = new FakeStore();
        store.setItem<unknown>(SHELL_CACHE_KEY, {
            version: SHELL_CACHE_VERSION,
            savedAt: "not-a-number",
            userId: ACCOUNT.userId,
            homeserverUrl: ACCOUNT.homeserverUrl,
            lastRoomId: 123,
            rooms: [summary({ joinRule: 5, parentSpaceIds: ["!s:matrix.org", 7], favouriteOrder: "x" })],
        });
        const snap = readShellSnapshot(store, ACCOUNT);
        assert.equal(snap.savedAt, 0, "non-finite savedAt -> 0");
        assert.equal(snap.lastRoomId, null, "non-string lastRoomId -> null");
        assert.equal(snap.rooms[0]!.joinRule, "invite", "non-string joinRule -> default");
        assert.deepEqual(snap.rooms[0]!.parentSpaceIds, ["!s:matrix.org"], "non-string dropped from list");
        assert.equal(snap.rooms[0]!.favouriteOrder, null, "non-number order -> null");
    });

    it("a valid string joinRule passes through unchanged", () => {
        const store = new FakeStore();
        writeShellSnapshot(store, ACCOUNT, [summary({ joinRule: "public" })], null);
        const snap = readShellSnapshot(store, ACCOUNT);
        assert.equal(snap.rooms[0]!.joinRule, "public");
    });

    it("clearShellSnapshot removes the entry", () => {
        const store = new FakeStore();
        writeShellSnapshot(store, ACCOUNT, [summary()], null);
        assert.equal(readShellSnapshot(store, ACCOUNT).rooms.length, 1);
        clearShellSnapshot(store);
        assert.deepEqual(readShellSnapshot(store, ACCOUNT).rooms, []);
    });

    it("a failing store never takes down the writer (best-effort)", () => {
        const store = new FakeStore();
        store.throwOnWrite = true;
        // Neither write nor clear throws when the store is broken.
        assert.equal(writeShellSnapshot(store, ACCOUNT, [summary()], null), false);
        clearShellSnapshot(store);
        // A failing read of a broken store degrades to empty rather than throw.
        assert.deepEqual(readShellSnapshot(store, ACCOUNT).rooms, []);
    });
});
