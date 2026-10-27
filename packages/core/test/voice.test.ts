import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { MatrixClient } from "matrix-js-sdk";

import type { VoiceView } from "../src/contract.ts";
import { Observable } from "../src/observable.ts";
import { VoiceManager } from "../src/voice/manager.ts";
import { parseIdentity, type MediaSnapshot, type VoiceMedia } from "../src/voice/media.ts";
import { getSfuConfig } from "../src/voice/sfu.ts";

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

function setup(opts: { transports?: unknown[] | Error; focus?: unknown; deviceId?: string | null; fetchImpl?: typeof fetch } = {}) {
    const session = new FakeSession();
    session.focus = "focus" in opts ? opts.focus : LIVEKIT;
    const rtcManager = new EventEmitter() as EventEmitter & { getRoomSession: () => FakeSession; getActiveRoomSession: (r: { roomId: string }) => FakeSession | undefined };
    rtcManager.getRoomSession = () => session;
    rtcManager.getActiveRoomSession = () => (session.memberships.length > 0 ? session : undefined);
    const media = new FakeMedia();
    const client = {
        getRoom: (id: string) => (id === ROOM ? { roomId: ROOM } : null),
        getRooms: () => [{ roomId: ROOM }],
        getDeviceId: () => (opts.deviceId === undefined ? "DEV" : opts.deviceId),
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
        ((async (url: string, init: RequestInit) => {
            fetchCalls.push([url, JSON.parse(init.body as string)]);
            return new Response(JSON.stringify({ url: "wss://sfu.example.com", jwt: "tok" }), { status: 200 });
        }) as unknown as typeof fetch);
    const feed = new Observable<VoiceView | null>(null);
    const roomsFeed = new Observable<Record<string, string[]>>({});
    const manager = new VoiceManager(client, { createMedia: async () => media, fetch: fetchImpl }, feed, roomsFeed);
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
        assert.deepEqual(media.log, [["connect", "wss://sfu.example.com", "tok"], ["mic", true], ["deafen", false]]);
        assert.equal(feed.get()?.roomId, ROOM);
    });

    it("publishes participants and connection state from the media engine", async () => {
        const { manager, media, feed } = setup();
        await manager.join(ROOM);
        media.change({
            connection: "connected",
            participants: [
                { identity: "@me:localhost:DEV", speaking: false, muted: false },
                { identity: "@bob:example.com:XYZ", speaking: true, muted: true },
            ],
        });
        const view = feed.get();
        assert.equal(view?.state, "connected");
        assert.deepEqual(view?.participants, [
            { userId: "@me:localhost", deviceId: "DEV", speaking: false, muted: false },
            { userId: "@bob:example.com", deviceId: "XYZ", speaking: true, muted: true },
        ]);
        media.change({ ...media.snap, connection: "reconnecting" });
        assert.equal(feed.get()?.state, "reconnecting");
        media.change({ ...media.snap, connection: "disconnected" });
        assert.equal(feed.get()?.state, "error", "a dropped SFU is not silently shown as connected");
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

    it("explains a homeserver that advertises no LiveKit transport", async () => {
        const { manager, feed } = setup({ transports: [{ type: "something-else" }] });
        await manager.join(ROOM);
        assert.match(feed.get()?.error ?? "", /no LiveKit call server/);
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
                { identity: "@bob:x:A", speaking: false, muted: false },
                { identity: "@bob:x:B", speaking: false, muted: false },
                { identity: "@eve:x:C", speaking: false, muted: false },
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
