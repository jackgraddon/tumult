import type { Room, RemoteParticipant } from "livekit-client";

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
        // Voice only: the SFU gains nothing from adaptive video, and the default
        // dynacast would try to negotiate layers for tracks we never publish.
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const listeners = new Set<() => void>();
    const notify = (): void => listeners.forEach((listener) => listener());
    let deafened = false;
    const volumes = new Map<string, number>();
    const elements = new Map<string, HTMLMediaElement[]>();
    let connection: MediaConnection = "connecting";

    const applyAudio = (identity: string): void => {
        for (const element of elements.get(identity) ?? []) {
            element.muted = deafened;
            element.volume = volumes.get(identity) ?? 1;
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
    ] as const;
    for (const event of events) room.on(event, notify);

    room.on(lk.RoomEvent.TrackSubscribed, (track, _publication, participant: RemoteParticipant) => {
        if (track.kind !== lk.Track.Kind.Audio) return;
        // A detached <audio> still plays, so core never touches the DOM.
        const element = track.attach();
        elements.set(participant.identity, [...(elements.get(participant.identity) ?? []), element]);
        applyAudio(participant.identity);
        notify();
    });
    room.on(lk.RoomEvent.TrackUnsubscribed, (track, _publication, participant: RemoteParticipant) => {
        if (track.kind !== lk.Track.Kind.Audio) return;
        track.detach();
        elements.delete(participant.identity);
        notify();
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
        async setMicrophone(enabled) {
            await room.localParticipant.setMicrophoneEnabled(enabled);
            notify();
        },
        setKey: (identity, index, key) => keyProvider.setRaw(identity, index, key),
        setDeafened(next) {
            deafened = next;
            for (const identity of elements.keys()) applyAudio(identity);
        },
        setVolume(identity, volume) {
            volumes.set(identity, volume);
            applyAudio(identity);
        },
        snapshot() {
            const local = room.localParticipant;
            const participants: MediaParticipant[] = [
                { identity: local.identity, speaking: local.isSpeaking, muted: !local.isMicrophoneEnabled },
                ...[...room.remoteParticipants.values()].map((p) => ({
                    identity: p.identity,
                    speaking: p.isSpeaking,
                    muted: !p.isMicrophoneEnabled,
                })),
            ];
            return { connection, participants };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
