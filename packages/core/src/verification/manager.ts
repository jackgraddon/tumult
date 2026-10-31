import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import { describeError } from "../errors.ts";
import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";
import type { MatrixClient } from "matrix-js-sdk";
import { VerificationRequestEvent, VerificationPhase } from "matrix-js-sdk/lib/crypto-api/verification.js";
import type { Verifier } from "matrix-js-sdk/lib/crypto-api/verification";
import { VerifierEvent } from "matrix-js-sdk/lib/crypto-api/verification.js";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api/verification";

import type { VerificationRequestView, VerificationState } from "../contract.ts";

interface TrackedRequest {
    request: VerificationRequest;
    view: VerificationRequestView;
    onChange: () => void;
    onVerifierChange: () => void;
    onShowSasEvent: (sas: { sas: { emoji?: [string, string][]; decimal?: [number, number, number] } }) => void;
    onCancel: () => void;
    /** Verifier the listeners are bound to, so a new one is bound exactly once. */
    boundVerifier: Verifier | null;
}

function phaseToView(phase: VerificationPhase): VerificationRequestView["phase"] {
    switch (phase) {
        case VerificationPhase.Requested:
            return "requested";
        case VerificationPhase.Ready:
            return "ready";
        case VerificationPhase.Started:
            return "started";
        case VerificationPhase.Cancelled:
            return "cancelled";
        case VerificationPhase.Done:
            return "done";
        default:
            return "unsent";
    }
}

/** Map one SDK request onto a contract snapshot. Pure; stub-testable. */
export function toRequestView(request: VerificationRequest): VerificationRequestView {
    const verifier = request.verifier;
    let sasEmoji: [string, string][] | null = null;
    let sasDecimal: [number, number, number] | null = null;
    if (verifier) {
        const callbacks = verifier.getShowSasCallbacks();
        if (callbacks && callbacks.sas) {
            sasEmoji = callbacks.sas.emoji ?? null;
            sasDecimal = callbacks.sas.decimal ?? null;
        }
    }
    return {
        id: request.transactionId ?? `req-${Date.now()}`,
        initiatedByMe: request.initiatedByMe,
        otherUserId: request.otherUserId,
        otherDeviceId: request.otherDeviceId,
        isSelfVerification: request.isSelfVerification,
        phase: phaseToView(request.phase),
        sasEmoji,
        sasDecimal,
    };
}

/**
 * Tracks active SAS verification requests over one `MatrixClient`.
 *
 * Wraps SDK `VerificationRequest` / `Verifier` event emitters into a plain
 * `VerificationState` snapshot. The UI subscribes to the feed and calls
 * contract methods to interact; no SDK types leak.
 */
