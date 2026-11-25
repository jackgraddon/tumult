import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk";

import { AuthStorage, type StoredSession } from "../src/auth/storage.ts";
import type { ClientContext } from "../src/client-context.ts";
import { OWN_ACTIVITY_KEY, OwnActivityController, parseOwnActivity } from "../src/activity/own-activity-controller.ts";

function context(deviceId = "DEV-A"): ClientContext {
    const data = new Map<string, string>();
    return {
        storage: new AuthStorage({
            getItem: (key) => data.get(key) ?? null,
            setItem: (key, value) => void data.set(key, value),
            removeItem: (key) => void data.delete(key),
        }),
        matrix: () => null,
        session: () => ({ deviceId }) as StoredSession,
        selectedRoomId: () => null,
    };
}

function stub(initial?: unknown): {
    matrix: MatrixClient;
    writes: Array<{ type: string; content: Record<string, unknown> }>;
    emit(type: string, content: unknown): void;
} {
    const emitter = new EventEmitter();
    const stored = new Map<string, unknown>();
    const writes: Array<{ type: string; content: Record<string, unknown> }> = [];
    if (initial !== undefined) stored.set(OWN_ACTIVITY_KEY, initial);
    const matrix = Object.assign(emitter, {
        getAccountData: (type: string) =>
            stored.has(type) ? { getContent: () => stored.get(type) } : undefined,
        setAccountDataRaw: async (type: string, content: Record<string, unknown>) => {
            writes.push({ type, content });
            stored.set(type, content);
            return {};
        },
    });
    return {
        matrix: matrix as unknown as MatrixClient,
        writes,
        emit: (type, content) => {
            const event = { getType: () => type, getContent: () => content } as unknown as MatrixEvent;
            emitter.emit(ClientEvent.AccountData, event);
        },
    };
}

function withMatrix(matrix: MatrixClient): ClientContext {
    const base = context();
    return { ...base, matrix: () => matrix };
}

describe("parseOwnActivity", () => {
    it("accepts a bounded envelope with a document or an explicit clear", () => {
        assert.deepEqual(parseOwnActivity({ v: 1, document: { v: 1, type: "custom", name: "Focus" }, updatedAt: 12, deviceId: "D" }), {
            document: { v: 1, type: "custom", name: "Focus" },
            updatedAt: 12,
            deviceId: "D",
        });
        assert.deepEqual(parseOwnActivity({ v: 1, document: null, updatedAt: 0, deviceId: "D" }), {
            document: null,
            updatedAt: 0,
            deviceId: "D",
        });
    });

    it("refuses malformed envelopes instead of rendering arbitrary account data", () => {
        assert.equal(parseOwnActivity(null), null);
        assert.equal(parseOwnActivity({ v: 2, document: null, updatedAt: 1, deviceId: "D" }), null);
        assert.equal(parseOwnActivity({ v: 1, document: null, updatedAt: -1, deviceId: "D" }), null);
        assert.equal(parseOwnActivity({ v: 1, document: null, updatedAt: 1, deviceId: "" }), null);
        assert.equal(parseOwnActivity({ v: 1, document: [], updatedAt: 1, deviceId: "D" }), null);
        assert.equal(parseOwnActivity({ v: 1, document: { blob: "x".repeat(20_000) }, updatedAt: 1, deviceId: "D" }), null);
    });
});

describe("OwnActivityController", () => {
    const document = { v: 1, type: "listening", name: "Album" };

    it("seeds the feed from cached account data on start", () => {
        const initial = { v: 1, document, updatedAt: 42, deviceId: "DEV-B" };
        const { matrix } = stub(initial);
        const ctl = new OwnActivityController(withMatrix(matrix));
        ctl.start(matrix);
        assert.deepEqual(ctl.feed.get(), { document, updatedAt: 42, deviceId: "DEV-B" });
        ctl.stop();
    });

    it("publishes a local write immediately and writes a complete envelope", async () => {
        const { matrix, writes } = stub();
        const ctl = new OwnActivityController(withMatrix(matrix));
        ctl.start(matrix);
        await ctl.set(document);
        assert.equal(writes.length, 1);
        assert.equal(writes[0]!.type, OWN_ACTIVITY_KEY);
        assert.equal(writes[0]!.content["v"], 1);
        assert.equal(writes[0]!.content["deviceId"], "DEV-A");
        assert.deepEqual(writes[0]!.content["document"], document);
        assert.deepEqual(ctl.feed.get()?.document, document);
        ctl.stop();
    });

    it("follows another device's account-data event but ignores other keys", () => {
        const { matrix, emit } = stub();
        const ctl = new OwnActivityController(withMatrix(matrix));
        ctl.start(matrix);
        emit("m.direct", { "@bob:example.com": [] });
        assert.equal(ctl.feed.get(), null, "an unrelated account-data event is not activity");

        emit(OWN_ACTIVITY_KEY, { v: 1, document: null, updatedAt: 99, deviceId: "DEV-B" });
        assert.deepEqual(ctl.feed.get(), { document: null, updatedAt: 99, deviceId: "DEV-B" });

        emit(OWN_ACTIVITY_KEY, { v: 1, document: "junk", updatedAt: 100, deviceId: "DEV-B" });
        assert.equal(ctl.feed.get(), null, "a malformed envelope clears rather than rendering junk");
        ctl.stop();
    });

    it("detaches its sync listener on stop", () => {
        const { matrix, emit } = stub();
        const ctl = new OwnActivityController(withMatrix(matrix));
        ctl.start(matrix);
        ctl.stop();
        assert.equal(ctl.feed.get(), null);
        emit(OWN_ACTIVITY_KEY, { v: 1, document, updatedAt: 1, deviceId: "DEV-B" });
        assert.equal(ctl.feed.get(), null);
    });

    it("refuses a write before start", async () => {
        const ctl = new OwnActivityController(context());
        await assert.rejects(ctl.set(document), /Cannot set activity before start/);
    });
});
