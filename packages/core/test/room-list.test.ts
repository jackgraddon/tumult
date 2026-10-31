import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { AuthStorage } from "../src/auth/storage.ts";
import type { StoredSession } from "../src/auth/storage.ts";
import type { ClientContext } from "../src/client-context.ts";
import { snapshotRooms } from "../src/rooms/snapshot.ts";
import { PROGRESSIVE_REFRESH_MS, RoomListPublisher, shellSignature } from "../src/rooms/room-list.ts";
import { SHELL_CACHE_DEBOUNCE_MS, readShellSnapshot, writeShellSnapshot } from "../src/shellCache.ts";

const SESSION: StoredSession = {
    userId: "@alice:example.com",
    deviceId: "DEV",
    homeserverUrl: "https://hs.example.com",
    accessToken: "t",
    clientId: "c",
};
const ACCOUNT = { userId: SESSION.userId, homeserverUrl: SESSION.homeserverUrl };

/** Just enough of a joined Room for snapshotRooms. */
function stubRoom(roomId: string, name = roomId): Record<string, unknown> {
    return {
        roomId,
        name,
        getMyMembership: () => "join",
        isSpaceRoom: () => false,
        currentState: { getStateEvents: (type: string) => (type === "m.space.child" ? [] : null) },
        getMxcAvatarUrl: () => null,
        getUnreadNotificationCount: () => 0,
        getAccountData: () => undefined,
    };
}

/** A client whose joined rooms are `ids`, counting snapshot passes. */
function stubClient(ids: () => string[]): MatrixClient & { passes: number } {
    const client = {
        passes: 0,
        getRooms: () => {
            client.passes += 1;
            return ids().map((id) => stubRoom(id));
        },
        mxcUrlToHttp: () => null,
    };
    return client as unknown as MatrixClient & { passes: number };
}

function harness(options: { matrix?: MatrixClient | null; selected?: string | null; session?: StoredSession | null } = {}): {
    ctx: ClientContext;
    storage: AuthStorage;
    writes: () => number;
    state: { matrix: MatrixClient | null; selected: string | null; session: StoredSession | null };
} {
    const data = new Map<string, string>();
    let writes = 0;
    const storage = new AuthStorage({
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            writes += 1;
            data.set(key, value);
        },
        removeItem: (key) => void data.delete(key),
    });
    const state = {
        matrix: options.matrix ?? null,
        selected: options.selected ?? null,
        session: options.session === undefined ? SESSION : options.session,
    };
    return {
        storage,
        writes: () => writes,
        state,
        ctx: {
            storage,
            matrix: () => state.matrix,
            session: () => state.session,
            selectedRoomId: () => state.selected,
        },
    };
}