export class VerificationManager {
    private readonly requests = new Map<string, TrackedRequest>();
    private readonly matrix: MatrixClient;
    private readonly crypto: CryptoApi;
    private readonly onIncoming: (request: VerificationRequest) => void;
    private onUpdate: () => void = () => undefined;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient, crypto: CryptoApi) {
        this.matrix = matrix;
        this.crypto = crypto;
        this.onIncoming = (request: VerificationRequest) => {
            console.debug(
                `[tumult] verification incoming: from=${request.otherUserId} device=${request.otherDeviceId} self=${request.isSelfVerification}`,
            );
            this.track(request);
        };
        this.matrix.on(CryptoEvent.VerificationRequestReceived, this.onIncoming);
    }

    public get state(): VerificationState {
        return { requests: [...this.requests.values()].map((t) => t.view) };
    }

    /**
     * Called after every track/update so the owner can publish `state` into
     * its own feed. Without this the manager tracks fine internally while
     * subscribers stare at the initial empty snapshot forever.
     */
    public setOnUpdate(fn: () => void): void {
        this.onUpdate = fn;
    }

    public async startVerification(): Promise<void> {
        // Ensure device list is populated so the SDK can find the target
        // device once the other side accepts (cold device caches are the
        // usual "other device is unknown").
        await this.matrix.getDevices().catch(() => undefined);
        const request = await this.crypto.requestOwnUserVerification();
        this.track(request);
        // Protocol order: request → receiver sends ready → either side sends
        // start. requestOwnUserVerification broadcasts to ALL own devices, so
        // no specific other device exists yet — starting SAS now throws
        // "other device is unknown" even though the prompt was delivered.
        // Wait for the receiver's ready, which also identifies the device.
        await this.waitForReady(request);
        // Do NOT call request.accept() here: only the receiver sends ready.
        // (That was the original phase-2 double-accept.)
        const verifier = await this.beginSas(request);
        void verifier.verify().catch(() => undefined);
    }

    public async acceptVerification(id: string): Promise<void> {
        const tracked = this.requests.get(id);
        if (!tracked) throw new Error("Verification request not found.");
        await this.matrix.getDevices().catch(() => undefined);
        // Receiver side: send ready first, but only while still Requested —
        // re-accepting a Ready request throws "Cannot accept in phase 3".
        if (tracked.request.phase === VerificationPhase.Requested) {
            try {
                await tracked.request.accept();
            } catch (cause) {
                // Lost a race with the other side (already Ready) — proceed;
                // beginSas below fails loudly if truly unusable.
                console.debug("[tumult] verification accept raced", cause);
            }
        }
        const verifier = await this.beginSas(tracked.request);
        void verifier.verify().catch(() => undefined);
    }

    public async declineVerification(id: string): Promise<void> {
        const tracked = this.requests.get(id);
        if (!tracked) throw new Error("Verification request not found.");
        await tracked.request.cancel();
    }

    public async confirmSas(id: string): Promise<void> {
        const tracked = this.requests.get(id);
        if (!tracked) throw new Error("Verification request not found.");
        const callbacks = tracked.request.verifier?.getShowSasCallbacks();
        if (!callbacks) throw new Error("No SAS data to confirm.");
        await callbacks.confirm();
    }

    public async mismatchSas(id: string): Promise<void> {
        const tracked = this.requests.get(id);
        if (!tracked) throw new Error("Verification request not found.");
        const callbacks = tracked.request.verifier?.getShowSasCallbacks();
        if (!callbacks) throw new Error("No SAS data to report.");
        callbacks.mismatch();
    }

    /**
     * Resolve once the other side has accepted (phase Ready or beyond).
     * Rejects when the request is cancelled or the other side never answers.
     */
    private waitForReady(request: VerificationRequest, timeoutMs = 120_000): Promise<void> {
        const readyPhase = request.phase;
        if (
            readyPhase === VerificationPhase.Ready ||
            readyPhase === VerificationPhase.Started ||
            readyPhase === VerificationPhase.Done
        ) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const cleanup = (): void => {
                clearTimeout(timer);
                request.removeListener(VerificationRequestEvent.Change, onChange);
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(
                    new Error(
                        "Timed out waiting for the other device to accept. Ask them to accept the prompt, then try again.",
                    ),
                );
            }, timeoutMs);
            const onChange = (): void => {
                const phase = request.phase;
                console.debug(`[tumult] verification wait: phase=${phase}`);
                if (
                    phase === VerificationPhase.Ready ||
                    phase === VerificationPhase.Started ||
                    phase === VerificationPhase.Done
                ) {
                    cleanup();
                    resolve();
                } else if (phase === VerificationPhase.Cancelled) {
                    cleanup();
                    reject(new Error("Verification was cancelled."));
                }
            };
            request.on(VerificationRequestEvent.Change, onChange);
        });
    }

    /** Start SAS on a request whose other side has accepted. Friendly errors only. */
    private async beginSas(request: VerificationRequest): Promise<Verifier> {
        try {
            const verifier = await request.startVerification("m.sas.v1");
            console.debug("[tumult] verification SAS started");
            return verifier;
        } catch (cause) {
            throw new Error(describeError(cause, "Couldn't start emoji verification"), { cause });
        }
    }

    public detachAll(): void {
        this.matrix.removeListener(CryptoEvent.VerificationRequestReceived, this.onIncoming);
        for (const [id, tracked] of this.requests) {
            tracked.request.removeListener(VerificationRequestEvent.Change, tracked.onChange);
            tracked.request.removeListener(VerificationRequestEvent.Change, tracked.onVerifierChange);
            const verifier = tracked.boundVerifier;
            if (verifier) {
                verifier.removeListener(VerifierEvent.ShowSas, tracked.onShowSasEvent);
                verifier.removeListener(VerifierEvent.Cancel, tracked.onCancel);
            }
            this.requests.delete(id);
        }
    }

    private track(request: VerificationRequest): void {
        const req: VerificationRequest = request;
        const id = req.transactionId ?? `req-${Date.now()}`;
        if (this.requests.has(id)) return;
        const tracked: TrackedRequest = {
            request: req,
            view: toRequestView(req),
            onChange: () => this.updateView(id),
            onVerifierChange: () => this.updateView(id),
            onShowSasEvent: () => this.updateView(id),
            onCancel: () => this.updateView(id),
            boundVerifier: null,
        };
        req.on(VerificationRequestEvent.Change, tracked.onChange);
        this.requests.set(id, tracked);
        this.updateView(id);
        console.debug(`[tumult] verification tracking ${id} (phase=${tracked.view.phase})`);
    }

    private updateView(id: string): void {
        const tracked = this.requests.get(id);
        if (!tracked) return;
        const before = tracked.view.phase;
        tracked.view = toRequestView(tracked.request);
        if (tracked.view.phase !== before) {
            console.debug(`[tumult] verification ${id}: ${before} -> ${tracked.view.phase}`);
        }

        // Bind by verifier IDENTITY, not by phase transition: a request can
        // jump Requested -> Started (the other side starts right after our
        // ready), skipping the Ready -> Started edge the old check waited for,
        // and then ShowSas was never heard — no emoji on screen.
        const verifier = tracked.request.verifier;
        if (verifier && verifier !== tracked.boundVerifier) {
            if (tracked.boundVerifier) {
                tracked.boundVerifier.removeListener(VerifierEvent.Cancel, tracked.onCancel);
                tracked.boundVerifier.removeListener(VerifierEvent.ShowSas, tracked.onShowSasEvent);
            }
            verifier.on(VerifierEvent.Cancel, tracked.onCancel);
            verifier.on(VerifierEvent.ShowSas, tracked.onShowSasEvent);
            tracked.boundVerifier = verifier;
            // ShowSas may already have fired before we bound: re-read now.
            tracked.view = toRequestView(tracked.request);
        }
        this.onUpdate();
    }
}
