import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import {
    Room as LiveKitRoom,
    RoomEvent as LKRoomEvent,
    BaseKeyProvider as BaseE2EEKeyProvider,
} from 'livekit-client';
import type { Room } from 'matrix-js-sdk';
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { toast } from 'vue-sonner';

// ---------------------------------------------------------------------------
// Focus type definitions (MSC4143)
//
// The spec defines a focus as having a `type` field. Fields beyond that are
// transport-specific. We only implement `livekit` today, but the architecture
// is open — adding a new SFU type means adding a case to connectToFocus()
// without touching the MatrixRTC signalling layer above it.
// ---------------------------------------------------------------------------

interface Focus {
    type: string;
    [key: string]: any;
}

interface LiveKitFocus extends Focus {
    type: 'livekit';
    livekit_service_url: string; // URL of the livekit-jwt service
    uri?: string;                // wss:// URL of the LiveKit SFU itself
    livekit_alias?: string;
}

// ---------------------------------------------------------------------------
// Focus selection — MSC4143 oldest_membership algorithm
//
// When multiple members are in a call, they must all connect to the same
// focus. The spec says the focus advertised by the *oldest* membership event
// (lowest createdTs) is authoritative. This prevents split-brain where two
// clients independently pick different foci from the same list.
//
// If no existing members have a focus (we are first to join), fall back to
// .well-known discovery then a hard-coded default.
// ---------------------------------------------------------------------------

function selectFociFromMemberships(memberships: any[]): Focus[] {
    const sorted = [...memberships].sort((a, b) => {
        const tsA = a.createdTs?.() ?? Infinity;
        const tsB = b.createdTs?.() ?? Infinity;
        return tsA - tsB;
    });

    for (const m of sorted) {
        const content = m.getCallMemberEvent?.()?.getContent?.();
        if (Array.isArray(content?.foci_active) && content.foci_active.length > 0) {
            return content.foci_active as Focus[];
        }
    }

    return [];
}

async function discoverFociFromWellKnown(userId: string): Promise<Focus[]> {
    const domain = userId.split(':')[1];
    if (!domain) return [];

    try {
        const res = await fetch(`https://${domain}/.well-known/matrix/client`);
        if (!res.ok) return [];

        const wellKnown = await res.json();
        const rtcFoci = wellKnown?.['org.matrix.msc4143.rtc_foci'];

        // Return ALL foci in declared order — do not filter by type here.
        // Unknown types are skipped in the transport dispatch layer.
        if (Array.isArray(rtcFoci) && rtcFoci.length > 0) {
            console.log('[Voice] Discovered foci from .well-known:', rtcFoci);
            return rtcFoci as Focus[];
        }
    } catch (e) {
        console.warn('[Voice] .well-known fetch failed:', e);
    }

    return [];
}

// ---------------------------------------------------------------------------
// LiveKit transport
//
// Everything in this section is LiveKit-specific. It must not bleed into the
// MatrixRTC signalling layer above it. The spec does not mandate LiveKit —
// it is one valid focus type defined in MSC4143.
// ---------------------------------------------------------------------------

async function buildLivekitWorker(): Promise<Worker> {
    // LiveKit's E2EE worker creates non-extractable WebCrypto keys by default.
    // On macOS/WebKit (including Tauri), non-extractable keys are persisted to
    // the system Keychain, triggering a password prompt on every call.
    //
    // Fix: patch importKey to leave HKDF/PBKDF2 alone (WebKit hard-prohibits
    // these from being extractable) and patch deriveKey to force the *output*
    // AES key extractable so it stays in-memory only, bypassing the Keychain.
    const workerUrl = new URL('livekit-client/e2ee-worker', import.meta.url).href;
    console.log('[Voice] Fetching E2EE worker from:', workerUrl);
    const workerRes = await fetch(workerUrl);
    if (!workerRes.ok) {
        throw new Error(`Failed to fetch E2EE worker: ${workerRes.status} ${workerRes.statusText}`);
    }
    const workerCode = await workerRes.text();

    const patchCode = `
        const _NON_EXTRACTABLE_ALGOS = new Set(['HKDF', 'PBKDF2']);

        const _algoName = (algo) =>
            (typeof algo === 'string' ? algo : (algo && algo.name) || '').toUpperCase();

        const _originalImportKey = crypto.subtle.importKey;
        crypto.subtle.importKey = function(format, keyData, algo, extractable, keyUsages) {
            const forceExtractable = !_NON_EXTRACTABLE_ALGOS.has(_algoName(algo));
            return _originalImportKey.call(
                crypto.subtle, format, keyData, algo,
                forceExtractable ? true : extractable,
                keyUsages
            );
        };

        const _originalDeriveKey = crypto.subtle.deriveKey;
        crypto.subtle.deriveKey = function(algo, baseKey, derivedKeyType, extractable, keyUsages) {
            // Force the derived AES key extractable — this is the key that
            // would otherwise be persisted to the macOS Keychain.
            return _originalDeriveKey.call(
                crypto.subtle, algo, baseKey, derivedKeyType, true, keyUsages
            );
        };
    `;

    const blobUrl = URL.createObjectURL(
        new Blob([patchCode + '\n' + workerCode], { type: 'application/javascript' })
    );
    const worker = new Worker(blobUrl);
    // DO NOT revoke immediately on some browsers/Tauri versions as it might
    // cause issues if the worker isn't fully initialized.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    return worker;
}

