import type { Room, RemoteParticipant, Track } from "livekit-client";

import type { VoiceSettings } from "../contract.ts";

/**
 * What the voice manager needs from a media engine, as the narrowest surface
 * that lets the manager's logic be tested without LiveKit. The one real
 * implementation is {@link createLiveKitMedia}; tests supply a fake.
 *
 * A participant is named by its LiveKit identity, which the JWT service sets to
 * `<user_id>:<device_id>` (see {@link parseIdentity}).
 */
export interface VoiceMedia {
    connect(url: string, jwt: string): Promise<void>;
    disconnect(): void;
    setMicrophone(enabled: boolean): Promise<void>;
    /**
     * How the microphone is processed. Applies to the next capture, and to the
     * live one if there is one (the microphone is re-opened under the new
     * constraints, so a call does not have to be left and rejoined).
     */
    setProcessing(settings: VoiceSettings): Promise<void>;
    setCamera(enabled: boolean): Promise<void>;
    setScreenShare(enabled: boolean): Promise<void>;
    /**
     * Render a participant's live video track into `element`; returns the
     * detach. Does nothing (and returns a no-op) when there is no such track.
     */
    attachVideo(identity: string, source: "camera" | "screen", element: HTMLVideoElement): () => void;
    /** Hand the media layer a per-participant frame key from the MatrixRTC session. */
    setKey(identity: string, index: number, key: Uint8Array): Promise<void>;
    /** Silence (or restore) all remote audio locally. */
    setDeafened(deafened: boolean): void;
    /** Local playback volume for one participant identity, 0..1. Idempotent. */
    setVolume(identity: string, volume: number): void;
    snapshot(): MediaSnapshot;
    /** `listener` runs after any change to the snapshot; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

export type MediaConnection = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface MediaParticipant {
    identity: string;
    speaking: boolean;
    muted: boolean;
    /** A camera track exists, is not muted, and can be attached. */
    camera: boolean;
    /** A screen-share track exists, is not muted, and can be attached. */
    screen: boolean;
    /** A screen share's audio track exists and is not muted. */
    screenAudio: boolean;
}

export interface MediaSnapshot {
    connection: MediaConnection;
    /** Local participant first, then remotes in the order they connected. */
    participants: MediaParticipant[];
}

export interface LiveKitMediaOptions {
    /** Builds the worker LiveKit encrypts and decrypts frames in. */
    createE2EEWorker: () => Promise<Worker>;
}

/** `<user_id>:<device_id>`; a user id contains `:`, a device id never does. */
export function parseIdentity(identity: string): { userId: string; deviceId: string } {
    const at = identity.lastIndexOf(":");
    return at < 0 ? { userId: identity, deviceId: "" } : { userId: identity.slice(0, at), deviceId: identity.slice(at + 1) };
}

/**
 * The LiveKit-backed media engine. `livekit-client` is `import()`ed here and
 * nowhere else in core, so the fake client's bundle (and the main chunk of the
 * real one) never carries it — it loads on the first join.
 */
