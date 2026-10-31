import type { MatrixClient } from "matrix-js-sdk";

import type { CallView, VoiceSettings, VoiceVideoSource, VoiceView } from "../contract.ts";
import type { AuthStorage } from "../auth/storage.ts";
import { Observable } from "../observable.ts";
import { CallManager } from "./manager.ts";
import { VoiceManager } from "../voice/manager.ts";
import { createLiveKitMedia } from "../voice/media.ts";
import { normalizeVoiceSettings } from "../voice/settings.ts";

// A device preference (which microphone processing it wants), not an account's,
// so unlike the presence key it survives logout.
export const VOICE_SETTINGS_KEY = "tumult.voice.settings";

export interface RtcFeatureOptions {
    storage: AuthStorage;
    /** Embedded call app URL; null means calls are unsupported. */
    elementCallUrl: string | null;
    /** Host-built LiveKit E2EE worker; null means voice is unsupported. */
    createE2EEWorker: (() => Promise<Worker>) | null;
}

/** The part of {@link CallManager} this feature drives. */
export type CallControls = Pick<CallManager, "join" | "leave" | "attach" | "detachAll">;

/** The part of {@link VoiceManager} this feature drives. */
export type VoiceControls = Pick<
    VoiceManager,
    | "start"
    | "join"
    | "leave"
    | "setMuted"
    | "applySettings"
    | "setCamera"
    | "setScreenShare"
    | "attachVideo"
    | "setDeafened"
    | "setUserVolume"
    | "detachAll"
>;

/**
 * Calls and voice: the embedded Element Call (`CallManager`) and native
 * MatrixRTC voice (`VoiceManager`), which are mutually exclusive because both
 * write this device's call membership.
 *
 * The feeds are created once, here, and live for the client's whole life so
 * the shell's subscriptions survive stop/start. The managers are per-start:
 * built by {@link attach} at bootstrap's fixed position and dropped by
 * {@link detach}. Voice settings are a device preference and survive logout,
 * so there is no forget().
 */
export class RtcFeature {
    public readonly callFeed = new Observable<CallView | null>(null);
    public readonly voiceFeed = new Observable<VoiceView | null>(null);
    public readonly voiceRoomsFeed = new Observable<Record<string, string[]>>({});
    public readonly voiceSettingsFeed: Observable<VoiceSettings>;

    private readonly storage: AuthStorage;
    private readonly elementCallUrl: string | null;
    private readonly createE2EEWorker: (() => Promise<Worker>) | null;
    /** The embedded call, alive while the sync loop runs. */
    private calls: CallControls | null = null;
    /** Native voice, alive while the sync loop runs. */
    private voiceManager: VoiceControls | null = null;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(options: RtcFeatureOptions) {
        this.storage = options.storage;
        this.elementCallUrl = options.elementCallUrl;
        this.createE2EEWorker = options.createE2EEWorker;
        this.voiceSettingsFeed = new Observable(normalizeVoiceSettings(this.storage.getItem(VOICE_SETTINGS_KEY)));
    }

    /** Build the per-start managers on the client bootstrap just created. */
    public attach(client: MatrixClient): void {
        if (this.elementCallUrl) this.calls = this.createCalls(client, this.elementCallUrl);
        const createE2EEWorker = this.createE2EEWorker;
        if (createE2EEWorker) {
            this.voiceManager = this.createVoice(client, createE2EEWorker);
            this.voiceManager.start();
        }
    }

    /** Drop the per-start managers. Idempotent; safe on a half-built start. */
    public detach(): void {
        this.calls?.detachAll();
        this.calls = null;
        this.voiceManager?.detachAll();
        this.voiceManager = null;
    }

    /** Seam for tests: the real manager unless overridden. */
    protected createCalls(client: MatrixClient, elementCallUrl: string): CallControls {
        return new CallManager(client, elementCallUrl, this.callFeed);
    }

    /** Seam for tests: the real manager unless overridden. */
    protected createVoice(client: MatrixClient, createE2EEWorker: () => Promise<Worker>): VoiceControls {
        return new VoiceManager(
            client,
            { createMedia: () => createLiveKitMedia({ createE2EEWorker }), voiceSettings: () => this.voiceSettingsFeed.get() },
            this.voiceFeed,
            this.voiceRoomsFeed,
        );
    }

    // Answered from configuration, not from the manager: the managers only
    // exist after start(), but the shell asks once at setup, before it.
    public supportsCalls(): boolean {
        return this.elementCallUrl !== null;
    }

    public async joinCall(roomId: string, options: { video: boolean }): Promise<void> {
        const calls = this.calls;
        if (!calls) throw new Error("Calls are not supported");
        // Both write this device's call membership; two at once would fight.
        await this.voiceManager?.leave();
        await calls.join(roomId, options.video);
    }

    public async leaveCall(): Promise<void> {
        await this.calls?.leave();
    }

    public attachCall(frame: HTMLIFrameElement): () => void {
        const calls = this.calls;
        if (!calls) throw new Error("Calls are not supported");
        return calls.attach(frame);
    }

    public supportsVoice(): boolean {
        return this.createE2EEWorker !== null;
    }

    public async joinVoice(roomId: string, options: { video?: boolean } = {}): Promise<void> {
        const voice = this.voiceManager;
        if (!voice) throw new Error("Voice is not supported");
        await this.calls?.leave();
        await voice.join(roomId, options);
    }

    public async leaveVoice(): Promise<void> {
        await this.voiceManager?.leave();
    }

    public async setVoiceMuted(muted: boolean): Promise<void> {
        await this.voiceManager?.setMuted(muted);
    }

    public async setVoiceSettings(settings: Partial<VoiceSettings>): Promise<void> {
        const next = normalizeVoiceSettings({ ...this.voiceSettingsFeed.get(), ...settings });
        // Persist and publish first: the choice is the user's whether or not a
        // call is open to apply it to, and a failed re-open must not lose it.
        this.storage.setItem(VOICE_SETTINGS_KEY, next);
        this.voiceSettingsFeed.set(next);
        await this.voiceManager?.applySettings(next);
    }

    public async setVoiceCamera(enabled: boolean): Promise<void> {
        await this.voiceManager?.setCamera(enabled);
    }

    public async setVoiceScreenShare(enabled: boolean): Promise<void> {
        await this.voiceManager?.setScreenShare(enabled);
    }

    public attachVoiceVideo(userId: string, deviceId: string, source: VoiceVideoSource, element: HTMLVideoElement): () => void {
        return this.voiceManager?.attachVideo(userId, deviceId, source, element) ?? (() => undefined);
    }

    public setVoiceDeafened(deafened: boolean): void {
        this.voiceManager?.setDeafened(deafened);
    }

    public setVoiceUserVolume(userId: string, volume: number): void {
        this.voiceManager?.setUserVolume(userId, volume);
    }
}
