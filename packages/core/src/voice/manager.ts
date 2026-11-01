import { describeError } from "../errors.ts";
import { MatrixRTCSessionEvent, MatrixRTCSessionManagerEvents } from "matrix-js-sdk/lib/matrixrtc/index.js";
import type { MatrixRTCSession } from "matrix-js-sdk/lib/matrixrtc/index.js";
import type { MatrixClient } from "matrix-js-sdk";
import type { VoiceParticipant, VoiceSettings, VoiceVideoSource, VoiceView } from "../contract.ts";
import { Observable } from "../observable.ts";
import { getSfuConfig, discoverFoci, isLivekitFocus } from "./sfu.ts";
import type { FocusDiscovery, LivekitTransportConfig, SfuConfig } from "./sfu.ts";
import { DEFAULT_VOICE_SETTINGS } from "../contract.ts";
import { parseIdentity, type MediaSnapshot, type VoiceMedia } from "./media.ts";

/** How long the oldest member's transport may take to appear after we join. */
const FOCUS_TIMEOUT_MS = 15_000;

/** Waits before each reconnect attempt after the SFU connection is lost. */
const RECONNECT_DELAYS_MS = [1_000, 3_000, 8_000];

export interface VoiceManagerOptions {
    /** Builds the media engine for one session (LiveKit in production). */
    createMedia: () => Promise<VoiceMedia>;
    /** Overridable so tests need no network. */
    fetch?: typeof fetch;
    /** Read at join time, so a change made before a call is honoured by it. */
    voiceSettings?: () => VoiceSettings;
    /** Overridable so tests need no real waiting. */
    reconnectDelaysMs?: readonly number[];
}

/** The slice of the SDK's session this manager uses, so tests can stub it. */
type Session = Pick<MatrixRTCSession, "join" | "leave" | "reemitEncryptionKeys" | "memberships" | "on" | "off">;

/**
 * The transport the call is ON: the oldest live membership's first usable
 * LiveKit focus. `memberships` is kept oldest-first by the SDK
 * (`sessionMembershipsForSlot` sorts by `createdTs`).
 *
 * This is the "oldest membership" focus selection matrix-js-sdk 44 REMOVED
 * (with `getFocusInUse()`; the SDK now writes `focus_selection: "multi_sfu"`
 * and expects each client to subscribe to every member's own transport). We
 * connect to ONE SFU per call, so we keep the rule ourselves: everyone who
 * follows it meets on one SFU, and a multi-SFU client still finds us, since we
 * publish on exactly that transport.
 */
export function focusInUse(memberships: Session["memberships"]): LivekitTransportConfig | null {
    for (const membership of memberships) {
        if (membership.isExpired()) continue;
        const focus = membership.transports.find(isLivekitFocus);
        if (focus) return focus;
    }
    return null;
}

/**
 * Native voice: joins a room's MatrixRTC session, finds the SFU, and connects
 * the media engine to it.
 *
 * Protocol choices (each one a place to revisit when Element Call's defaults move):
 *  - membership is a room STATE event, not a sticky event, so it works on any
 *    homeserver (Element Call's "compatibility" mode);
 *  - the SFU is the OLDEST member's transport (`focusInUse`, our own copy of
 *    the rule the SDK dropped in 44), and we publish on exactly that one;
 *  - frame keys are per participant, minted and exchanged by the SDK session
 *    (`manageMediaKeys`) and handed to the media engine as they change.
 *
 * One session per window. `generation` is how an in-flight `join` learns it was
 * superseded or cancelled by `leave`: every await is followed by a check, and a
 * stale join cleans up after itself rather than resurrecting the session.
 */
export class VoiceManager {
    private readonly client: MatrixClient;
    private readonly options: VoiceManagerOptions;
    private readonly feed: Observable<VoiceView | null>;
    private readonly roomsFeed: Observable<Record<string, string[]>>;

    private generation = 0;
    private active: { roomId: string; session: Session; media: VoiceMedia; teardown: () => void; serviceUrl: string | null } | null = null;
    /** True while we are re-dialling a lost SFU connection; the feed reads "reconnecting". */
    private reconnecting = false;
    private muted = false;
    private deafened = false;
    /** The camera we WANT on; the view reports what the media engine says is live. */
    private camera = false;
    private readonly volumes = new Map<string, number>();

    /** Per-room session watchers for the "who is in voice" feed. */
    private readonly watched = new Map<string, () => void>();
    private stopWatching: (() => void) | null = null;

    public constructor(
        client: MatrixClient,
        options: VoiceManagerOptions,
        feed: Observable<VoiceView | null>,
        roomsFeed: Observable<Record<string, string[]>>,
    ) {
        this.client = client;
        this.options = options;
        this.feed = feed;
        this.roomsFeed = roomsFeed;
    }

