import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";
import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api/verification";

import { VerificationManager, toRequestView } from "../src/verification/manager.ts";

function stubRequest(over: Record<string, unknown> = {}): VerificationRequest {
    return {
        transactionId: "$txn:localhost",
        initiatedByMe: true,
        otherUserId: "@bob:localhost",
        otherDeviceId: "BOBDEVICE",
        isSelfVerification: true,
        phase: 4,
        verifier: null,
        ...over,
    } as unknown as VerificationRequest;
}

describe("toRequestView", () => {
    it("maps phases and identities", () => {
        const v = toRequestView(stubRequest({ phase: 2, initiatedByMe: false }));
        assert.equal(v.phase, "requested");
        assert.equal(v.initiatedByMe, false);
        assert.equal(v.otherUserId, "@bob:localhost");
        assert.equal(v.otherDeviceId, "BOBDEVICE");
        assert.equal(v.isSelfVerification, true);
        assert.equal(v.id, "$txn:localhost");
        assert.equal(v.sasEmoji, null);
        assert.equal(v.sasDecimal, null);
    });

    it("covers every phase", () => {
        const expected = ["unsent", "requested", "ready", "started", "cancelled", "done"] as const;
        for (let i = 0; i < expected.length; i++) {
            assert.equal(toRequestView(stubRequest({ phase: i + 1 })).phase, expected[i]);
        }
    });

    it("extracts SAS emoji and decimal from the verifier", () => {
        const emoji: [string, string][] = [["🔑", "key"]];
        const v = toRequestView(
            stubRequest({
                verifier: { getShowSasCallbacks: () => ({ sas: { emoji, decimal: [1, 2, 3] } }) },
            }),
        );
        assert.deepEqual(v.sasEmoji, emoji);
        assert.deepEqual(v.sasDecimal, [1, 2, 3]);
    });

    it("falls back to generated ids and null SAS", () => {
        const v = toRequestView(stubRequest({ transactionId: undefined, verifier: undefined }));
        assert.ok(v.id.startsWith("req-"));
        assert.equal(v.sasEmoji, null);
    });
});

// Phases mirror VerificationPhase: 2 Requested, 3 Ready, 5 Cancelled.
function emitterRequest(over: Record<string, unknown> = {}): {
    request: VerificationRequest;
    calls: string[];
    emitChange: () => void;
    setPhase: (phase: number) => void;
    emitSas: (sas: { emoji: [string, string][]; decimal: [number, number, number] }) => void;
} {
    const calls: string[] = [];
    const listeners = new Set<() => void>();
    const verifierListeners = new Set<(event: any, data: any) => void>();
    let phase = 2;
    let currentSas: any = null;
    const verifier = {
        verify: async () => undefined,
        getShowSasCallbacks: () => ({
            sas: currentSas,
            confirm: async () => { calls.push("confirm"); },
            mismatch: () => { calls.push("mismatch"); },
        }),
        on: (_event: unknown, listener: (event: any, data: any) => void) => verifierListeners.add(listener),
        removeListener: (_event: unknown, listener: (event: any, data: any) => void) => verifierListeners.delete(listener),
    };
    const request = {
        transactionId: "$txn:localhost",
        initiatedByMe: true,
        otherUserId: "@bob:localhost",
        otherDeviceId: "BOBDEVICE",
        isSelfVerification: true,
        get phase() {
            return phase;
        },
        get verifier() {
            return phase === 4 ? verifier : null;
        },
        on: (_event: unknown, listener: () => void) => listeners.add(listener),
        removeListener: (_event: unknown, listener: () => void) => listeners.delete(listener),
        accept: async () => {
            calls.push("accept");
        },
        startVerification: async (method: string) => {
            calls.push(`start:${method}`);
            phase = 4;
            // Simulate SDK emitting Change event after starting
            setTimeout(() => {
                for (const l of [...listeners]) l();
            }, 0);
            return verifier;
        },
        ...over,
    } as unknown as VerificationRequest;
    return {
        request,
        calls,
        emitChange: () => {
            for (const l of [...listeners]) l();
        },
        setPhase: (p: number) => {
            phase = p;
        },
        emitSas: (sas) => {
            currentSas = sas;
            for (const l of [...verifierListeners]) l("show_sas", sas);
        },
    };
}