async function connectLivekitTransport(
    focus: LiveKitFocus,
    room: Room,
    matrixClient: any
): Promise<{ lkRoom: LiveKitRoom; keyProvider: BaseE2EEKeyProvider }> {
    const deviceId = matrixClient.getDeviceId()!;
    const openIdToken = await matrixClient.getOpenIdToken();

    console.log(`[Voice/LiveKit] Fetching JWT from ${focus.livekit_service_url}`);
    const response = await fetch(`${focus.livekit_service_url}/sfu/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            room: room.roomId,
            device_id: deviceId,
            openid_token: openIdToken,
        }),
    });

    if (!response.ok) throw new Error(`LiveKit JWT fetch failed: ${response.statusText}`);
    const { url: lkUrl, jwt } = await response.json();

    const keyProvider = new BaseE2EEKeyProvider({
        sharedKey: false,
        ratchetWindowSize: 0,
        failureTolerance: -1,
    });

    const worker = await buildLivekitWorker();

    const lkRoom = new LiveKitRoom({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { red: true, dtx: true, simulcast: true },
        audioCaptureDefaults: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
        },
        videoCaptureDefaults: { facingMode: 'user' },
        encryption: { keyProvider, worker },
    });

    await lkRoom.connect(lkUrl, jwt);
    console.log(`[Voice/LiveKit] Connected. Remote participants: ${lkRoom.remoteParticipants.size}`);

    return { lkRoom, keyProvider };
}

// ---------------------------------------------------------------------------
// Transport dispatch
//
// Iterates the focus list in order, skipping types we don't support, and
// connects to the first one that succeeds. Add new focus type cases here as
// the spec evolves — the MatrixRTC layer above doesn't need to change.
// ---------------------------------------------------------------------------

async function connectToFocus(
    foci: Focus[],
    room: Room,
    matrixClient: any
): Promise<{ lkRoom: LiveKitRoom; keyProvider: BaseE2EEKeyProvider; activeFocus: Focus }> {
    for (const focus of foci) {
        if (focus.type === 'livekit') {
            const { lkRoom, keyProvider } = await connectLivekitTransport(
                focus as LiveKitFocus,
                room,
                matrixClient
            );
            return { lkRoom, keyProvider, activeFocus: focus };
        }

        console.warn(`[Voice] Unsupported focus type "${focus.type}", trying next`);
    }

    throw new Error(
        `No supported focus type in list: ${foci.map(f => f.type).join(', ')}`
    );
}

// ---------------------------------------------------------------------------
// Pinia store
// ---------------------------------------------------------------------------

export const useVoiceStore = defineStore('voice', {
    state: () => ({
        activeRoomId: null as string | null,
        lkRoom: null as LiveKitRoom | null,
        isConnecting: false,
        isConnected: false,
        isMicEnabled: false,
        isCameraEnabled: false,
        error: null as string | null,
        connectingRoomId: null as string | null,
        _onDisconnected: null as (() => void) | null,
        _rtcSession: null as any,
        _encryptionKeyHandler: null as any,
    }),

    actions: {
        async joinVoiceRoom(room: Room) {
            if (this.activeRoomId === room.roomId) return;
            if (this.activeRoomId) await this.leaveVoiceRoom();

            this.isConnecting = true;
            this.connectingRoomId = room.roomId;
            this.error = null;
            const matrixStore = useMatrixStore();

            try {
                console.log(`[Voice] Joining room ${room.roomId}`);

                // --- Microphone permission -----------------------------------------
                //
                // getUserMedia is what triggers the macOS permission dialog.
                // startAudio() only unlocks the Web Audio *playback* context.
                //
                // If denied, degrade to listen-only — the call UI still renders and
                // the user can hear others. They can grant permission later in
                // System Settings → Privacy & Security → Microphone.
                //
                // If this always denies without a dialog on first launch, the app
                // bundle is missing com.apple.security.device.audio-input in
                // entitlements.plist — macOS silently rejects without prompting.
                let hasMicPermission = false;
                try {
                    const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    permStream.getTracks().forEach(t => t.stop());
                    hasMicPermission = true;
                    console.log('[Voice] Microphone permission granted');
                } catch (permErr: any) {
                    if (permErr?.name === 'NotAllowedError') {
                        console.warn('[Voice] Microphone access denied — joining in listen-only mode');
                        toast.warning('Microphone access denied', {
                            description: 'You can listen but cannot speak. To enable your mic, go to System Settings → Privacy & Security → Microphone.',
                            duration: 8000,
                        });
                    } else {
                        throw permErr; // Device busy, hardware failure — abort
                    }
                }

                // --- MatrixRTC signalling (spec layer) ----------------------------

                // Pre-fetch device keys so E2EE key distribution doesn't fail
                // with "No targets found for sending key".
                const crypto = matrixStore.client?.getCrypto();
                if (crypto) {
                    const memberIds = room.getJoinedMembers().map(m => m.userId);
                    if (memberIds.length > 0) await crypto.getUserDeviceInfo(memberIds, true);
                }

                const rtcSession = matrixStore.client?.matrixRTC.getRoomSession(room);
                if (!rtcSession) throw new Error('Failed to get MatrixRTC session');

                const userId = matrixStore.client!.getUserId()!;

                // Focus selection — oldest_membership algorithm (MSC4143).
                // Read foci from the oldest existing membership (joining an active call),
                // then fall back to .well-known (first to join), then a hard default.
                let foci: Focus[] = selectFociFromMemberships(rtcSession.memberships ?? []);
                const isFirstToJoin = foci.length === 0;

                if (isFirstToJoin) foci = await discoverFociFromWellKnown(userId);

                if (foci.length === 0) {
                    console.warn('[Voice] No foci found — using matrix.org fallback');
                    foci = [{
                        type: 'livekit',
                        livekit_service_url: 'https://livekit-jwt.call.matrix.org',
                        uri: 'wss://livekit.call.matrix.org',
                        livekit_alias: 'default',
                    }];
                }

                // When first to join, declare the active focus so other clients can
                // use oldest_membership to find it. When joining an existing call,
                // pass undefined — the SDK derives activeFocus from oldest_membership
                // internally, preventing split-brain.
                const activeFocusForSdk: Focus | undefined = isFirstToJoin ? foci[0] : undefined;

                try {
                    // SDK v41 4-arg signature:
                    //   joinRTCSession(membershipData, fociPreferred, activeFocus?, opts?)
                    const membershipData = {
                        userId: matrixStore.client!.getUserId()!,
                        deviceId: matrixStore.client!.getDeviceId()!,
                        memberId: `${matrixStore.client!.getUserId()}:${matrixStore.client!.getDeviceId()}`,
                    };

                    rtcSession.joinRTCSession(
                        membershipData,
                        foci,
                        activeFocusForSdk,
                        {
                            manageMediaKeys: true,
                            membershipEventExpiryMs: 120000,
                            delayedLeaveEventRestartMs: 3000,
                            delayedLeaveEventDelayMs: 8000,
                        }
                    );
                    console.log('[Voice] MatrixRTC session joined');
                } catch (e) {
                    console.error('[Voice] joinRTCSession failed:', e);
                    // Don't throw — transport can still connect and the session
                    // will self-heal on the next membership event.
                }

                // --- Transport layer (LiveKit-specific) ---------------------------

                const { lkRoom, keyProvider } = await connectToFocus(
                    foci,
                    room,
                    matrixStore.client!
                );

                // Bridge MatrixRTC E2EE keys into the LiveKit key provider.
                // MatrixRTC distributes keys via to-device messages (manageMediaKeys: true).
                // We forward each key to LiveKit as it arrives.
                const encKeyEvent =
                    (MatrixRTCSessionEvent as any).EncryptionKeyChanged ?? 'encryption_key_changed';

                const onKeyChanged = (
                    keyBin: Uint8Array,
                    keyIndex: number,
                    _membership: any,
                    participantId: string
                ) => {
                    try {
                        (keyProvider as any).onSetEncryptionKey(keyBin, participantId, keyIndex);
                        console.log(`[Voice] E2EE key bridged for ${participantId} (idx ${keyIndex})`);
                    } catch (e) {
                        console.error('[Voice] E2EE key bridge failed:', e);
                    }
                };

                this._rtcSession = rtcSession;
                this._encryptionKeyHandler = onKeyChanged;
                (rtcSession as any).on(encKeyEvent, onKeyChanged);

                // Re-emit any keys that were distributed before we subscribed
                // (covers the case where we join after other members already set keys)
                if (typeof (rtcSession as any).reemitEncryptionKeys === 'function') {
                    (rtcSession as any).reemitEncryptionKeys();
                }

                await lkRoom.startAudio();
                if (hasMicPermission) {
                    await lkRoom.localParticipant.setMicrophoneEnabled(true);
                    this.isMicEnabled = true;
                }

                this.lkRoom = markRaw(lkRoom);
                this.activeRoomId = room.roomId;
                this.connectingRoomId = null;
                this.isConnected = true;

                this._onDisconnected = () => {
                    console.log('[Voice] LiveKit disconnected unexpectedly');
                    this.leaveVoiceRoom();
                };
                lkRoom.on(LKRoomEvent.Disconnected, this._onDisconnected);
                lkRoom.on(LKRoomEvent.LocalTrackPublished, () => {
                    this.isMicEnabled = lkRoom.localParticipant.isMicrophoneEnabled;
                    this.isCameraEnabled = lkRoom.localParticipant.isCameraEnabled;
                });

                toast.success('Joined voice call');

            } catch (e: any) {
                console.error('[Voice] Failed to join:', e);
                this.error = e.message;
                toast.error('Failed to join call');
                if (this.activeRoomId) this.leaveVoiceRoom();
            } finally {
                this.isConnecting = false;
            }
        },

        async leaveVoiceRoom() {
            if (!this.activeRoomId && !this.connectingRoomId) return;

            const roomId = this.activeRoomId || this.connectingRoomId;
            const matrixStore = useMatrixStore();
            const room = matrixStore.client?.getRoom(roomId!);

            console.log(`[Voice] Leaving room ${roomId}`);

            // 1. Leave MatrixRTC FIRST — the state event must be sent while
            //    the HTTP connection is still alive.
            if (room) {
                try {
                    const rtcSession = matrixStore.client?.matrixRTC.getRoomSession(room);
                    if (rtcSession) {
                        const left = await rtcSession.leaveRoomSession(3000);
                        if (!left) console.warn('[Voice] leaveRoomSession timed out');
                        else console.log('[Voice] MatrixRTC leave confirmed');
                    }
                } catch (e) {
                    console.warn('[Voice] Failed to leave MatrixRTC session:', e);
                } finally {
                    matrixStore.hierarchyTrigger++;
                }
            }

            // 2. Remove disconnect listener BEFORE disconnecting to prevent
            //    leaveVoiceRoom being called recursively.
            if (this.lkRoom) {
                if (this._onDisconnected) {
                    this.lkRoom.off(LKRoomEvent.Disconnected, this._onDisconnected);
                    this._onDisconnected = null;
                }
                await this.lkRoom.disconnect();
                this.lkRoom = null;
            }

            // 3. Clean up E2EE key listener.
            if (this._rtcSession && this._encryptionKeyHandler) {
                const encKeyEvent =
                    (MatrixRTCSessionEvent as any).EncryptionKeyChanged ?? 'encryption_key_changed';
                (this._rtcSession as any).off(encKeyEvent, this._encryptionKeyHandler);
                this._rtcSession = null;
                this._encryptionKeyHandler = null;
            }

            this.activeRoomId = null;
            this.connectingRoomId = null;
            this.isConnecting = false;
            this.isConnected = false;
            this.isMicEnabled = false;
            this.isCameraEnabled = false;
            this.error = null;

            matrixStore.hierarchyTrigger++;
        },

        async toggleMic() {
            if (!this.lkRoom) return;
            const enabled = !this.isMicEnabled;
            await this.lkRoom.localParticipant.setMicrophoneEnabled(enabled);
            this.isMicEnabled = enabled;
        },

        async toggleCamera() {
            if (!this.lkRoom) return;
            const enabled = !this.isCameraEnabled;
            await this.lkRoom.localParticipant.setCameraEnabled(enabled);
            this.isCameraEnabled = enabled;
        },

        async clearStaleMemberships() {
            const matrixStore = useMatrixStore();
            if (!matrixStore.client) return;

            const userId = matrixStore.client.getUserId();
            const rooms = matrixStore.client.getRooms();
            const rtcTypes = [
                'org.matrix.msc4143.rtc.member',
                'org.matrix.msc3401.call.member',
                'm.rtc.member',
            ];

            for (const room of rooms) {
                for (const type of rtcTypes) {
                    const events = room.currentState.getStateEvents(type as any);
                    for (const event of events) {
                        if (event.getSender() !== userId) continue;
                        const content = event.getContent();
                        if (!content || Object.keys(content).length === 0) continue;

                        console.log(`[Voice] Clearing stale ${type} in ${room.roomId}`);
                        try {
                            await matrixStore.client.sendStateEvent(
                                room.roomId, type as any, {}, event.getStateKey()
                            );
                        } catch (e) {
                            console.warn('[Voice] Failed to clear stale membership:', e);
                        }
                    }
                }
            }
        },
    },
});