    /** Begin publishing who is in each room's voice session. */
    public start(): void {
        const manager = this.client.matrixRTC;
        const watch = (roomId: string, session: MatrixRTCSession): void => {
            this.watched.get(roomId)?.();
            const onChange = (): void => this.publishRooms();
            session.on(MatrixRTCSessionEvent.MembershipsChanged, onChange);
            this.watched.set(roomId, () => session.off(MatrixRTCSessionEvent.MembershipsChanged, onChange));
            this.publishRooms();
        };
        const onStarted = (roomId: string, session: MatrixRTCSession): void => watch(roomId, session);
        const onEnded = (roomId: string): void => {
            this.watched.get(roomId)?.();
            this.watched.delete(roomId);
            this.publishRooms();
        };
        manager.on(MatrixRTCSessionManagerEvents.SessionStarted, onStarted);
        manager.on(MatrixRTCSessionManagerEvents.SessionEnded, onEnded);
        // Sessions that began before we attached never re-announce themselves.
        for (const room of this.client.getRooms()) {
            const session = manager.getActiveRoomSession(room);
            if (session) watch(room.roomId, session);
        }
        this.stopWatching = () => {
            manager.off(MatrixRTCSessionManagerEvents.SessionStarted, onStarted);
            manager.off(MatrixRTCSessionManagerEvents.SessionEnded, onEnded);
            for (const unwatch of this.watched.values()) unwatch();
            this.watched.clear();
        };
    }