describe("VerificationManager ready gating", () => {
    it("waits for the receiver's ready before starting SAS", async () => {
        const stub = emitterRequest();
        const matrix = {
            on: () => undefined,
            removeListener: () => undefined,
            getDevices: async () => ({ devices: [] }),
        } as unknown as MatrixClient;
        const crypto = {
            requestOwnUserVerification: async () => stub.request,
        } as unknown as CryptoApi;
        const manager = new VerificationManager(matrix, crypto);

        const pending = manager.startVerification();
        // Give the event loop a beat: SAS must NOT start while Requested.
        await new Promise((r) => setTimeout(r, 20));
        assert.deepEqual(stub.calls, []);

        stub.setPhase(3);
        stub.emitChange();
        await pending;
        assert.deepEqual(stub.calls, ["start:m.sas.v1"]);
        manager.detachAll();
    });

    it("rejects when the request is cancelled while waiting", async () => {
        const stub = emitterRequest();
        const matrix = {
            on: () => undefined,
            removeListener: () => undefined,
            getDevices: async () => ({ devices: [] }),
        } as unknown as MatrixClient;
        const crypto = {
            requestOwnUserVerification: async () => stub.request,
        } as unknown as CryptoApi;
        const manager = new VerificationManager(matrix, crypto);

        const pending = manager.startVerification();
        await new Promise((r) => setTimeout(r, 10));
        stub.setPhase(5);
        stub.emitChange();
        await assert.rejects(pending, /cancelled/i);
        manager.detachAll();
    });

    it("accepts only while Requested, then starts SAS", async () => {
        const mk = (phase: number): { manager: VerificationManager; stub: ReturnType<typeof emitterRequest> } => {
            const stub = emitterRequest();
            stub.setPhase(phase);
            const matrix = {
                on: () => undefined,
                removeListener: () => undefined,
                getDevices: async () => ({ devices: [] }),
            } as unknown as MatrixClient;
            const crypto = {} as unknown as CryptoApi;
            const manager = new VerificationManager(matrix, crypto);
            // Reach in: track the stub request directly.
            (manager as unknown as { track: (r: VerificationRequest) => void }).track(stub.request);
            return { manager, stub };
        };

        const incoming = mk(2);
        await incoming.manager.acceptVerification("$txn:localhost");
        assert.deepEqual(incoming.stub.calls, ["accept", "start:m.sas.v1"]);
        incoming.manager.detachAll();

        const alreadyReady = mk(3);
        await alreadyReady.manager.acceptVerification("$txn:localhost");
        assert.deepEqual(alreadyReady.stub.calls, ["start:m.sas.v1"]);
        alreadyReady.manager.detachAll();
    });
});

describe("VerificationManager publishing", () => {
    it("publishes snapshots on track and on update", async () => {
        const stub = emitterRequest();
        stub.setPhase(3);
        const matrix = {
            on: () => undefined,
            removeListener: () => undefined,
            getDevices: async () => ({ devices: [] }),
        } as unknown as MatrixClient;
        const crypto = {
            requestOwnUserVerification: async () => stub.request,
        } as unknown as CryptoApi;
        const manager = new VerificationManager(matrix, crypto);

        const seen: string[][] = [];
        manager.setOnUpdate(() => {
            seen.push(manager.state.requests.map((r) => r.phase));
        });

        await manager.startVerification();
        assert.ok(seen.length > 0, "onUpdate fires while tracking");
        assert.deepEqual(seen[seen.length - 1], ["ready"]);

        stub.setPhase(4);
        stub.emitChange();
        assert.deepEqual(seen[seen.length - 1], ["started"]);
        manager.detachAll();
    });

    it("captures SAS emojis when verifier emits ShowSas", async () => {
        const stub = emitterRequest();
        const matrix = {
            on: () => undefined,
            removeListener: () => undefined,
            getDevices: async () => ({ devices: [] }),
        } as unknown as MatrixClient;
        const crypto = {
            requestOwnUserVerification: async () => stub.request,
        } as unknown as CryptoApi;
        const manager = new VerificationManager(matrix, crypto);

        const sasData = { emoji: [["🔑", "key"]], decimal: [1, 2, 3] };

        // Transition to started to create the verifier and bind listeners
        stub.setPhase(3);
        await manager.startVerification();

        // Give the SDK's Change event a beat to fire and trigger updateView()
        await new Promise((r) => setTimeout(r, 20));

        // The verifier is now active. Emit the SAS event.
        stub.emitSas(sasData);

        const state = manager.state;
        assert.equal(state.requests.length, 1);
        assert.deepEqual(state.requests[0].sasEmoji, sasData.emoji);
        assert.deepEqual(state.requests[0].sasDecimal, sasData.decimal);
        manager.detachAll();
    });
});
