import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { UserEvent } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";

import { AuthStorage } from "../src/auth/storage.ts";
import type { ClientContext } from "../src/client-context.ts";
import {
    OWN_PRESENCE_HEARTBEAT_MS,
    OWN_PRESENCE_REFRESH_MS,
    OwnPresenceController,
    PRESENCE_KEY,
} from "../src/rooms/own-presence-controller.ts";

type Presence = { presence: "online" | "offline" | "unavailable"; status_msg?: string };

function context(matrix: () => MatrixClient | null, seed: Record<string, string> = {}): ClientContext & {
    data: Map<string, string>;
} {
    const data = new Map(Object.entries(seed));
    return {
        data,
        storage: new AuthStorage({
            getItem: (key) => data.get(key) ?? null,
            setItem: (key, value) => void data.set(key, value),
            removeItem: (key) => void data.delete(key),
        }),
        matrix,
        session: () => null,
        selectedRoomId: () => null,
    };
}

/** A client whose presence reads come from `server` and whose writes are logged. */
function stubMatrix(server: { current: Presence; read?: () => Promise<Presence> }): MatrixClient & {
    reads: number;
    writes: Array<{ presence: string; status_msg?: string }>;
} {
    const emitter = new EventEmitter();
    const matrix = Object.assign(emitter, {
        reads: 0,
        writes: [] as Array<{ presence: string; status_msg?: string }>,
        getUserId: () => "@alice:example.com",
        getPresence: async () => {
            matrix.reads += 1;
            return server.read ? server.read() : { ...server.current };
        },
        setPresence: async (body: { presence: string; status_msg?: string }) => {
            matrix.writes.push(body);
        },
    });
    return matrix as unknown as MatrixClient & { reads: number; writes: Array<{ presence: string; status_msg?: string }> };
}

/** Emit the client-level re-emit of `m.presence`, as the SDK does: `(event, user)`. */
function presenceFor(matrix: MatrixClient, userId: string): void {
    (matrix as unknown as EventEmitter).emit(UserEvent.Presence, undefined, { userId });
}

describe("OwnPresenceController", () => {
    it("announce re-asserts the chosen presence, keeping the status message", async () => {
        const matrix = stubMatrix({ current: { presence: "offline", status_msg: "Busy" } });
        const ctl = new OwnPresenceController(context(() => matrix, { [PRESENCE_KEY]: JSON.stringify("unavailable") }));
        await ctl.announce();
        assert.deepEqual(matrix.writes, [{ presence: "unavailable", status_msg: "Busy" }]);
        assert.deepEqual(ctl.feed.get(), { presence: "unavailable", statusMessage: "Busy" });
    });

    it("announce defaults the choice to online and writes nothing when the server agrees", async () => {
        const matrix = stubMatrix({ current: { presence: "online" } });
        const ctl = new OwnPresenceController(context(() => matrix));
        await ctl.announce();
        assert.deepEqual(matrix.writes, []);
        assert.deepEqual(ctl.feed.get(), { presence: "online", statusMessage: null });
    });

    it("announce drops its write and its publish when the client changes mid-flight", async () => {
        let live: MatrixClient | null = null;
        let release: (value: Presence) => void = () => undefined;
        const matrix = stubMatrix({
            current: { presence: "offline" },
            read: () => new Promise<Presence>((resolve) => (release = resolve)),
        });
        live = matrix;
        const ctl = new OwnPresenceController(context(() => live));
        const pending = ctl.announce();
        live = null; // stop() ran while the read was in flight
        release({ presence: "offline" });
        await pending;
        assert.deepEqual(matrix.writes, []);
        assert.equal(ctl.feed.get(), null);
    });

    it("set publishes the written value before the follow-up read lands, and remembers the choice", async () => {
        let release: (value: Presence) => void = () => undefined;
        const matrix = stubMatrix({
            current: { presence: "online" },
            read: () => new Promise<Presence>((resolve) => (release = resolve)),
        });
        const ctx = context(() => matrix);
        const ctl = new OwnPresenceController(ctx);
        await ctl.set("unavailable", "  ");
        assert.deepEqual(matrix.writes, [{ presence: "unavailable", status_msg: "  " }]);
        // A blank status reads back as no status, published before the re-read.
        assert.deepEqual(ctl.feed.get(), { presence: "unavailable", statusMessage: null });
        assert.equal(ctx.data.get(PRESENCE_KEY), JSON.stringify("unavailable"));
        release({ presence: "unavailable", status_msg: "Normalised" });
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(ctl.feed.get(), { presence: "unavailable", statusMessage: "Normalised" });
    });

    it("set refuses before start with the contract's message", async () => {
        const ctl = new OwnPresenceController(context(() => null));
        await assert.rejects(ctl.set("online"), /^Error: Cannot set presence before start\(\)$/);
    });

    it("forget removes only the chosen presence", () => {
        const ctx = context(() => null, { [PRESENCE_KEY]: JSON.stringify("offline"), "tumult.other": "1" });
        new OwnPresenceController(ctx).forget();
        assert.deepEqual([...ctx.data.keys()], ["tumult.other"]);
    });

    describe("timers", () => {
        beforeEach(() => mock.timers.enable({ apis: ["setInterval", "setTimeout"] }));
        afterEach(() => mock.timers.reset());

        it("start announces now and on every heartbeat until stop() clears the interval", async () => {
            const matrix = stubMatrix({ current: { presence: "online" } });
            const ctl = new OwnPresenceController(context(() => matrix));
            ctl.start(matrix);
            assert.equal(matrix.reads, 1);
            mock.timers.tick(OWN_PRESENCE_HEARTBEAT_MS);
            assert.equal(matrix.reads, 2);
            ctl.stop();
            ctl.stop();
            mock.timers.tick(OWN_PRESENCE_HEARTBEAT_MS * 3);
            assert.equal(matrix.reads, 2);
        });

        it("coalesces our own m.presence burst into one read and ignores other users", () => {
            const matrix = stubMatrix({ current: { presence: "online" } });
            const ctl = new OwnPresenceController(context(() => matrix));
            ctl.start(matrix);
            const startReads = matrix.reads;
            for (let i = 0; i < 5; i++) presenceFor(matrix, "@alice:example.com");
            presenceFor(matrix, "@bob:example.com");
            mock.timers.tick(OWN_PRESENCE_REFRESH_MS);
            assert.equal(matrix.reads, startReads + 1);

            // stop() drops a pending re-read.
            presenceFor(matrix, "@alice:example.com");
            ctl.stop();
            mock.timers.tick(OWN_PRESENCE_REFRESH_MS);
            assert.equal(matrix.reads, startReads + 1);
        });
    });
});