    public async join(roomId: string, options: { video?: boolean } = {}): Promise<void> {
        const room = this.client.getRoom(roomId);
        if (!room) throw new Error(`Cannot join voice in unknown room ${roomId}`);
        await this.leave();
        this.camera = options.video === true;
        const generation = ++this.generation;
        const live = (): boolean => generation === this.generation;

        this.publish({ roomId, state: "connecting", error: null, participants: [] });

        let session: Session | null = null;
        let media: VoiceMedia | null = null;
        let teardown = (): void => undefined;
        try {
            const userId = this.client.getUserId();
            const deviceId = this.client.getDeviceId();
            if (!userId || !deviceId) throw new Error("Cannot join voice without a device id");
            const discovery = await discoverFoci(this.client, this.options.fetch);
            if (!live()) return;
            // A call already under way decides the SFU (see focusInUse). And
            // when our homeserver names no focus, the running call's is the
            // ONLY one: a member authenticates against the FOCUS's JWT service
            // with their own OpenID token, never against their own homeserver.
            // So joining needs no local transports at all; this is what lets
            // an account on a homeserver with no RTC (e.g. matrix.org) join a
            // call hosted by someone else's.
            const running = this.client.matrixRTC.getActiveRoomSession(room);
            const chosen = focusInUse(running?.memberships ?? []) ?? discovery.foci[0];
            if (!chosen) throw new Error(noFocus(discovery));
            const published = [
                {
                    type: "livekit" as const,
                    livekit_service_url: chosen.livekit_service_url,
                    // The alias the JWT service maps this Matrix room to.
                    livekit_alias: roomId,
                },
            ];

            media = await this.options.createMedia();
            if (!live()) {
                media.disconnect();
                return;
            }
            const engine = media;
            session = this.client.matrixRTC.getRoomSession(room);
            const rtc = session;

            // Listeners go on BEFORE the join and the keys are re-emitted after, so
            // a key minted between "join" and "attach" is not lost (frames would
            // then decrypt as garbage with no error).
            const onKey = (key: Uint8Array, index: number, _membership: unknown, identity: string): void => {
                void engine.setKey(identity, index, key).catch((error: unknown) => console.error("[tumult] could not set a call key", error));
            };
            const onMembers = (): void => this.publishFromMedia();
            const onError = (error: unknown): void => this.fail(generation, error);
            rtc.on(MatrixRTCSessionEvent.EncryptionKeyChanged, onKey);
            rtc.on(MatrixRTCSessionEvent.MembershipsChanged, onMembers);
            rtc.on(MatrixRTCSessionEvent.MembershipManagerError, onError);
            const unsubscribeMedia = engine.subscribe(() => {
                this.publishFromMedia();
                this.reconnectIfDropped(generation);
            });
            teardown = () => {
                rtc.off(MatrixRTCSessionEvent.EncryptionKeyChanged, onKey);
                rtc.off(MatrixRTCSessionEvent.MembershipsChanged, onMembers);
                rtc.off(MatrixRTCSessionEvent.MembershipManagerError, onError);
                unsubscribeMedia();
            };
            this.active = { roomId, session: rtc, media: engine, teardown, serviceUrl: null };

            // memberId MUST be `<user>:<device>`: that is the `membershipID`
            // the SDK writes into a legacy (state-event) membership, and since
            // matrix-js-sdk 45 a peer files an incoming media key under the
            // membership whose user, device AND member id all match the key's
            // — any other value and our keys never attach, so every frame we
            // send stays undecryptable. It is also the LiveKit identity
            // `/sfu/get` assigns, i.e. the `identity` EncryptionKeyChanged hands us.
            const identity = { userId, deviceId, memberId: `${userId}:${deviceId}` };
            const joinConfig = { manageMediaKeys: true, callIntent: this.camera ? "video" : "audio" } as const;
            rtc.join(identity, published, joinConfig);
            rtc.reemitEncryptionKeys();

            // The same rule, read from the session we joined: at once when a
            // call is already running (its oldest member's focus), otherwise
            // when our own membership lands. Like v43's getFocusInUse(), this
            // does not wait for our membership when others are there, so the
            // membership PUT and the SFU connect still run in parallel.
            const focus = await this.waitForFocus(rtc, live);
            if (!live()) return;
            const serviceUrl = focus.livekit_service_url;
            // Two calls started at once: an older membership landed after we
            // chose, so we connect to ITS SFU — and must not keep advertising
            // ours. Since 44 a multi-SFU client (Element Call) subscribes to
            // each member's published transport, so a stale `foci_preferred`
            // makes us invisible to it. The session has no way to change the
            // published transports in place, so leave and rejoin with the one
            // we are actually on (keys are re-minted and re-emitted).
            if (serviceUrl !== published[0]?.livekit_service_url) {
                await rtc.leave();
                if (!live()) return;
                rtc.join(identity, [{ type: "livekit", livekit_service_url: serviceUrl, livekit_alias: roomId }], joinConfig);
                rtc.reemitEncryptionKeys();
            }
            if (this.active) this.active.serviceUrl = serviceUrl;
            const sfu: SfuConfig = await getSfuConfig(this.client, serviceUrl, roomId, deviceId, this.options.fetch);
            if (!live()) return;

            await engine.connect(sfu.url, sfu.jwt);
            if (!live()) {
                // Whoever stood us down (leave, a refused membership)
                // disconnected this engine while the connect was in flight,
                // which it may have outlived. Close it again, or it stays on
                // the SFU with nothing left that can close it.
                engine.disconnect();
                return;
            }
            // Before the microphone opens, or it opens under the wrong constraints
            // and has to be opened twice.
            await engine.setProcessing(this.settings());
            if (!live()) return;
            await engine.setMicrophone(!this.muted);
            engine.setDeafened(this.deafened);
            // A camera that cannot start (no device, permission denied) must not
            // fail the join: the call is still a perfectly good voice call.
            if (this.camera) await this.startCamera(engine, live);
            if (!live()) return;
            this.publishFromMedia();
        } catch (error) {
            if (!live()) return;
            console.error("[tumult] could not join voice", error);
            await this.abort(generation, session, media, teardown);
            this.publish({ roomId, state: "error", error: describeVoiceError(error), participants: [] });
        }
    }

    public async leave(): Promise<void> {
        // Bump first: an in-flight join sees it at its next await and stands down.
        this.generation++;
        this.reconnecting = false;
        const active = this.active;
        this.active = null;
        if (!active) {
            if (this.feed.get()) this.feed.set(null);
            return;
        }
        active.teardown();
        active.media.disconnect();
        // Remove our membership so the room list stops showing a ghost; if this
        // fails the delayed-leave event the SDK scheduled cleans up server-side.
        await active.session.leave().catch((error: unknown) => console.error("[tumult] could not leave the voice session", error));
        this.feed.set(null);
    }

    public async setMuted(muted: boolean): Promise<void> {
        this.muted = muted;
        const active = this.active;
        if (!active) return;
        await active.media.setMicrophone(!muted);
        this.publishFromMedia();
    }

    /** Re-open the live microphone under new processing settings. A no-op outside a session. */
    public async applySettings(settings: VoiceSettings): Promise<void> {
        await this.active?.media.setProcessing(settings);
    }

    private settings(): VoiceSettings {
        return this.options.voiceSettings?.() ?? DEFAULT_VOICE_SETTINGS;
    }

    public async setCamera(enabled: boolean): Promise<void> {
        const active = this.active;
        if (!active) return;
        const previous = this.camera;
        this.camera = enabled;
        try {
            await active.media.setCamera(enabled);
        } catch (error) {
            this.camera = previous;
            this.publishFromMedia();
            throw error;
        }
        this.publishFromMedia();
    }