export async function createLiveKitMedia(options: LiveKitMediaOptions): Promise<VoiceMedia> {
    const lk = await import("livekit-client");

    // `onSetEncryptionKey` is protected: a subclass is the only way in, and it is
    // the same seam LiveKit documents for an external key source.
    class MatrixKeyProvider extends lk.BaseKeyProvider {
        public constructor() {
            super({ ratchetWindowSize: 10, keyringSize: 256 });
        }
        public async setRaw(identity: string, index: number, key: Uint8Array): Promise<void> {
            const material = await crypto.subtle.importKey("raw", key as BufferSource, "HKDF", false, ["deriveBits", "deriveKey"]);
            this.onSetEncryptionKey(material, identity, index);
        }
    }

    const keyProvider = new MatrixKeyProvider();
    const worker = await options.createE2EEWorker();
    const room: Room = new lk.Room({
        e2ee: { keyProvider, worker },
        // A tile that is small or off-screen asks the SFU for a smaller layer
        // (or none), sized from the element it is attached to; dynacast stops
        // publishing layers nobody subscribes to.
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { simulcast: true },
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const trackSource = (source: "camera" | "screen"): Track.Source =>
        source === "camera" ? lk.Track.Source.Camera : lk.Track.Source.ScreenShare;
    /** A track we can draw: published, not muted, and (for a remote) subscribed. */
    const live = (p: { getTrackPublication(source: Track.Source): { track?: unknown; isMuted: boolean } | undefined }, source: Track.Source): boolean => {
        const publication = p.getTrackPublication(source);
        return publication?.track != null && !publication.isMuted;
    };

    const listeners = new Set<() => void>();
    const notify = (): void => listeners.forEach((listener) => listener());
    let deafened = false;
    /** The muted microphone was captured under older processing settings. */
    let staleCapture = false;
    const volumes = new Map<string, number>();
    // Keyed by TRACK, not participant: one person can have a microphone and a
    // screen-share audio track at once, and dropping one must not drop the other.
    const elements = new Map<string, { identity: string; element: HTMLMediaElement }>();
    let connection: MediaConnection = "connecting";

    const applyAudio = (identity?: string): void => {
        for (const entry of elements.values()) {
            if (identity !== undefined && entry.identity !== identity) continue;
            entry.element.muted = deafened;
            entry.element.volume = volumes.get(entry.identity) ?? 1;
        }
    };

    const events = [
        lk.RoomEvent.ParticipantConnected,
        lk.RoomEvent.ParticipantDisconnected,
        lk.RoomEvent.ActiveSpeakersChanged,
        lk.RoomEvent.TrackMuted,
        lk.RoomEvent.TrackUnmuted,
        lk.RoomEvent.LocalTrackPublished,
        lk.RoomEvent.LocalTrackUnpublished,
        // A remote video track is only attachable once subscribed, and the
        // snapshot's camera/screen flags wait for that.
        lk.RoomEvent.TrackSubscribed,
        lk.RoomEvent.TrackUnsubscribed,
    ] as const;
    for (const event of events) room.on(event, notify);

    room.on(lk.RoomEvent.TrackSubscribed, (track, _publication, participant: RemoteParticipant) => {
        if (track.kind !== lk.Track.Kind.Audio) return;
        // A detached <audio> still plays, so core never touches the DOM.
        const element = track.attach();
        elements.set(track.sid ?? `${participant.identity}:${elements.size}`, { identity: participant.identity, element });
        applyAudio(participant.identity);
    });
    room.on(lk.RoomEvent.TrackUnsubscribed, (track, _publication, participant: RemoteParticipant) => {
        if (track.kind !== lk.Track.Kind.Audio) return;
        track.detach();
        elements.delete(track.sid ?? "");
    });
    room.on(lk.RoomEvent.ConnectionStateChanged, (state) => {
        connection =
            state === lk.ConnectionState.Connected
                ? "connected"
                : state === lk.ConnectionState.Disconnected
                  ? "disconnected"
                  : state === lk.ConnectionState.Connecting
                    ? "connecting"
                    : "reconnecting";
        notify();
    });

    return {
        async connect(url, jwt) {
            await room.connect(url, jwt);
            await room.setE2EEEnabled(true);
            // Autoplay policy: this runs from a user gesture's call chain, and
            // without it remote audio can stay silent with no error.
            await room.startAudio();
        },
        disconnect() {
            for (const event of events) room.off(event, notify);
            void room.disconnect();
            listeners.clear();
            elements.clear();
        },
        async setProcessing(settings) {
            // LiveKit reads these when it next captures; it also reads them for a
            // restart, which is how a live microphone picks them up.
            const defaults = (room.options.audioCaptureDefaults ??= {});
            Object.assign(defaults, settings);
            const track = room.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.audioTrack;
            // A muted track may have its capture released; re-opening it now would
            // light the browser's microphone indicator for someone who is muted.
            // It is flagged and re-opened on unmute instead.
            if (!track) return;
            if (track.isMuted) staleCapture = true;
            else await track.restartTrack({ ...settings });
        },
        async setMicrophone(enabled) {
            if (enabled && staleCapture) {
                staleCapture = false;
                const track = room.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.audioTrack;
                if (track) await track.restartTrack({ ...room.options.audioCaptureDefaults });
            }
            await room.localParticipant.setMicrophoneEnabled(enabled);
            notify();
        },
        async setCamera(enabled) {
            await room.localParticipant.setCameraEnabled(enabled);
            notify();
        },
        async setScreenShare(enabled) {
            // Audio is opt-in in LiveKit: without it a share is silent. It is a
            // different kind of audio from the microphone (music, a game, a video),
            // so the voice processing that suits speech would mangle it, and the
            // call's own audio is kept out of it so others do not hear themselves.
            // Browser support is partial (tab or system audio on Chromium; none on
            // Safari), and a browser that cannot capture it shares video only.
            await room.localParticipant.setScreenShareEnabled(
                enabled,
                enabled
                    ? {
                          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
                          systemAudio: "include",
                      }
                    : undefined,
            );
            // getDisplayMedia hands back video alone when the browser cannot (or the
            // user did not) capture audio, and nothing errors. Say so where it can
            // be found; the snapshot's `screenAudio` is what the UI shows.
            if (enabled && !room.localParticipant.getTrackPublication(lk.Track.Source.ScreenShareAudio)) {
                console.info("[tumult] the screen share has no audio: the browser captured video only");
            }
            notify();
        },
        attachVideo(identity, source, element) {
            const participant = identity === room.localParticipant.identity ? room.localParticipant : room.remoteParticipants.get(identity);
            const track = participant?.getTrackPublication(trackSource(source))?.track;
            if (!track) return () => undefined;
            track.attach(element);
            return () => {
                track.detach(element);
            };
        },
        setKey: (identity, index, key) => keyProvider.setRaw(identity, index, key),
        setDeafened(next) {
            deafened = next;
            applyAudio();
        },
        setVolume(identity, volume) {
            volumes.set(identity, volume);
            applyAudio(identity);
        },
        snapshot() {
            const local = room.localParticipant;
            const describe = (p: typeof local | RemoteParticipant): MediaParticipant => ({
                identity: p.identity,
                speaking: p.isSpeaking,
                muted: !p.isMicrophoneEnabled,
                camera: live(p, lk.Track.Source.Camera),
                screen: live(p, lk.Track.Source.ScreenShare),
                screenAudio: live(p, lk.Track.Source.ScreenShareAudio),
            });
            const participants: MediaParticipant[] = [describe(local), ...[...room.remoteParticipants.values()].map(describe)];
            return { connection, participants };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
