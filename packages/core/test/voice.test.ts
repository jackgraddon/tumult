import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MatrixError, type MatrixClient } from "matrix-js-sdk";

import type { VoiceView } from "../src/contract.ts";
import { Observable } from "../src/observable.ts";
import { VoiceManager, describeVoiceError } from "../src/voice/manager.ts";
import { DEFAULT_VOICE_SETTINGS } from "../src/contract.ts";
import { normalizeVoiceSettings } from "../src/voice/settings.ts";
import { parseIdentity, type MediaSnapshot, type VoiceMedia } from "../src/voice/media.ts";
import { discoverFoci, getSfuConfig } from "../src/voice/sfu.ts";

const ROOM = "!voice:localhost";
const SERVICE = "https://jwt.example.com";
const LIVEKIT = { type: "livekit", livekit_service_url: SERVICE };

// The SDK's session events, by their string values (stubs must agree with the
// enum, not with a hand-typed guess — see AGENTS.md on stubbing via enums).
import { MatrixRTCSessionEvent, MatrixRTCSessionManagerEvents } from "matrix-js-sdk/lib/matrixrtc/index.js";

class FakeSession extends EventEmitter {
    memberships: { userId: string; isExpired: () => boolean }[] = [];
    focus: unknown = null;
    joined: unknown[][] = [];
    left = 0;
    reemitted = 0;
    joinRoomSession(...args: unknown[]): void {
        this.joined.push(args);
    }
    async leaveRoomSession(): Promise<boolean> {
        this.left++;
        return true;
    }
    getFocusInUse(): unknown {
        return this.focus;
    }
    reemitEncryptionKeys(): void {
        this.reemitted++;
    }
}

class FakeMedia implements VoiceMedia {
    log: unknown[][] = [];
    listeners = new Set<() => void>();
    snap: MediaSnapshot = { connection: "connecting", participants: [] };
    connectError: Error | null = null;
    async connect(url: string, jwt: string): Promise<void> {
        this.log.push(["connect", url, jwt]);
        if (this.connectError) throw this.connectError;
    }
    disconnect(): void {
        this.log.push(["disconnect"]);
    }
    async setMicrophone(enabled: boolean): Promise<void> {
        this.log.push(["mic", enabled]);
    }
    async setProcessing(settings: unknown): Promise<void> {
        this.log.push(["processing", settings]);
    }
    cameraError: Error | null = null;
    async setCamera(enabled: boolean): Promise<void> {
        this.log.push(["camera", enabled]);
        if (this.cameraError) throw this.cameraError;
    }
    async setScreenShare(enabled: boolean): Promise<void> {
        this.log.push(["screen", enabled]);
    }
    attachVideo(identity: string, source: string): () => void {
        this.log.push(["attach", identity, source]);
        return () => void this.log.push(["detach", identity, source]);
    }
    async setKey(identity: string, index: number, key: Uint8Array): Promise<void> {
        this.log.push(["key", identity, index, [...key]]);
    }
    setDeafened(d: boolean): void {
        this.log.push(["deafen", d]);
    }
    setVolume(identity: string, volume: number): void {
        this.log.push(["volume", identity, volume]);
    }
    snapshot(): MediaSnapshot {
        return this.snap;
    }
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    change(snap: MediaSnapshot): void {
        this.snap = snap;
        this.listeners.forEach((l) => l());
    }
}

/**
 * What the SDK emits when the server refuses our call membership: its own
 * wrapper around the real MatrixError (MembershipManagerActionScheduler), whose
 * message embeds the request URL.
 */
function refused(): Error {
    const forbidden = new MatrixError(
        { errcode: "M_FORBIDDEN", error: "You don't have permission to post that to the room. user_level (0) < send_level (50)" },
        403,
        "http://127.0.0.1:8018/_matrix/client/v3/rooms/!r/state/org.matrix.msc3401.call.member/_%40bob",
    );
    return new Error(`The MembershipManager shut down because of the end condition: ${forbidden}`, { cause: forbidden });
}