    public async setScreenShare(enabled: boolean): Promise<void> {
        const active = this.active;
        if (!active) return;
        try {
            await active.media.setScreenShare(enabled);
        } finally {
            this.publishFromMedia();
        }
    }

    public attachVideo(userId: string, deviceId: string, source: VoiceVideoSource, element: HTMLVideoElement): () => void {
        return this.active?.media.attachVideo(`${userId}:${deviceId}`, source, element) ?? (() => undefined);
    }

    public setDeafened(deafened: boolean): void {
        this.deafened = deafened;
        this.active?.media.setDeafened(deafened);
        this.publishFromMedia();
    }

    public setUserVolume(userId: string, volume: number): void {
        this.volumes.set(userId, Math.min(1, Math.max(0, volume)));
        this.applyVolumes();
    }

    /** Drop everything without touching the server (used on stop()). */
    public detachAll(): void {
        this.generation++;
        this.reconnecting = false;
        const active = this.active;
        this.active = null;
        active?.teardown();
        active?.media.disconnect();
        this.stopWatching?.();
        this.stopWatching = null;
        this.feed.set(null);
        this.roomsFeed.set({});
    }

    private async startCamera(engine: VoiceMedia, live: () => boolean): Promise<void> {
        try {
            await engine.setCamera(true);
        } catch (error) {
            if (live()) this.camera = false;
            console.error("[tumult] could not start the camera", error);
        }
    }

    private async waitForFocus(session: Session, live: () => boolean): Promise<{ livekit_service_url: string }> {
        const find = (): { livekit_service_url: string } | null => focusInUse(session.memberships);
        const now = find();
        if (now) return now;
        return new Promise((resolve, reject) => {
            const onChange = (): void => {
                const focus = find();
                if (focus || !live()) done(focus);
            };
            const timer = setTimeout(() => done(null), FOCUS_TIMEOUT_MS);
            const done = (focus: { livekit_service_url: string } | null): void => {
                clearTimeout(timer);
                session.off(MatrixRTCSessionEvent.MembershipsChanged, onChange);
                if (focus) resolve(focus);
                else if (!live()) reject(new Error("cancelled"));
                else reject(new Error("The call server never appeared in the room's call membership"));
            };
            session.on(MatrixRTCSessionEvent.MembershipsChanged, onChange);
        });
    }

    private async abort(generation: number, session: Session | null, media: VoiceMedia | null, teardown: () => void): Promise<void> {
        if (generation !== this.generation) return;
        this.active = null;
        teardown();
        media?.disconnect();
        // A failed join may already have written our membership.
        await session?.leave().catch(() => undefined);
    }

    /**
     * A session-level failure (the membership manager gave up). Publishing an
     * error alone would leave media connected and our membership written, i.e.
     * a ghost participant the user cannot see or leave, so tear it all down
     * first and keep only the error on the feed.
     */
    private fail(generation: number, error: unknown): void {
        if (generation !== this.generation) return;
        // Bump, as leave() does: the refusal usually lands while join() is
        // still awaiting the focus or the token, and without this it carried
        // on and connected a media engine nothing referenced any more — a
        // ghost on the SFU, receiving media it had no keys for.
        this.generation++;
        console.error("[tumult] the voice session failed", error);
        const roomId = this.active?.roomId ?? this.feed.get()?.roomId;
        const active = this.active;
        this.active = null;
        this.reconnecting = false;
        active?.teardown();
        active?.media.disconnect();
        void active?.session.leave().catch(() => undefined);
        if (roomId) this.publish({ roomId, state: "error", error: describeVoiceError(error), participants: [] });
    }

    /**
     * LiveKit gives up on a connection (network flap past its own retries, an
     * expired token) by reporting `disconnected`; nothing re-dials it. Do that
     * here with a FRESH token, since the old one may be why it dropped. Only
     * after a first successful connect: a failed initial connect is `join`'s
     * to report.
     */
    private reconnectIfDropped(generation: number): void {
        const active = this.active;
        if (!active || this.reconnecting || active.serviceUrl === null) return;
        if (active.media.snapshot().connection !== "disconnected") return;
        this.reconnecting = true;
        void this.reconnect(generation, active);
    }