const microtask = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe("RoomListPublisher", () => {
    it("coalesces any number of schedule() calls into one refresh per microtask", async () => {
        const matrix = stubClient(() => ["!a:x", "!b:x"]);
        const list = new RoomListPublisher(harness({ matrix }).ctx);
        for (let i = 0; i < 10; i++) list.schedule();
        assert.equal(matrix.passes, 0);
        await microtask();
        assert.equal(matrix.passes, 1);
        assert.deepEqual(
            list.feed.get().map((r) => r.id),
            ["!a:x", "!b:x"],
        );
        list.schedule();
        await microtask();
        assert.equal(matrix.passes, 2);
    });

    it("a microtask refresh cancels a pending progressive one", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const matrix = stubClient(() => ["!a:x"]);
        const list = new RoomListPublisher(harness({ matrix }).ctx);
        list.scheduleProgressive();
        list.scheduleProgressive();
        list.schedule();
        await microtask();
        assert.equal(matrix.passes, 1);
        t.mock.timers.tick(PROGRESSIVE_REFRESH_MS);
        assert.equal(matrix.passes, 1);
    });

    it("seeds from the shell cache and returns the room the cache last had open", () => {
        const { ctx, storage } = harness();
        const seeded = snapshotRooms(stubClient(() => ["!a:x", "!b:x"]));
        writeShellSnapshot(storage, ACCOUNT, seeded, "!b:x");
        const list = new RoomListPublisher(ctx);
        assert.equal(list.seed(SESSION), "!b:x");
        assert.deepEqual(list.feed.get(), seeded);
    });

    it("an empty or other account's cache seeds nothing", () => {
        const { ctx, storage } = harness();
        writeShellSnapshot(storage, { ...ACCOUNT, userId: "@bob:example.com" }, snapshotRooms(stubClient(() => ["!a:x"])), "!a:x");
        const list = new RoomListPublisher(ctx);
        assert.equal(list.seed(SESSION), null);
        assert.deepEqual(list.feed.get(), []);
    });

    it("a partial batch under a warm seed cannot shrink the list; the first 'syncing' drops the seed", async () => {
        let live = ["!a:x"];
        const matrix = stubClient(() => live);
        const { ctx, storage } = harness({ matrix });
        writeShellSnapshot(storage, ACCOUNT, snapshotRooms(stubClient(() => ["!a:x", "!b:x", "!c:x"])), null);
        const list = new RoomListPublisher(ctx);
        list.seed(SESSION);

        // A non-syncing state (e.g. still starting) keeps the seed.
        list.onSync("starting");
        await microtask();
        assert.deepEqual(
            list.feed.get().map((r) => r.id).sort(),
            ["!a:x", "!b:x", "!c:x"],
        );

        // The first usable batch is authoritative.
        live = ["!a:x", "!d:x"];
        list.onSync("syncing");
        await microtask();
        assert.deepEqual(
            list.feed.get().map((r) => r.id),
            ["!a:x", "!d:x"],
        );
    });

    it("flush writes once per structural signature, with the live selection", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let live = ["!a:x"];
        const matrix = stubClient(() => live);
        const h = harness({ matrix, selected: "!a:x" });
        const list = new RoomListPublisher(h.ctx);
        list.refresh();
        assert.equal(h.writes(), 0, "the cache write is debounced");
        t.mock.timers.tick(SHELL_CACHE_DEBOUNCE_MS);
        assert.equal(h.writes(), 1);
        assert.equal(readShellSnapshot(h.storage, ACCOUNT).lastRoomId, "!a:x");

        // Same structure: no write, however often it flushes.
        list.flush();
        list.flush();
        assert.equal(h.writes(), 1);

        live = ["!a:x", "!b:x"];
        h.state.selected = "!b:x";
        list.refresh();
        list.flush();
        assert.equal(h.writes(), 2);
        const cached = readShellSnapshot(h.storage, ACCOUNT);
        assert.equal(cached.lastRoomId, "!b:x");
        assert.equal(shellSignature(cached.rooms), shellSignature(list.feed.get()));
    });

    it("flush writes nothing without a session", () => {
        const h = harness({ matrix: stubClient(() => ["!a:x"]), session: null });
        const list = new RoomListPublisher(h.ctx);
        list.refresh();
        list.flush();
        assert.equal(h.writes(), 0);
    });

    it("detach clears queued, progressive and seeded state; clearPersist cancels the debounced write", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const matrix = stubClient(() => ["!a:x"]);
        const h = harness({ matrix });
        writeShellSnapshot(h.storage, ACCOUNT, snapshotRooms(stubClient(() => ["!a:x", "!b:x"])), null);
        const list = new RoomListPublisher(h.ctx);
        list.seed(SESSION);
        const writesAfterSeed = h.writes();

        list.scheduleProgressive();
        list.detach();
        list.detach();
        t.mock.timers.tick(PROGRESSIVE_REFRESH_MS);
        assert.equal(matrix.passes, 0, "the progressive refresh was cleared");

        // The seed is gone: a refresh now publishes only the live rooms.
        list.refresh();
        assert.deepEqual(
            list.feed.get().map((r) => r.id),
            ["!a:x"],
        );
        list.clearPersist();
        t.mock.timers.tick(SHELL_CACHE_DEBOUNCE_MS);
        assert.equal(h.writes(), writesAfterSeed);
    });

    it("does nothing without a client, and debugUnread answers []", async () => {
        const list = new RoomListPublisher(harness().ctx);
        list.schedule();
        await microtask();
        assert.deepEqual(list.feed.get(), []);
        assert.deepEqual(list.debugUnread(true), []);
    });
});
