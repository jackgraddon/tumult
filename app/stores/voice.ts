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
import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Focus type definitions (MSC4143)
// ---------------------------------------------------------------------------

interface Focus {
    type: string;
    [key: string]: any;
}

interface LiveKitFocus extends Focus {
    type: 'livekit';
    livekit_service_url: string;
    uri?: string;
    livekit_alias?: string;
}

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
// LiveKit transport with Rust E2EE
// ---------------------------------------------------------------------------

async function buildLivekitWorkerWithRust(activeRoomId: string): Promise<Worker> {
    const workerUrl = new URL('livekit-client/e2ee-worker', import.meta.url).href;
    const workerCode = await (await fetch(workerUrl)).text();

    // Patch LiveKit worker to call Rust backend for encryption/decryption
    const patchCode = `
        const _activeRoomId = "${activeRoomId}";

        // Mock WebCrypto to intercept calls
        const _originalImportKey = crypto.subtle.importKey;
        crypto.subtle.importKey = async function(format, keyData, algo, extractable, keyUsages) {
             return _originalImportKey.call(crypto.subtle, format, keyData, algo, true, keyUsages);
        };

        const _originalEncrypt = crypto.subtle.encrypt;
        crypto.subtle.encrypt = async function(algo, key, data) {
            if (algo.name === 'AES-GCM' || algo.name === 'AES-CTR') {
                try {
                   const ciphertext = await self.rpcCall('encrypt_media_frame', {
                       callId: _activeRoomId,
                       participantId: self.participantId,
                       plaintext: Array.from(new Uint8Array(data)),
                       iv: Array.from(new Uint8Array(algo.counter || algo.iv || 16)),
                       frameType: 'media'
                   });
                   return new Uint8Array(ciphertext).buffer;
                } catch (e) {
                   console.error('Rust encryption failed', e);
                }
            }
            return _originalEncrypt.call(crypto.subtle, algo, key, data);
        };

        const _originalDecrypt = crypto.subtle.decrypt;
        crypto.subtle.decrypt = async function(algo, key, data) {
             if (algo.name === 'AES-GCM' || algo.name === 'AES-CTR') {
                try {
                   const plaintext = await self.rpcCall('decrypt_media_frame', {
                       callId: _activeRoomId,
                       participantId: algo.additionalData?.participantId || self.participantId, // Fallback logic depends on LK implementation
                       ciphertext: Array.from(new Uint8Array(data)),
                       iv: Array.from(new Uint8Array(algo.counter || algo.iv || 16))
                   });
                   return new Uint8Array(plaintext).buffer;
                } catch (e) {
                   console.error('Rust decryption failed', e);
                }
            }
            return _originalDecrypt.call(crypto.subtle, algo, key, data);
        };

        // Simplified RPC mechanism to communicate back to the main thread for Tauri invoke
        self.rpcCall = function(method, args) {
            return new Promise((resolve, reject) => {
                const id = Math.random().toString(36).slice(2);
                self.postMessage({ type: 'rpc_request', id, method, args });

                const handler = (e) => {
                    if (e.data.type === 'rpc_response' && e.data.id === id) {
                        self.removeEventListener('message', handler);
                        if (e.data.error) reject(e.data.error);
                        else resolve(e.data.result);
                    }
                };
                self.addEventListener('message', handler);
            });
        };
    `;

    const blobUrl = URL.createObjectURL(
        new Blob([patchCode + '\n' + workerCode], { type: 'application/javascript' })
    );
    const worker = new Worker(blobUrl);

    // Handle RPC requests from the worker
    worker.onmessage = async (e) => {
        if (e.data.type === 'rpc_request') {
            const { id, method, args } = e.data;
            try {
                const result = await (window as any).__TAURI_INTERNALS__.invoke(method, args);
                worker.postMessage({ type: 'rpc_response', id, result });
            } catch (error) {
                worker.postMessage({ type: 'rpc_response', id, error: String(error) });
            }
        }
    };

    URL.revokeObjectURL(blobUrl);
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

    const worker = await buildLivekitWorkerWithRust(room.roomId);

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
                        throw permErr;
                    }
                }

                const crypto = matrixStore.client?.getCrypto();
                if (crypto) {
                    const memberIds = room.getJoinedMembers().map(m => m.userId);
                    if (memberIds.length > 0) await crypto.getUserDeviceInfo(memberIds, true);
                }

                const rtcSession = matrixStore.client?.matrixRTC.getRoomSession(room);
                if (!rtcSession) throw new Error('Failed to get MatrixRTC session');

                const userId = matrixStore.client!.getUserId()!;

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

                const activeFocusForSdk: Focus | undefined = isFirstToJoin ? foci[0] : undefined;

                try {
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
                }

                const { lkRoom, keyProvider } = await connectToFocus(
                    foci,
                    room,
                    matrixStore.client!
                );

                const encKeyEvent =
                    (MatrixRTCSessionEvent as any).EncryptionKeyChanged ?? 'encryption_key_changed';

                const onKeyChanged = async (
                    keyBin: Uint8Array,
                    keyIndex: number,
                    _membership: any,
                    participantId: string
                ) => {
                    try {
                        // Pass Megolm keys to Rust backend
                        await invoke('initialize_call_encryption', {
                            callId: room.roomId,
                            participantId,
                            encryptionContext: JSON.stringify({
                                key: Array.from(keyBin.slice(0, 32))
                            })
                        });

                        (keyProvider as any).onSetEncryptionKey(keyBin, participantId, keyIndex);
                        console.log(`[Voice] E2EE key bridged for ${participantId} (idx ${keyIndex}) via Rust`);
                    } catch (e) {
                        console.error('[Voice] E2EE key bridge/Rust init failed:', e);
                    }
                };

                this._rtcSession = rtcSession;
                this._encryptionKeyHandler = onKeyChanged;
                (rtcSession as any).on(encKeyEvent, onKeyChanged);

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

            if (this.lkRoom) {
                if (this._onDisconnected) {
                    this.lkRoom.off(LKRoomEvent.Disconnected, this._onDisconnected);
                    this._onDisconnected = null;
                }
                await this.lkRoom.disconnect();
                this.lkRoom = null;
            }

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