    private async reconnect(generation: number, active: NonNullable<VoiceManager["active"]>): Promise<void> {
        const live = (): boolean => generation === this.generation && this.active === active;
        const delays = this.options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
        const deviceId = this.client.getDeviceId();
        let lastError: unknown = new Error("The call connection was lost");
        this.publishFromMedia();
        for (const delay of delays) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (!live()) return;
            try {
                if (!deviceId || active.serviceUrl === null) throw new Error("Cannot rejoin voice without a device id");
                const sfu = await getSfuConfig(this.client, active.serviceUrl, active.roomId, deviceId, this.options.fetch);
                if (!live()) return;
                await active.media.connect(sfu.url, sfu.jwt);
                if (!live()) return;
                // Our published tracks died with the old connection.
                await active.media.setProcessing(this.settings());
                await active.media.setMicrophone(!this.muted);
                active.media.setDeafened(this.deafened);
                // Screen share ends with the connection (re-sharing needs a fresh
                // user gesture); the camera is restored.
                if (this.camera) await this.startCamera(active.media, live);
                this.reconnecting = false;
                this.publishFromMedia();
                return;
            } catch (error) {
                lastError = error;
            }
        }
        if (!live()) return;
        this.reconnecting = false;
        this.fail(generation, lastError);
    }

    private applyVolumes(): void {
        const active = this.active;
        if (!active) return;
        for (const p of active.media.snapshot().participants) {
            const volume = this.volumes.get(parseIdentity(p.identity).userId);
            if (volume !== undefined) active.media.setVolume(p.identity, volume);
        }
    }

    private publishFromMedia(): void {
        const active = this.active;
        if (!active) return;
        const snapshot = active.media.snapshot();
        this.applyVolumes();
        this.publish({
            roomId: active.roomId,
            state: this.reconnecting ? "reconnecting" : stateOf(snapshot),
            error: null,
            participants: snapshot.participants.map(toParticipant),
            // Local is first in the snapshot. Before it exists, the camera we asked for.
            camera: snapshot.participants[0]?.camera ?? this.camera,
            screen: snapshot.participants[0]?.screen ?? false,
        });
    }

    private publish(view: Pick<VoiceView, "roomId" | "state" | "error" | "participants"> & Partial<Pick<VoiceView, "camera" | "screen">>): void {
        this.feed.set({ ...view, camera: view.camera ?? this.camera, screen: view.screen ?? false, muted: this.muted, deafened: this.deafened });
    }

    private publishRooms(): void {
        const next: Record<string, string[]> = {};
        for (const room of this.client.getRooms()) {
            const session = this.client.matrixRTC.getActiveRoomSession(room);
            const users = session?.memberships.filter((m) => !m.isExpired()).map((m) => m.userId) ?? [];
            if (users.length > 0) next[room.roomId] = users;
        }
        this.roomsFeed.set(next);
    }
}

function stateOf(snapshot: MediaSnapshot): VoiceView["state"] {
    switch (snapshot.connection) {
        case "connected":
            return "connected";
        case "reconnecting":
            return "reconnecting";
        case "disconnected":
            return "error";
        default:
            return "connecting";
    }
}

function toParticipant(p: MediaSnapshot["participants"][number]): VoiceParticipant {
    const { userId, deviceId } = parseIdentity(p.identity);
    return { userId, deviceId, speaking: p.speaking, muted: p.muted, camera: p.camera, screen: p.screen, screenAudio: p.screenAudio };
}

/**
 * A sentence for the voice bar. The SDK wraps a server refusal several layers
 * deep ("The MembershipManager shut down because of the end condition:
 * M_FORBIDDEN: MatrixError: [403] … (http://…/state/…)"), and a MatrixError's
 * `message` embeds the request URL. So walk the `cause` chain to the Matrix
 * error and say what it means; the raw error goes to the console instead.
 */
export function describeVoiceError(error: unknown): string {
    let current: unknown = error;
    for (let depth = 0; current != null && depth < 8; depth++) {
        if ((current as { errcode?: unknown }).errcode === "M_FORBIDDEN") {
            return "You don't have permission to join calls in this room. A room admin can turn on “Members can join calls” in room settings.";
        }
        current = (current as { cause?: unknown }).cause;
    }
    // Voice's own failures (no focus, a refused SFU token) are already
    // diagnostic sentences written here; only request failures need translating.
    return describeError(error, "Couldn't join the call", { verbatimOwn: true });
}

/**
 * Both discovery routes failed and there is nothing to borrow, so say WHICH
 * requests were made and how each answered. A bare "does not advertise
 * MatrixRTC" hid a well-known 404 and a network failure identically.
 */
function noFocus(discovery: FocusDiscovery): string {
    const asked = discovery.attempts.map((a) => `${a.asked} → ${a.error ?? "ok"}`).join("; ");
    return `This homeserver does not advertise MatrixRTC calling (MSC4143), and the room's call has no focus to join, so voice is not available here. Tried ${asked}.`;
}
