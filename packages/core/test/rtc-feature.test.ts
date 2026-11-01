import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient } from "matrix-js-sdk";

import { AuthStorage, type AuthStore } from "../src/auth/storage.ts";
import { DEFAULT_VOICE_SETTINGS } from "../src/contract.ts";
import type { VoiceSettings } from "../src/contract.ts";
import { RtcFeature, VOICE_SETTINGS_KEY, type CallControls, type VoiceControls } from "../src/call/rtc.ts";

function memoryStore(seed: Record<string, string> = {}): AuthStore & { data: Map<string, string> } {
    const data = new Map(Object.entries(seed));
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
        removeItem: (key) => void data.delete(key),
    };
}

/** Every manager call, in order, across both managers. */
type Log = string[];

function stubCalls(log: Log): CallControls {
    return {
        join: async (roomId: string, video: boolean) => void log.push(`call.join ${roomId} ${video}`),
        leave: async () => void log.push("call.leave"),
        attach: () => {
            log.push("call.attach");
            return () => undefined;
        },
        detachAll: () => void log.push("call.detachAll"),
    };
}

function stubVoice(log: Log, applySettings?: (settings: VoiceSettings) => Promise<void>): VoiceControls {
    return {
        start: () => void log.push("voice.start"),
        join: async (roomId: string) => void log.push(`voice.join ${roomId}`),
        leave: async () => void log.push("voice.leave"),
        setMuted: async () => undefined,
        applySettings: applySettings ?? (async () => void log.push("voice.applySettings")),
        setCamera: async () => undefined,
        setScreenShare: async () => undefined,
        attachVideo: () => () => undefined,
        setDeafened: () => undefined,
        setUserVolume: () => undefined,
        detachAll: () => void log.push("voice.detachAll"),
    };
}

/** RtcFeature with the managers swapped for recording stubs. */
class TestRtc extends RtcFeature {
    public readonly log: Log = [];
    public applySettings: ((settings: VoiceSettings) => Promise<void>) | undefined;

    protected override createCalls(): CallControls {
        return stubCalls(this.log);
    }

    protected override createVoice(): VoiceControls {
        return stubVoice(this.log, this.applySettings);
    }
}

const client = {} as MatrixClient;
const worker = async (): Promise<Worker> => ({}) as Worker;

function feature(options: { calls?: boolean; voice?: boolean; store?: AuthStore } = {}): TestRtc {
    return new TestRtc({
        storage: new AuthStorage(options.store ?? memoryStore()),
        elementCallUrl: options.calls === false ? null : "https://call.example.com",
        createE2EEWorker: options.voice === false ? null : worker,
    });
}

describe("RtcFeature", () => {
    it("answers supportsCalls / supportsVoice from configuration, before attach", () => {
        assert.equal(feature().supportsCalls(), true);
        assert.equal(feature().supportsVoice(), true);
        assert.equal(feature({ calls: false }).supportsCalls(), false);
        assert.equal(feature({ voice: false }).supportsVoice(), false);
    });

    it("refuses to join before attach with the contract's messages", async () => {
        const rtc = feature();
        await assert.rejects(rtc.joinCall("!r", { video: false }), /^Error: Calls are not supported$/);
        await assert.rejects(rtc.joinVoice("!r"), /^Error: Voice is not supported$/);
        assert.throws(() => rtc.attachCall({} as HTMLIFrameElement), /^Error: Calls are not supported$/);
    });

    it("attach builds only the configured managers and starts voice", () => {
        const both = feature();
        both.attach(client);
        assert.deepEqual(both.log, ["voice.start"]);

        const callsOnly = feature({ voice: false });
        callsOnly.attach(client);
        assert.deepEqual(callsOnly.log, []);
        assert.equal(callsOnly.supportsVoice(), false);
    });

    it("joinCall leaves voice before joining", async () => {
        const rtc = feature();
        rtc.attach(client);
        rtc.log.length = 0;
        await rtc.joinCall("!room", { video: true });
        assert.deepEqual(rtc.log, ["voice.leave", "call.join !room true"]);
    });

    it("joinVoice leaves the call first", async () => {
        const rtc = feature();
        rtc.attach(client);
        rtc.log.length = 0;
        await rtc.joinVoice("!room");
        assert.deepEqual(rtc.log, ["call.leave", "voice.join !room"]);
    });

    it("setVoiceSettings persists and publishes before applying, so a failed apply keeps the choice", async () => {
        const store = memoryStore();
        const rtc = feature({ store });
        let seenAtApply: unknown = null;
        rtc.applySettings = async () => {
            seenAtApply = { stored: store.data.get(VOICE_SETTINGS_KEY), published: rtc.voiceSettingsFeed.get() };
            throw new Error("re-open failed");
        };
        rtc.attach(client);
        const next = { ...DEFAULT_VOICE_SETTINGS, noiseSuppression: !DEFAULT_VOICE_SETTINGS.noiseSuppression };
        await assert.rejects(rtc.setVoiceSettings({ noiseSuppression: next.noiseSuppression }), /re-open failed/);
        assert.deepEqual(seenAtApply, { stored: JSON.stringify(next), published: next });
        assert.deepEqual(rtc.voiceSettingsFeed.get(), next);
    });

    it("reads persisted voice settings at construction", () => {
        const saved = { ...DEFAULT_VOICE_SETTINGS, echoCancellation: !DEFAULT_VOICE_SETTINGS.echoCancellation };
        const rtc = feature({ store: memoryStore({ [VOICE_SETTINGS_KEY]: JSON.stringify(saved) }) });
        assert.deepEqual(rtc.voiceSettingsFeed.get(), saved);
    });

    it("detach drops both managers, keeps the feeds, and is safe to repeat", async () => {
        const rtc = feature();
        const feeds = [rtc.callFeed, rtc.voiceFeed, rtc.voiceRoomsFeed, rtc.voiceSettingsFeed];
        rtc.attach(client);
        rtc.log.length = 0;
        rtc.detach();
        rtc.detach();
        assert.deepEqual(rtc.log, ["call.detachAll", "voice.detachAll"]);
        assert.deepEqual([rtc.callFeed, rtc.voiceFeed, rtc.voiceRoomsFeed, rtc.voiceSettingsFeed], feeds);
        // Back to the pre-attach answers.
        await assert.rejects(rtc.joinCall("!r", { video: false }), /Calls are not supported/);
        await rtc.leaveVoice();
        assert.deepEqual(rtc.log, ["call.detachAll", "voice.detachAll"]);
    });
});