function setup(
    opts: {
        transports?: unknown[] | Error;
        focus?: unknown;
        deviceId?: string | null;
        /** What `.well-known/matrix/client` answers. `null`/absent means 404. */
        wellKnown?: unknown | Error | null;
        /** A call already running in the room, whose focus can be borrowed. */
        existingFocus?: unknown;
        fetchImpl?: typeof fetch;
        reconnectDelaysMs?: number[];
        voiceSettings?: () => { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
    } = {},
) {
    const session = new FakeSession();
    session.focus = "focus" in opts ? opts.focus : LIVEKIT;
    const existing = new FakeSession();
    existing.focus = opts.existingFocus ?? null;
    const rtcManager = new EventEmitter() as EventEmitter & { getRoomSession: () => FakeSession; getActiveRoomSession: (r: { roomId: string }) => FakeSession | undefined };
    rtcManager.getRoomSession = () => session;
    rtcManager.getActiveRoomSession = () =>
        opts.existingFocus === undefined ? (session.memberships.length > 0 ? session : undefined) : existing;
    const media = new FakeMedia();
    const client = {
        getRoom: (id: string) => (id === ROOM ? { roomId: ROOM } : null),
        getRooms: () => [{ roomId: ROOM }],
        getDeviceId: () => (opts.deviceId === undefined ? "DEV" : opts.deviceId),
        getDomain: () => "localhost",
        getOpenIdToken: async () => ({ access_token: "oidc", matrix_server_name: "localhost" }),
        _unstable_getRTCTransports: async () => {
            if (opts.transports instanceof Error) throw opts.transports;
            return opts.transports ?? [LIVEKIT];
        },
        matrixRTC: rtcManager,
    } as unknown as MatrixClient;
    const fetchCalls: unknown[][] = [];
    const fetchImpl: typeof fetch =
        opts.fetchImpl ??
        ((async (url: string, init?: RequestInit) => {
            if (String(url).includes("/.well-known/matrix/client")) {
                const wellKnown = opts.wellKnown;
                if (wellKnown instanceof Error) throw wellKnown;
                if (wellKnown == null) return new Response("{}", { status: 404 });
                return new Response(JSON.stringify(wellKnown), { status: 200 });
            }
            fetchCalls.push([url, JSON.parse((init?.body as string) ?? "null")]);
            return new Response(JSON.stringify({ url: "wss://sfu.example.com", jwt: "tok" }), { status: 200 });
        }) as unknown as typeof fetch);
    const feed = new Observable<VoiceView | null>(null);
    const roomsFeed = new Observable<Record<string, string[]>>({});
    const manager = new VoiceManager(client, { createMedia: async () => media, fetch: fetchImpl, ...(opts.reconnectDelaysMs ? { reconnectDelaysMs: opts.reconnectDelaysMs } : {}), ...(opts.voiceSettings ? { voiceSettings: opts.voiceSettings } : {}) }, feed, roomsFeed);
    return { manager, session, media, feed, roomsFeed, rtcManager, fetchCalls };
}

describe("parseIdentity", () => {
    it("splits at the LAST colon, because a user id contains one", () => {
        assert.deepEqual(parseIdentity("@a:example.com:DEVICE1"), { userId: "@a:example.com", deviceId: "DEVICE1" });
        assert.deepEqual(parseIdentity("nocolon"), { userId: "nocolon", deviceId: "" });
    });
});

describe("getSfuConfig", () => {
    it("posts the Matrix room id, an OpenID token and the device id to /sfu/get", async () => {
        const calls: unknown[][] = [];
        const fetchImpl = (async (url: string, init: RequestInit) => {
            calls.push([url, init.method, JSON.parse(init.body as string)]);
            return new Response(JSON.stringify({ url: "wss://sfu", jwt: "j" }));
        }) as unknown as typeof fetch;
        const out = await getSfuConfig({ getOpenIdToken: async () => ({ access_token: "t" }) } as never, `${SERVICE}/`, ROOM, "DEV", fetchImpl);
        assert.deepEqual(out, { url: "wss://sfu", jwt: "j" });
        assert.deepEqual(calls, [[`${SERVICE}/sfu/get`, "POST", { room: ROOM, openid_token: { access_token: "t" }, device_id: "DEV" }]]);
    });

    it("names the status when the service refuses, and rejects an answer with no token", async () => {
        const refuse = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
        await assert.rejects(getSfuConfig({ getOpenIdToken: async () => ({}) } as never, SERVICE, ROOM, "D", refuse), /403.*nope/);
        const empty = (async () => new Response("{}")) as unknown as typeof fetch;
        await assert.rejects(getSfuConfig({ getOpenIdToken: async () => ({}) } as never, SERVICE, ROOM, "D", empty), /without an SFU url/);
    });
});

describe("discoverFoci", () => {
    const client = (transports: unknown[] | Error, domain: string | null = "example.com") =>
        ({
            _unstable_getRTCTransports: async () => {
                if (transports instanceof Error) throw transports;
                return transports;
            },
            getDomain: () => domain,
        }) as never;
    const respond =
        (body: unknown, status = 200) =>
        (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

    it("prefers the homeserver route and never asks for the well-known document", async () => {
        let asked = 0;
        const fetchImpl = (async () => {
            asked++;
            return new Response("{}");
        }) as unknown as typeof fetch;
        const discovery = await discoverFoci(client([LIVEKIT]), fetchImpl);
        assert.deepEqual(discovery.foci, [LIVEKIT]);
        assert.equal(asked, 0);
        assert.deepEqual(discovery.attempts, [{ asked: "GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports", error: null }]);
    });

    it("falls back to the server name's well-known focus, which is matrix.org's only route", async () => {
        const urls: string[] = [];
        const fetchImpl = (async (url: string) => {
            urls.push(url);
            return new Response(
                JSON.stringify({ "org.matrix.msc4143.rtc_foci": [{ type: "livekit", livekit_service_url: "https://livekit-jwt.call.matrix.org" }] }),
            );
        }) as unknown as typeof fetch;
        const discovery = await discoverFoci(client(new Error("M_UNRECOGNIZED")), fetchImpl);
        assert.deepEqual(urls, ["https://example.com/.well-known/matrix/client"]);
        assert.deepEqual(discovery.foci, [{ type: "livekit", livekit_service_url: "https://livekit-jwt.call.matrix.org" }]);
        assert.equal(discovery.attempts[0]?.error, "M_UNRECOGNIZED", "the homeserver's own answer is kept for the error message");
    });

    it("reads the transports-shaped key too, ignores other transport types, and names one service once", async () => {
        const discovery = await discoverFoci(
            client([]),
            respond({
                "org.matrix.msc4143.rtc.transports": [
                    { type: "livekit", livekit_service_url: SERVICE },
                    { type: "turn", urls: ["turn:example.com"] },
                ],
                "org.matrix.msc4143.rtc_foci": [{ type: "livekit", livekit_service_url: SERVICE }],
            }),
        );
        assert.deepEqual(discovery.foci, [LIVEKIT]);
    });

    it("records the failure of both routes instead of a bare 'not supported'", async () => {
        const discovery = await discoverFoci(client(new Error("M_UNRECOGNIZED"), null), respond({}, 404));
        assert.deepEqual(discovery.foci, []);
        assert.equal(discovery.attempts.length, 1, "with no server name there is no well-known URL to ask");
        assert.equal(discovery.attempts[0]?.error, "M_UNRECOGNIZED");
    });
});

describe("VoiceManager.join", () => {
    it("joins the session with the advertised LiveKit transport, then connects the SFU it is given", async () => {
        const { manager, session, media, feed, fetchCalls } = setup();
        await manager.join(ROOM);
        const [foci, multiSfu, config] = session.joined[0] as [unknown[], unknown, Record<string, unknown>];
        assert.deepEqual(foci, [{ type: "livekit", livekit_service_url: SERVICE, livekit_alias: ROOM }]);
        assert.equal(multiSfu, undefined);
        assert.equal(config["manageMediaKeys"], true);
        assert.equal(config["callIntent"], "audio");
        assert.equal(session.reemitted, 1, "keys minted before the listener attached are replayed");
        assert.deepEqual(fetchCalls, [[`${SERVICE}/sfu/get`, { room: ROOM, openid_token: { access_token: "oidc", matrix_server_name: "localhost" }, device_id: "DEV" }]]);
        assert.deepEqual(media.log, [["connect", "wss://sfu.example.com", "tok"], ["processing", { echoCancellation: true, noiseSuppression: true, autoGainControl: true }], ["mic", true], ["deafen", false]]);
        assert.equal(feed.get()?.roomId, ROOM);
    });

    it("publishes participants and connection state from the media engine", async () => {
        const { manager, media, feed } = setup();
        await manager.join(ROOM);
        media.change({
            connection: "connected",
            participants: [
                { identity: "@me:localhost:DEV", speaking: false, muted: false, camera: false, screen: false, screenAudio: false },
                { identity: "@bob:example.com:XYZ", speaking: true, muted: true, camera: false, screen: false, screenAudio: false },
            ],
        });
        const view = feed.get();
        assert.equal(view?.state, "connected");
        assert.deepEqual(view?.participants, [
            { userId: "@me:localhost", deviceId: "DEV", speaking: false, muted: false, camera: false, screen: false, screenAudio: false },
            { userId: "@bob:example.com", deviceId: "XYZ", speaking: true, muted: true, camera: false, screen: false, screenAudio: false },
        ]);
        media.change({ ...media.snap, connection: "reconnecting" });
        assert.equal(feed.get()?.state, "reconnecting");
        media.change({ ...media.snap, connection: "disconnected" });
        assert.notEqual(feed.get()?.state, "connected", "a dropped SFU is not silently shown as connected");
    });

    it("re-dials a dropped SFU with a fresh token and republishes the mic", async () => {
        const { manager, media, feed, fetchCalls } = setup({ reconnectDelaysMs: [0] });
        await manager.join(ROOM);
        media.change({ ...media.snap, connection: "disconnected" });
        assert.equal(feed.get()?.state, "reconnecting", "the retry is shown, not a dead call");
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(fetchCalls.length, 2, "a second token was requested");
        assert.equal(media.log.filter(([name]) => name === "connect").length, 2);
        assert.deepEqual(media.log.at(-2), ["mic", true]);
        media.change({ ...media.snap, connection: "connected" });
        assert.equal(feed.get()?.state, "connected");
    });

    it("gives up after the retries, leaving the session and the engine", async () => {
        const { manager, session, media, feed } = setup({ reconnectDelaysMs: [0, 0] });
        await manager.join(ROOM);
        media.connectError = new Error("still down");
        media.change({ ...media.snap, connection: "disconnected" });
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(feed.get()?.state, "error");
        assert.equal(feed.get()?.error, "still down");
        assert.equal(session.left, 1, "no ghost participant after a lost call");
        assert.ok(media.log.some(([name]) => name === "disconnect"));
    });

    it("does not re-dial after the user leaves", async () => {
        const { manager, media, fetchCalls } = setup({ reconnectDelaysMs: [5] });
        await manager.join(ROOM);
        media.change({ ...media.snap, connection: "disconnected" });
        await manager.leave();
        await new Promise((r) => setTimeout(r, 15));
        assert.equal(fetchCalls.length, 1);
    });

    it("tears the session down when the membership manager gives up", async () => {
        const { manager, session, media, feed } = setup();
        await manager.join(ROOM);
        session.emit(MatrixRTCSessionEvent.MembershipManagerError, new Error("membership lost"));
        await new Promise((r) => setImmediate(r));
        assert.equal(feed.get()?.state, "error");
        assert.equal(feed.get()?.error, "membership lost");
        assert.equal(session.left, 1);
        assert.ok(media.log.some(([name]) => name === "disconnect"));
    });

    it("never reaches the SFU when the membership is refused mid-join (no ghost)", async (t) => {
        t.mock.method(console, "error", () => {});
        // The real shape: the server refuses the call.member state event while
        // join() is still waiting for the focus, and the focus then appears
        // anyway (it is the OTHER member's). join() used to carry on, fetch a
        // token and connect an engine nothing referenced any more.
        const { manager, session, media, feed, fetchCalls } = setup({ focus: null });
        const joining = manager.join(ROOM);
        await new Promise((r) => setImmediate(r));
        session.emit(MatrixRTCSessionEvent.MembershipManagerError, refused());
        session.focus = LIVEKIT;
        session.emit(MatrixRTCSessionEvent.MembershipsChanged);
        await joining;
        assert.equal(fetchCalls.length, 0, "no token was asked for");
        assert.ok(!media.log.some(([name]) => name === "connect"), `connected after the refusal: ${JSON.stringify(media.log)}`);
        assert.equal(feed.get()?.state, "error");
        assert.equal(session.left, 1);
    });

    it("closes an SFU connection the refusal raced (no ghost)", async (t) => {
        t.mock.method(console, "error", () => {});
        const { manager, session, media } = setup();
        let finishConnect!: () => void;
        media.connect = async (url: string, jwt: string) => {
            media.log.push(["connect", url, jwt]);
            await new Promise<void>((resolve) => (finishConnect = resolve));
        };
        const joining = manager.join(ROOM);
        while (!media.log.some(([name]) => name === "connect")) await new Promise((r) => setImmediate(r));
        session.emit(MatrixRTCSessionEvent.MembershipManagerError, refused());
        finishConnect();
        await joining;
        const names = media.log.map(([name]) => name);
        assert.equal(names.at(-1), "disconnect", `the engine must end disconnected: ${JSON.stringify(names)}`);
        assert.ok(!names.includes("mic"), "and must not open the microphone");
    });

    it("tells the user in a sentence why the server refused them", async (t) => {
        t.mock.method(console, "error", () => {});
        const { manager, session, feed } = setup();
        await manager.join(ROOM);
        session.emit(MatrixRTCSessionEvent.MembershipManagerError, refused());
        await new Promise((r) => setImmediate(r));
        const shown = feed.get()?.error ?? "";
        assert.match(shown, /permission to join calls/);
        assert.doesNotMatch(shown, /http|MatrixError|MembershipManager|\[403\]/, `raw error leaked: ${shown}`);
    });

    it("forwards each frame key the session mints to the media engine, keyed by LiveKit identity", async () => {
        const { manager, session, media } = setup();
        await manager.join(ROOM);
        session.emit(MatrixRTCSessionEvent.EncryptionKeyChanged, new Uint8Array([1, 2, 3]), 4, { userId: "@bob:x", deviceId: "B" }, "@bob:x:B");
        await new Promise((r) => setImmediate(r));
        assert.deepEqual(media.log.at(-1), ["key", "@bob:x:B", 4, [1, 2, 3]]);
    });

    it("waits for the oldest member's transport when the session has none yet", async () => {
        const { manager, session, feed } = setup({ focus: null });
        const joining = manager.join(ROOM);
        await new Promise((r) => setImmediate(r));
        assert.equal(feed.get()?.state, "connecting");
        session.focus = LIVEKIT;
        session.emit(MatrixRTCSessionEvent.MembershipsChanged, [], []);
        await joining;
        assert.notEqual(feed.get()?.state, "error");
    });

    it("explains a homeserver with no MatrixRTC, and leaves nothing behind", async () => {
        const { manager, session, feed } = setup({ transports: new Error("M_NOT_FOUND") });
        await manager.join(ROOM);
        assert.equal(feed.get()?.state, "error");
        assert.match(feed.get()?.error ?? "", /does not advertise MatrixRTC/);
        assert.equal(session.joined.length, 0, "no membership was written");
    });

    it("names BOTH discovery routes when neither answers", async () => {
        const { manager, feed } = setup({ transports: [{ type: "something-else" }] });
        await manager.join(ROOM);
        const error = feed.get()?.error ?? "";
        assert.match(error, /no focus to join/, "an unhostable call is stated as such, not as a missing SFU");
        assert.match(error, /GET \/_matrix\/client\/unstable\/org\.matrix\.msc4143\/rtc\/transports → answered with no LiveKit transport/);
        assert.match(error, /GET https:\/\/localhost\/\.well-known\/matrix\/client → HTTP 404/);
    });

    // matrix.org reports `org.matrix.msc4143: false` in /versions and 404s the
    // transport endpoint, so its ONLY discovery path is the well-known focus
    // that the current MSC revision lists under "Alternatives".
    it("finds the focus in .well-known when the homeserver has no /rtc/transports", async () => {
        const MATRIX_ORG = "https://livekit-jwt.call.matrix.org";
        const { manager, session, feed, fetchCalls } = setup({
            transports: new Error("M_UNRECOGNIZED"),
            wellKnown: { "org.matrix.msc4143.rtc_foci": [{ type: "livekit", livekit_service_url: MATRIX_ORG }] },
            focus: { type: "livekit", livekit_service_url: MATRIX_ORG },
        });
        await manager.join(ROOM);
        assert.notEqual(feed.get()?.state, "error");
        assert.deepEqual(session.joined[0]?.[0], [{ type: "livekit", livekit_service_url: MATRIX_ORG, livekit_alias: ROOM }]);
        assert.equal(fetchCalls[0]?.[0], `${MATRIX_ORG}/sfu/get`);
    });

    // Nobody on a homeserver without RTC could join a call at all if this were
    // required: the JWT service verifies the FOCUS's homeserver against our own
    // OpenID token, so a running call's focus is enough to join it.
    it("joins a call already in progress by borrowing its focus", async () => {
        const HOST = "https://jwt.host.example";
        const { manager, session, feed, fetchCalls } = setup({
            transports: new Error("M_UNRECOGNIZED"),
            existingFocus: { type: "livekit", livekit_service_url: HOST },
            focus: { type: "livekit", livekit_service_url: HOST },
        });
        await manager.join(ROOM);
        assert.notEqual(feed.get()?.state, "error");
        assert.deepEqual(session.joined[0]?.[0], [{ type: "livekit", livekit_service_url: HOST, livekit_alias: ROOM }]);
        assert.equal(fetchCalls[0]?.[0], `${HOST}/sfu/get`, "the token comes from the focus in use, not from our own homeserver");
    });

    it("removes our membership and the media engine when the SFU connection fails", async () => {
        const { manager, session, media, feed } = setup();
        media.connectError = new Error("sfu unreachable");
        await manager.join(ROOM);
        assert.equal(feed.get()?.state, "error");
        assert.equal(feed.get()?.error, "sfu unreachable");
        assert.equal(session.left, 1, "a failed join must not leave a ghost participant in the room");
        assert.ok(media.log.some(([name]) => name === "disconnect"));
    });

    it("rejects an unknown room without touching the session", async () => {
        const { manager, session } = setup();
        await assert.rejects(manager.join("!nope:localhost"), /unknown room/);
        assert.equal(session.joined.length, 0);
    });

    it("a leave during the join stands the join down instead of resurrecting the session", async () => {
        const { manager, session, media, feed } = setup({ focus: null });
        const joining = manager.join(ROOM);
        await new Promise((r) => setImmediate(r));
        await manager.leave();
        session.focus = LIVEKIT;
        session.emit(MatrixRTCSessionEvent.MembershipsChanged, [], []);
        await joining;
        assert.equal(feed.get(), null);
        assert.ok(!media.log.some(([name]) => name === "connect"), "never connected after being cancelled");
        assert.equal(session.left, 1);
    });
});

describe("VoiceManager microphone processing", () => {
    const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

    it("applies the stored settings before the microphone opens, so it opens once under the right constraints", async () => {
        const { manager, media } = setup({ voiceSettings: () => RAW });
        await manager.join(ROOM);
        const names = media.log.map(([name]) => name);
        assert.ok(names.indexOf("processing") > names.indexOf("connect"));
        assert.ok(names.indexOf("processing") < names.indexOf("mic"), "settings first, then the microphone");
        assert.deepEqual(media.log.find(([name]) => name === "processing")?.[1], RAW);
    });

    it("defaults to processing on when nothing was configured", async () => {
        const { manager, media } = setup();
        await manager.join(ROOM);
        assert.deepEqual(media.log.find(([name]) => name === "processing")?.[1], { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    });

    it("re-applies a change to a live call, and ignores one when no call is open", async () => {
        const { manager, media } = setup();
        await manager.applySettings(RAW);
        assert.ok(!media.log.some(([name]) => name === "processing"));
        await manager.join(ROOM);
        await manager.applySettings(RAW);
        assert.deepEqual(media.log.at(-1), ["processing", RAW]);
    });

    it("reads the settings again when it re-dials, so a change made mid-call is not undone", async () => {
        let current = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        const { manager, media } = setup({ reconnectDelaysMs: [0], voiceSettings: () => current });
        await manager.join(ROOM);
        current = RAW;
        media.change({ ...media.snap, connection: "disconnected" });
        await new Promise((r) => setTimeout(r, 5));
        const applied = media.log.filter(([name]) => name === "processing");
        assert.deepEqual(applied.at(-1)?.[1], RAW);
    });
});

describe("describeVoiceError", () => {
    it("explains a refused membership, however deep the SDK wrapped it", () => {
        assert.match(describeVoiceError(refused()), /^You don't have permission to join calls in this room/);
        assert.match(describeVoiceError(new Error("outer", { cause: refused() })), /permission to join calls/);
    });

    it("uses the server's own words for any other Matrix error, never the URL", () => {
        const limited = new MatrixError({ errcode: "M_LIMIT_EXCEEDED", error: "Too many requests" }, 429, "http://hs/_matrix/client/v3/x");
        assert.equal(describeVoiceError(new Error("wrapped", { cause: limited })), "Couldn't join the call: Too many requests");
        assert.equal(describeVoiceError(new MatrixError({ errcode: "M_UNKNOWN" }, 500, "http://hs/x")), "Couldn't join the call: M_UNKNOWN");
    });

    it("keeps our own messages as they are", () => {
        assert.equal(describeVoiceError(new Error("The call server refused us (401): bad token")), "The call server refused us (401): bad token");
        assert.equal(describeVoiceError("plain"), "plain");
    });
});

describe("normalizeVoiceSettings", () => {
    it("completes anything stored into a full settings object", () => {
        assert.deepEqual(normalizeVoiceSettings(null), DEFAULT_VOICE_SETTINGS);
        assert.deepEqual(normalizeVoiceSettings({ noiseSuppression: false }), { echoCancellation: true, noiseSuppression: false, autoGainControl: true });
    });

    it("falls back per field on a mistyped value and drops unknown ones", () => {
        const out = normalizeVoiceSettings({ echoCancellation: "no", autoGainControl: false, voiceIsolation: true });
        assert.deepEqual(out, { echoCancellation: true, noiseSuppression: true, autoGainControl: false });
        assert.ok(!("voiceIsolation" in out));
    });
});

describe("VoiceManager video", () => {
    it("joins voice-only by default, with a membership intent of audio", async () => {
        const { manager, session, media, feed } = setup();
        await manager.join(ROOM);
        assert.equal((session.joined[0]?.[2] as { callIntent: string }).callIntent, "audio");
        assert.ok(!media.log.some(([name]) => name === "camera"));
        assert.equal(feed.get()?.camera, false);
    });

    it("starts the camera after connecting when asked, and says so in the intent", async () => {
        const { manager, session, media, feed } = setup();
        await manager.join(ROOM, { video: true });
        assert.equal((session.joined[0]?.[2] as { callIntent: string }).callIntent, "video");
        const names = media.log.map(([name]) => name);
        assert.ok(names.indexOf("camera") > names.indexOf("connect"), "frames cannot be published before the SFU connection");
        assert.equal(feed.get()?.camera, true);
    });

    it("stays in the call, camera off, when the camera cannot start", async () => {
        const { manager, media, feed } = setup();
        media.cameraError = new Error("NotAllowedError");
        const quiet = console.error;
        console.error = () => undefined;
        try {
            await manager.join(ROOM, { video: true });
        } finally {
            console.error = quiet;
        }
        assert.notEqual(feed.get()?.state, "error", "a denied camera is not a failed call");
        assert.equal(feed.get()?.camera, false);
    });

    it("turns the camera on and off, and reverts the intent when the device refuses", async () => {
        const { manager, media, feed } = setup();
        await manager.join(ROOM);
        await manager.setCamera(true);
        assert.equal(feed.get()?.camera, true);
        await manager.setCamera(false);
        assert.equal(feed.get()?.camera, false);
        media.cameraError = new Error("NotReadableError");
        await assert.rejects(manager.setCamera(true), /NotReadableError/);
        assert.equal(feed.get()?.camera, false, "a camera that never started is not shown as on");
    });

    it("reports what the media engine says is live for the local participant", async () => {
        const { manager, media, feed } = setup();
        await manager.join(ROOM);
        media.change({
            connection: "connected",
            participants: [
                { identity: "@me:localhost:DEV", speaking: false, muted: false, camera: false, screen: true, screenAudio: false },
                { identity: "@bob:example.com:XYZ", speaking: false, muted: false, camera: true, screen: false, screenAudio: false },
            ],
        });
        assert.equal(feed.get()?.screen, true, "a share the browser ended would flip this back off");
        assert.equal(feed.get()?.participants[1]?.camera, true);
    });

    it("says whether each screen share carries audio, since a browser may capture video only", async () => {
        const { manager, media, feed } = setup();
        await manager.join(ROOM);
        media.change({
            connection: "connected",
            participants: [
                { identity: "@me:localhost:DEV", speaking: false, muted: false, camera: false, screen: true, screenAudio: false },
                { identity: "@bob:example.com:XYZ", speaking: false, muted: false, camera: false, screen: true, screenAudio: true },
            ],
        });
        assert.deepEqual(feed.get()?.participants.map((p) => p.screenAudio), [false, true]);
    });

    it("attaches a participant's track by LiveKit identity, and is inert outside a session", async () => {
        const { manager, media } = setup();
        const element = {} as HTMLVideoElement;
        assert.equal(typeof manager.attachVideo("@bob:x", "B", "camera", element), "function");
        assert.ok(!media.log.some(([name]) => name === "attach"));
        await manager.join(ROOM);
        const detach = manager.attachVideo("@bob:x", "B", "screen", element);
        assert.deepEqual(media.log.at(-1), ["attach", "@bob:x:B", "screen"]);
        detach();
        assert.deepEqual(media.log.at(-1), ["detach", "@bob:x:B", "screen"]);
    });

    it("restores the camera after re-dialling a dropped connection", async () => {
        const { manager, media } = setup({ reconnectDelaysMs: [0] });
        await manager.join(ROOM, { video: true });
        media.change({ ...media.snap, connection: "disconnected" });
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(media.log.filter(([name, on]) => name === "camera" && on === true).length, 2);
    });
});

describe("VoiceManager controls", () => {
    it("mutes the microphone and reflects it, and remembers the choice for the next join", async () => {
        const { manager, media, feed } = setup();
        await manager.join(ROOM);
        await manager.setMuted(true);
        assert.deepEqual(media.log.at(-1), ["mic", false]);
        assert.equal(feed.get()?.muted, true);
        await manager.leave();
        await manager.join(ROOM);
        assert.deepEqual(media.log.filter(([n]) => n === "mic").at(-1), ["mic", false], "a muted user does not rejoin live");
    });

    it("deafens locally and reflects it", async () => {
        const { manager, media, feed } = setup();
        await manager.join(ROOM);
        manager.setDeafened(true);
        assert.deepEqual(media.log.at(-1), ["deafen", true]);
        assert.equal(feed.get()?.deafened, true);
    });

    it("clamps a per-user volume and applies it to every device of that user", async () => {
        const { manager, media } = setup();
        await manager.join(ROOM);
        media.change({
            connection: "connected",
            participants: [
                { identity: "@bob:x:A", speaking: false, muted: false, camera: false, screen: false, screenAudio: false },
                { identity: "@bob:x:B", speaking: false, muted: false, camera: false, screen: false, screenAudio: false },
                { identity: "@eve:x:C", speaking: false, muted: false, camera: false, screen: false, screenAudio: false },
            ],
        });
        manager.setUserVolume("@bob:x", 5);
        const volumes = media.log.filter(([n]) => n === "volume").slice(-2);
        assert.deepEqual(volumes, [["volume", "@bob:x:A", 1], ["volume", "@bob:x:B", 1]]);
        assert.ok(!media.log.some(([n, id]) => n === "volume" && id === "@eve:x:C"));
    });

    it("leave disconnects the media, leaves the session, and clears the feed", async () => {
        const { manager, session, media, feed } = setup();
        await manager.join(ROOM);
        await manager.leave();
        assert.equal(feed.get(), null);
        assert.equal(session.left, 1);
        assert.ok(media.log.some(([name]) => name === "disconnect"));
    });
});

describe("VoiceManager.start (who is in voice)", () => {
    it("publishes each room's participants and follows session start / end", () => {
        const { manager, session, rtcManager, roomsFeed } = setup();
        session.memberships = [{ userId: "@a:x", isExpired: () => false }, { userId: "@old:x", isExpired: () => true }];
        manager.start();
        assert.deepEqual(roomsFeed.get(), { [ROOM]: ["@a:x"] }, "an expired membership is not a participant");
        session.memberships = [{ userId: "@a:x", isExpired: () => false }, { userId: "@b:x", isExpired: () => false }];
        session.emit(MatrixRTCSessionEvent.MembershipsChanged, [], []);
        assert.deepEqual(roomsFeed.get(), { [ROOM]: ["@a:x", "@b:x"] });
        session.memberships = [];
        rtcManager.emit(MatrixRTCSessionManagerEvents.SessionEnded, ROOM, session);
        assert.deepEqual(roomsFeed.get(), {});
    });
});
