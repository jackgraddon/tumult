import { defineStore } from 'pinia';
import { toast } from 'vue-sonner';
import { markRaw } from 'vue';
import { navigateTo } from '#app';
import * as sdk from 'matrix-js-sdk';
import { OidcTokenRefresher } from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api/CryptoEvent';
import { VerificationRequestEvent, VerificationPhase, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api/verification';
import type { VerificationRequest, Verifier, ShowSasCallbacks } from 'matrix-js-sdk/lib/crypto-api/verification';
import { deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api/key-passphrase';
import { decodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key';
import type { IdTokenClaims } from 'oidc-client-ts';
import { getOidcConfig, registerClient, getLoginUrl, completeLoginFlow, getHomeserverUrl, getDeviceDisplayName } from '~/utils/matrix-auth';
import { MsgType, EventType, IndexedDBStore, IndexedDBCryptoStore, MemoryStore, LocalStorageCryptoStore } from 'matrix-js-sdk';
import { useRouter } from '#app';
import { useVoiceStore } from './voice';
import { MatrixRTCSessionManagerEvents } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSessionManager';
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { isVoiceChannel } from '~/utils/room';
import { useDebounceFn } from '@vueuse/core';
import { setPref, getPref, deletePref, setSecret, getSecret, deleteSecret, deleteSecrets } from '~/composables/useAppStorage';

export interface LastVisitedRooms {
  dm: string | null;
  rooms: string | null;
  spaces: Record<string, string>;
}

export interface UIState {
  memberListVisible: boolean;
  selectedUserId: string | null;
  profileCardPos: { top: string; right: string };
  collapsedCategories: string[];
  showEmptyRooms: boolean;
  // Composer states indexed by roomId
  composerStates: Record<string, {
    replyingTo?: any;
    editingMessage?: any;
    text?: string;
  }>;
  // Sortable sidebar state
  uiOrder: {
    rootSpaces: string[]; // Order of root spaces (pinned + others)
    categories: Record<string, string[]>; // Order of categories per spaceId
    rooms: Record<string, string[]>; // Order of rooms per categoryId
  };
  themePreset: string;
  customCss: string;
  sidebarOpen: boolean;
  contextMenu: {
    type: 'room' | 'message' | 'global' | null;
    data: any;
  };
  _contextMenuHandled: boolean;
  confirmationDialog: {
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
  };
}

// Enhanced HTML for OAuth Loopback Response
const authResponseHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"> <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #111; color: #eee; }
    .card { text-align: center; padding: 2rem; border-radius: 12px; background: #222; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 1px solid #333; max-width: 400px; width: 100%; }
    .success { color: #10b981; }
    .error { color: #ef4444; }
    .hidden { display: none !important; }
    p { color: #aaa; line-height: 1.5; }
    .small { color: #666; font-size: 0.875rem; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="card hidden" id="success-card">
    <h1 class="success">Login Successful</h1>
    <p>You can close this tab and return to the app.</p>
  </div>
  
  <div class="card hidden" id="error-card">
    <h1 class="error">Authentication Failed</h1>
    <p id="error-msg">Access was denied.</p>
    <p class="small">You can close this tab and try again in the app.</p>
  </div>

  <script>
    const params = new URLSearchParams(window.location.search);
    const successCard = document.getElementById('success-card');
    const errorCard = document.getElementById('error-card');
    const errorMsg = document.getElementById('error-msg');
    
    // Check if the URL contains an error parameter
    if (params.has('error')) {
      errorCard.classList.remove('hidden');
      
      // Make the error readable (e.g., 'access_denied' -> 'access denied')
      const rawError = params.get('error').replace(/_/g, ' ');
      const desc = params.get('error_description');
      
      errorMsg.textContent = desc ? desc : "Error: " + rawError;
    } else {
      // Show success and attempt to auto-close
      successCard.classList.remove('hidden');
    }
  </script>
</body>
</html>
`;

/**
 * Subclass of OidcTokenRefresher that persists rotated tokens to the encrypted store (or sessionStorage fallback).
 */
class LocalStorageOidcTokenRefresher extends OidcTokenRefresher {
  protected override async persistTokens(tokens: { accessToken: string; refreshToken?: string }): Promise<void> {
    await setSecret('matrix_access_token', tokens.accessToken);
    if (tokens.refreshToken) {
      await setSecret('matrix_refresh_token', tokens.refreshToken);
    }
  }
}

function generateNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Outside your Pinia store, create a memory cache
const secretStorageKeys = new Map<string, Uint8Array<ArrayBuffer>>();

// Helper to persist keys to localStorage (encoded as Base64)
function persistSecretStorageKey(keyId: string, privateKey: Uint8Array) {
  if (typeof window === 'undefined') return;
  try {
    const base64 = btoa(String.fromCharCode(...privateKey));
    localStorage.setItem(`matrix_ssss_key_${keyId}`, base64);
    console.log(`[SecretStorage] Persisted key ${keyId} to localStorage`);
  } catch (err) {
    console.warn('[SecretStorage] Failed to persist key:', err);
  }
}

// Helper to load persisted keys from localStorage
function loadPersistedSecretStorageKeys() {
  if (typeof window === 'undefined') return;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('matrix_ssss_key_')) {
        const keyId = key.replace('matrix_ssss_key_', '');
        const base64 = localStorage.getItem(key);
        if (base64) {
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }
          secretStorageKeys.set(keyId, bytes as Uint8Array<ArrayBuffer>);
          console.log(`[SecretStorage] Loaded persisted key ${keyId}`);
        }
      }
    }
  } catch (err) {
    console.warn('[SecretStorage] Failed to load persisted keys:', err);
  }
}

export const useMatrixStore = defineStore('matrix', {
  state: () => ({
    client: null as sdk.MatrixClient | null,
    isAuthenticated: false,
    isSyncing: false,
    isClientReady: false,
    isReady: false, // Phase 2: Signal for splash screen transition
    isRestoringSession: true,
    isCryptoDegraded: false,
    cryptoStatusMessage: null as string | null,
    lastSyncError: null as any | null,
    isSasTimeout: false,
    user: null as {
      userId: string;
      displayName?: string;
      avatarUrl?: string;
    } | null,
    // Verification state
    isCrossSigningReady: false,
    isSecretStorageReady: false,
    activeVerificationRequest: null as VerificationRequest | null,
    isVerificationInitiatedByMe: false,
    isRequestingVerification: false,
    activeSas: null as ShowSasCallbacks | null,
    isVerificationCompleted: false,
    isRestoringHistory: false,
    verificationPhase: null as VerificationPhase | null,
    qrCodeData: null as any | null,
    verificationModalOpen: false,
    globalSearchModalOpen: false,
    createRoomModalOpen: false,
    createSpaceModalOpen: false,
    roomSettingsModalOpen: false,
    spaceSettingsModalOpen: false,
    activeSettingsRoomId: null as string | null,
    activeSettingsSpaceId: null as string | null,
    // Secret Storage / Backup Code Verification
    secretStoragePrompt: null as {
      promise: { resolve: (val: [string, Uint8Array<ArrayBuffer>] | null) => void, reject: (err?: any) => void },
      keyId: string,
      keyInfo: any // SecretStorageKeyDescription
    } | null,
    pendingSecretStorageRequests: [] as {
      promise: { resolve: (val: [string, Uint8Array<ArrayBuffer>] | null) => void, reject: (err?: any) => void },
      keyId: string,
      keyInfo: any
    }[],
    secretStorageKeyCache: {} as Record<string, Uint8Array<ArrayBuffer>>,
    secretStorageSetup: null as {
      defaultKeyId: string;
      needsPassphrase: boolean;
      passphraseInfo?: any;
    } | null,
    // Activity Status (Game Detection)
    isGameDetectionEnabled: false,
    activityStatus: null as string | null,
    activityDetails: null as any | null,
    remoteActivityDetails: {} as Record<string, any>,
    appCache: {} as Record<string, { name: string; icon: string | null }>,
    assetCache: {} as Record<string, Record<string, string>>,
    gameDetectionLevel: 'off' as 'off' | 'basic' | 'advanced',
    detectableGames: [] as any[],
    rpcSocket: null as WebSocket | null,
    rpcRetryTimer: null as any | null,

    // Dehydration state
    isDehydrating: false,
    gameTrigger: 0,
    unreadTrigger: 0,
    unreadCountType: sdk.NotificationCountType.Total as sdk.NotificationCountType,
    gameStates: {} as Record<string, any>,
    manualUnread: {} as Record<string, boolean>,
    inviteRoomId: null as string | null,

    customStatus: null as string | null,
    isLoggingIn: false,
    isLoggingOut: false,
    loginStatus: '' as string,
    isRestoringKeys: false,
    isFullySynced: false,

    lastVisitedRooms: { dm: null, rooms: null, spaces: {} } as LastVisitedRooms,
    hierarchyTrigger: 0,
    spaceHierarchies: {} as Record<string, any[]>,
    isIdle: false,
    pinnedSpaces: [] as string[],
    lastPresenceUpdate: 0,
    lastPresenceState: null as { presence: string; status_msg: string } | null,
    directMessageMap: {} as Record<string, string>,
    matrixRTCBoundSessions: new Set<string>(),

    // Centralized UI State
    ui: {
      memberListVisible: false,
      selectedUserId: null,
      profileCardPos: { top: '0px', right: '0px' },
      collapsedCategories: [],
      showEmptyRooms: false,
      composerStates: {},
      uiOrder: { rootSpaces: [], categories: {}, rooms: {} },
      themePreset: 'default',
      customCss: '',
      sidebarOpen: false,
      contextMenu: {
        type: null,
        data: null,
      },
      _contextMenuHandled: false,
      confirmationDialog: {
        isOpen: false,
        title: '',
        description: '',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        onConfirm: () => { },
      },
    } as UIState,
  }),

  getters: {
    isVerificationRequested: (state) => state.verificationPhase === VerificationPhase.Requested,
    isVerificationReady: (state) => state.verificationPhase === VerificationPhase.Ready,
    isVerificationStarted: (state) => state.verificationPhase === VerificationPhase.Started,
    isWaitingForRecoveryKey: (state) => state.isAuthenticated && !state.isCrossSigningReady,
    needsRecoveryKeySetup: (state) => state.isAuthenticated && !state.isSecretStorageReady,
    invites: (state) => {
      if (!state.client) return [];
      return state.client.getVisibleRooms().filter(r => r.getMyMembership() === 'invite');
    },
    totalInviteCount: (state) => {
      if (!state.client) return 0;
      return state.client.getVisibleRooms().filter(r => r.getMyMembership() === 'invite').length;
    },
    totalDmUnreadCount(): number {
      this.unreadTrigger; // trigger reactivity
      if (!this.client) return 0;
      const { directMessages } = (this as any).hierarchy;
      return directMessages.reduce((sum: number, room: any) => {
        const count = room.getUnreadNotificationCount(this.unreadCountType) || 0;
        const manual = (this as any).manualUnread[room.roomId] ? 1 : 0;
        return sum + Math.max(count, manual);
      }, 0);
    },
    totalOrphanRoomUnreadCount(): number {
      this.unreadTrigger; // trigger reactivity
      if (!this.client) return 0;
      const { orphanRooms } = (this as any).hierarchy;
      return orphanRooms.reduce((sum: number, room: any) => {
        const count = room.getUnreadNotificationCount(this.unreadCountType) || 0;
        const manual = (this as any).manualUnread[room.roomId] ? 1 : 0;
        return sum + Math.max(count, manual);
      }, 0);
    },
    getSpaceUnreadCount: (state) => (spaceId: string): number => {
      state.unreadTrigger; // trigger reactivity
      if (!state.client) return 0;

      const roomIds = new Set<string>();
      const queue = [spaceId];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const room = state.client.getRoom(currentId);
        if (!room) continue;

        if (room.isSpaceRoom()) {
          const children = room.currentState.getStateEvents('m.space.child');
          children.forEach(ev => {
            const content = ev.getContent();
            if (content && Array.isArray(content.via) && content.via.length > 0) {
              const childId = ev.getStateKey();
              if (childId) queue.push(childId);
            }
          });
        } else {
          roomIds.add(currentId);
        }
      }

      let total = 0;
      roomIds.forEach(id => {
        const room = state.client?.getRoom(id);
        if (room && (room.getMyMembership() === 'join' || room.getMyMembership() === 'invite')) {
          const count = room.getUnreadNotificationCount(state.unreadCountType) || 0;
          const manual = state.manualUnread[id] ? 1 : 0;
          total += Math.max(count, manual);
        }
      });
      return total;
    },
    getVoiceParticipants: (state) => (roomId: string) => {
      // Access hierarchyTrigger for reactivity
      state.hierarchyTrigger;

      if (!state.client) return [];

      const room = state.client.getRoom(roomId);
      if (!room) return [];

      const rtcSession = state.client.matrixRTC.getRoomSession(room);
      const voiceStore = useVoiceStore();

      const rawMemberships = rtcSession.memberships;

      // Temporary debug logging — remove once resolved
      console.log(`[VoiceDebug] Room ${roomId} — raw membership count: ${rawMemberships.length}`);
      rawMemberships.forEach((m: any, i: number) => {
        console.log(`[VoiceDebug] Member ${i}:`, {
          userId: m.userId,
          deviceId: m.deviceId,
          isExpired: m.isExpired?.(),
          membership: m.membership,
          callMembership: m.callMembership,
          // Raw event content — this is the most important one
          eventContent: m.getCallMemberEvent?.()?.getContent?.(),
          // Check what keys exist on the object
          keys: Object.keys(m),
        });
      });

      // Debug: Check if there are ANY rtc related state events in the room
      const rtcEvents = room.currentState.getStateEvents('m.rtc.member');
      const msc4143Events = room.currentState.getStateEvents('org.matrix.msc4143.rtc.member');

      if (rawMemberships.length === 0 && (rtcEvents.length > 0 || msc4143Events.length > 0)) {
        console.warn(`[MatrixRTC] Room ${roomId} has ${rtcEvents.length + msc4143Events.length} state events but 0 session memberships!`);
      }

      // Filter for non-expired memberships
      const participantsMap = new Map<string, any>();
      rawMemberships.forEach((member: any) => {
        if (member.userId === state.client?.getUserId() && voiceStore.activeRoomId !== roomId) {
          return;
        }

        const isExp = member.isExpired?.() ?? true;
        const isLeave = (member as any).callMembership?.membership === 'leave'
          || (member as any).getMembershipEvent?.()?.getContent()?.membership === 'leave';
        if (isExp || isLeave) return;

        const key = `${member.userId}:${member.deviceId}`;
        // Store the newest one (highest TS)
        if (!participantsMap.has(key) || (member.createdTs?.() > participantsMap.get(key).createdTs?.())) {
          participantsMap.set(key, member);
        }
      });

      return Array.from(participantsMap.values()).map((member: any) => {
        const user = room.getMember(member.userId);
        const name = user?.name || member.userId.split(':')[0].replace('@', '');
        const avatarUrl = user?.getMxcAvatarUrl() || null;

        return {
          id: member.userId,
          name,
          avatarUrl
        };
      });
    }
    ,


    hierarchy(state) {
      // Access hierarchyTrigger for reactivity
      state.hierarchyTrigger;

      if (!state.client) return { rootSpaces: [], directMessages: [], orphanRooms: [] };

      const allRooms = state.client.getVisibleRooms().filter(room => {
        const membership = room.getMyMembership();
        return membership === 'join' || membership === 'invite';
      });
      const spaces: sdk.Room[] = [];
      const normalRooms: sdk.Room[] = [];

      // Separate by type
      allRooms.forEach(room => {
        if (room.isSpaceRoom()) {
          spaces.push(room);
        } else {
          normalRooms.push(room);
        }
      });

      // Map the Space Hierarchy
      const childRoomIds = new Set<string>();
      const spacesWithChildren = new Set<string>(); // To track active servers

      spaces.forEach(space => {
        const childEvents = space.currentState.getStateEvents('m.space.child');
        let hasValidChild = false;

        childEvents.forEach(event => {
          const content = event.getContent();
          if (content && Array.isArray(content.via) && content.via.length > 0) {
            childRoomIds.add(event.getStateKey() as string);
            hasValidChild = true;
          }
        });

        if (hasValidChild) {
          spacesWithChildren.add(space.roomId);
        }
      });

      // Also check m.space.parent in the rooms themselves for robustness
      allRooms.forEach(room => {
        const parentEvents = room.currentState.getStateEvents('m.space.parent');
        parentEvents.forEach(event => {
          const content = event.getContent();
          // If a canonical parent is set, mark it as a child
          if (content && content.via) {
            childRoomIds.add(room.roomId);
          }
        });
      });

      // Find the DMs (Read from the user's account data)
      const mDirectEvent = state.client.getAccountData(sdk.EventType.Direct);
      const mDirectContent = mDirectEvent ? mDirectEvent.getContent() : {};
      const dmRoomIds = new Set<string>();

      Object.values(mDirectContent).forEach((roomList: any) => {
        if (Array.isArray(roomList)) {
          roomList.forEach(roomId => dmRoomIds.add(roomId));
        }
      });

      // --- THE FINAL CATEGORIES ---

      // Servers: Spaces that have NO parents AND HAVE at least one child
      const rootSpaces = spaces.filter(space =>
        !childRoomIds.has(space.roomId) && spacesWithChildren.has(space.roomId)
      );

      // Pinned Spaces: Spaces that the user has pinned
      const pinnedRooms = state.pinnedSpaces
        .map(roomId => state.client?.getRoom(roomId))
        .filter((room): room is sdk.Room => !!room && room.isSpaceRoom());

      // Merge and deduplicate
      const allRootSpaces = [...rootSpaces];
      pinnedRooms.forEach(room => {
        if (!allRootSpaces.find(s => s.roomId === room.roomId)) {
          allRootSpaces.push(room);
        }
      });

      // DMs: Normal rooms that exist in the m.direct payload
      const directMessages = normalRooms.filter(room =>
        dmRoomIds.has(room.roomId)
      );

      // Orphan Rooms: Normal rooms that are NOT in a space, and are NOT DMs
      const orphanRooms = normalRooms.filter(room =>
        !childRoomIds.has(room.roomId) && !dmRoomIds.has(room.roomId)
      );

      return {
        rootSpaces: allRootSpaces,
        directMessages,
        orphanRooms,
      };
    },
  },

  actions: {
    async resolveApplicationInfo(appId: string) {
      if (this.appCache[appId]) return this.appCache[appId];

      try {
        const response = await fetch(`https://discord.com/api/v9/applications/${appId}/rpc`);
        if (response.ok) {
          const data = await response.json();
          this.appCache[appId] = {
            name: data.name,
            icon: data.icon
          };
          return this.appCache[appId];
        }
      } catch (e) {
        console.warn(`[MatrixStore] Failed to resolve Discord app info for ${appId}:`, e);
      }
      return null;
    },

    async resolveApplicationAssets(appId: string) {
      if (this.assetCache[appId]) return this.assetCache[appId];

      try {
        const response = await fetch(`https://discord.com/api/v9/oauth2/applications/${appId}/assets`);
        if (response.ok) {
          const data = await response.json();
          const map: Record<string, string> = {};
          if (Array.isArray(data)) {
            data.forEach((asset: any) => {
              map[asset.name] = asset.id;
            });
          }
          this.assetCache[appId] = map;
          return map;
        }
      } catch (e) {
        console.warn(`[MatrixStore] Failed to resolve Discord assets for ${appId}:`, e);
      }
      return {};
    },

    resolveActivity(userId: string | null): any {
      const currentUserId = this.client?.getUserId();
      const targetUserId = userId || currentUserId;
      if (!targetUserId) return null;

      const isSelf = currentUserId && targetUserId === currentUserId;

      const sanitize = (val: any) => {
        if (val === null || val === undefined) return null;
        const s = String(val).trim();
        if (!s || s === 'undefined' || s === 'null' || s === 'None') return null;
        return s;
      };

      // 1. Local sidecar data (highest priority for self)
      if (isSelf && this.activityDetails?.is_running) {
        const act = this.activityDetails;
        if (sanitize(act.name)) return act;
      }

      // 2. Synced account data (self other sessions)
      if (isSelf && this.remoteActivityDetails[targetUserId]?.is_running) {
        const remote = this.remoteActivityDetails[targetUserId];
        // 5 minute freshness check
        if (Date.now() - (remote.last_updated || 0) < 5 * 60 * 1000) {
          if (sanitize(remote.name)) return remote;
        }
      }

      // 3. Presence fallback (works for everyone)
      const user = this.client?.getUser(targetUserId);
      const presenceMsg = user?.presenceStatusMsg;
      if (presenceMsg && presenceMsg.startsWith('Playing ')) {
        const name = sanitize(presenceMsg.substring(8));
        if (name) {
          return {
            name,
            is_running: true
          };
        }
      }

      return null;
    },

    async initStorage() {
      // Load all persisted prefs into Pinia state on startup
      this.ui.memberListVisible = await getPref('matrix_member_list_visible', false);
      this.ui.collapsedCategories = await getPref('matrix_collapsed_categories', []);
      this.ui.showEmptyRooms = await getPref('matrix_show_empty_rooms', false);
      this.ui.themePreset = await getPref('matrix_theme_preset', 'default');
      this.ui.customCss = await getPref('matrix_custom_css', '');
      this.ui.uiOrder = await getPref('matrix_ui_order', {
        rootSpaces: [], categories: {}, rooms: {}
      });
      this.lastVisitedRooms = await getPref('matrix_last_visited_rooms', {
        dm: null, rooms: null, spaces: {}
      });
    },

    async initGameDetection() {
      // Check if Tauri storage has "game_detection_level"
      const stored = await getPref('game_detection_level', 'off');
      console.log('[MatrixStore] Loading game detection config:', stored);
      this.gameDetectionLevel = stored as any;

      const isTauri = (process as any).client && !!(window as any).__TAURI_INTERNALS__;
      if (isTauri) {
        const { listen } = await import('@tauri-apps/api/event');
        listen('game-activity', (event: any) => {
          console.log('[MatrixStore] Game activity event from Rust:', event.payload);
          const { name, exe, is_running } = event.payload;
          if (is_running) {
            this.activityDetails = {
              name: name + (exe ? ` (via ${exe})` : ''),
              is_running: true,
              last_updated: Date.now()
            };
          } else {
            if (this.activityDetails?.name === name) {
              this.activityDetails = null;
            }
          }
          this.refreshPresence();
        });
      }

      if (this.gameDetectionLevel !== 'off') {
        this.setGameDetectionLevel(this.gameDetectionLevel);
      }
    },

    async fetchDetectableGames() {
      if (this.detectableGames.length > 0) return this.detectableGames;
      try {
        const res = await fetch('https://discord.com/api/v9/applications/detectable');
        if (res.ok) {
          this.detectableGames = await res.json();
          return this.detectableGames;
        }
      } catch (e) {
        console.error('[MatrixStore] Failed to fetch detectable games:', e);
      }
      return [];
    },

    async setGameDetectionLevel(level: 'off' | 'basic' | 'advanced') {
      console.log('[MatrixStore] Setting game detection level:', level);
      this.gameDetectionLevel = level;
      await setPref('game_detection_level', level);

      const isTauri = (process as any).client && !!(window as any).__TAURI_INTERNALS__;

      // Disable everything first
      await this.stopRpcServer();
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_scanner_enabled', { enabled: false });
      }

      if (level === 'basic') {
        // Basic: Rust process scanning ONLY
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/core');
          const { platform } = await import('@tauri-apps/plugin-os');
          const games = await this.fetchDetectableGames();
          const os = platform(); // macos, windows, linux

          // Filter games for the current OS
          const filtered = games.map((g: any) => ({
            id: g.id,
            name: g.name,
            executables: (g.executables || []).filter((e: any) => {
              if (os === 'windows') return e.os === 'win32';
              if (os === 'macos') return e.os === 'darwin';
              if (os === 'linux') return e.os === 'linux';
              return false;
            })
          })).filter((g: any) => g.executables.length > 0);

          await invoke('update_watch_list', { games: filtered });
          await invoke('set_scanner_enabled', { enabled: true });
        }
      } else if (level === 'advanced') {
        // Advanced: arRPC sidecar (handles both scanning and RPC)
        await this.startRpcServer();
      }
    },

    _sanitizeActivityString(val: any): string | null {
      if (val === null || val === undefined) return null;
      const s = String(val).trim();
      if (!s || s === 'undefined' || s === 'null' || s === 'None') return null;
      return s;
    },

    async setGameDetection(enabled: boolean) {
      console.log('[MatrixStore] Setting game detection:', enabled);
      this.isGameDetectionEnabled = enabled;
      await setPref('game_activity_enabled', enabled);

      if (enabled) {
        await this.startRpcServer();
      } else {
        await this.stopRpcServer();
      }
    },

    async _hashUserId(userId: string): Promise<string> {
      const msgUint8 = new TextEncoder().encode(userId);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      // Convert to a big number string for Snowflake compatibility
      const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      // Use BigInt to convert hex to decimal
      return BigInt('0x' + hex).toString().substring(0, 18);
    },

    async startRpcServer() {
      const isTauri = (process as any).client && !!(window as any).__TAURI_INTERNALS__;
      if (!isTauri) return;

      const userId = this.client?.getUserId() || 'unknown';
      const hashedId = await this._hashUserId(userId);
      const userName = this.user?.displayName || (userId.split(':')[0] || 'Unknown').replace('@', '');
      const avatarHash = this.user?.avatarUrl?.split('/').pop();

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        console.log(`[MatrixStore] Starting arRPC sidecar (${this.gameDetectionLevel})...`);
        await invoke('start_rpc_server', {
          userId: hashedId,
          userName,
          avatar: avatarHash || null,
          noRpc: this.gameDetectionLevel === 'basic'
        });

        this.connectRpcWebSocket();
      } catch (e) {
        console.error('[MatrixStore] Failed to start arRPC server:', e);
      }
    },

    async stopRpcServer() {
      const isTauri = (process as any).client && !!(window as any).__TAURI_INTERNALS__;
      if (!isTauri) return;

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        console.log('[MatrixStore] Stopping arRPC sidecar...');
        await invoke('stop_rpc_server');

        if (this.rpcSocket) {
          this.rpcSocket.close();
          this.rpcSocket = null;
        }

        this.activityDetails = null;
        this.refreshPresence();
      } catch (e) {
        console.error('[MatrixStore] Failed to stop arRPC server:', e);
      }
    },

    connectRpcWebSocket() {
      if (this.rpcSocket) {
        this.rpcSocket.onclose = null;
        this.rpcSocket.close();
      }
      if (this.rpcRetryTimer) {
        clearTimeout(this.rpcRetryTimer);
        this.rpcRetryTimer = null;
      }

      const port = 13337; // use custom port to avoid conflicts
      console.log(`[MatrixStore] Connecting to arRPC bridge on port ${port}...`);
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);

      socket.onopen = () => {
        console.log('[MatrixStore] Connected to arRPC bridge');
      };

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[MatrixStore] arRPC message:', data);

          if (data.activity) {
            let name = this._sanitizeActivityString(data.activity.name);
            const details = this._sanitizeActivityString(data.activity.details);
            const appId = data.activity.application_id;
            let appIcon = null;

            let largeImage = data.activity.assets?.large_image;
            let smallImage = data.activity.assets?.small_image;

            // Always try to resolve from appId for authoritative name and assets
            if (appId) {
              const [appInfo, assets] = await Promise.all([
                this.resolveApplicationInfo(appId),
                this.resolveApplicationAssets(appId)
              ]);

              if (appInfo) {
                name = appInfo.name || name;
                appIcon = appInfo.icon;
              }

              // Map asset names to IDs if they are not already IDs
              if (largeImage && assets[largeImage]) largeImage = assets[largeImage];
              if (smallImage && assets[smallImage]) smallImage = assets[smallImage];
            }

            // Enhanced activity details from arRPC
            this.activityDetails = {
              name: name || details || 'a game',
              details: details,
              state: this._sanitizeActivityString(data.activity.state),
              applicationId: appId,
              iconHash: largeImage || appIcon,
              smallIconHash: smallImage,
              startTimestamp: data.activity.timestamps?.start,
              is_running: true,
              last_updated: Date.now()
            };
          } else {
            this.activityDetails = null;
          }

          // Update local remoteActivityDetails immediately to prevent stale fallbacks
          const userId = this.client?.getUserId();
          if (userId) {
            if (this.activityDetails) {
              this.remoteActivityDetails[userId] = { ...this.activityDetails };
            } else {
              delete this.remoteActivityDetails[userId];
            }
          }

          this.refreshPresence();
        } catch (e) {
          console.error('[MatrixStore] Failed to parse arRPC message:', e);
        }
      };

      socket.onclose = () => {
        console.log('[MatrixStore] Disconnected from arRPC bridge');
        if (this.gameDetectionLevel === 'advanced') {
          // Retry connection after a delay
          this.rpcRetryTimer = setTimeout(() => this.connectRpcWebSocket(), 5000);
        }
      };

      socket.onerror = (e) => {
        console.error('[MatrixStore] arRPC bridge error:', e);
      };

      this.rpcSocket = socket;
    },

    setCustomStatus(status: string | null) {
      this.customStatus = status;
      this.refreshPresence();
    },

    async goOffline() {
      if (this.client && this.isAuthenticated) {
        console.log('[MatrixStore] Sending offline flare...');

        let status_msg = this.customStatus;
        if (!status_msg && this.activityDetails?.is_running) {
          const gameName = this._sanitizeActivityString(this.activityDetails.name);
          if (gameName) {
            status_msg = `Playing ${gameName}`;
          }
        }

        try {
          await this.client.setPresence({
            presence: 'offline',
            status_msg: status_msg || ''
          });
        } catch (e) {
          console.error('[MatrixStore] Failed to send offline flare:', e);
        }
      }
    },

    setIdle(idle: boolean) {
      if (this.isIdle === idle) return;
      this.isIdle = idle;
      console.log('[MatrixStore] User idle status changed:', idle);
      this.refreshPresence();
    },

    async refreshPresence() {
      if (!this.client || !this.isAuthenticated || !this.isClientReady) return;

      const presence = this.isIdle ? 'unavailable' : 'online';

      let status_msg = this.customStatus;
      if (!status_msg && this.activityDetails?.is_running) {
        const gameName = this._sanitizeActivityString(this.activityDetails.name);
        if (gameName) {
          status_msg = `Playing ${gameName}`;
        }
      }

      if (!status_msg) status_msg = '';

      // Check if state has actually changed
      const stateChanged = !this.lastPresenceState ||
        this.lastPresenceState.presence !== presence ||
        this.lastPresenceState.status_msg !== status_msg;

      const now = Date.now();
      const throttleMs = 30 * 1000; // 30 seconds

      // Only skip if no change AND within throttle window
      if (!stateChanged && (now - this.lastPresenceUpdate < throttleMs)) {
        return;
      }

      console.log(`[MatrixStore] Refreshing presence: ${presence} ("${status_msg}")`);

      try {
        await this.client.setPresence({ presence: presence as any, status_msg });
        this.lastPresenceUpdate = now;
        this.lastPresenceState = { presence, status_msg };

        // Also sync rich activity to account data for other sessions of the SAME user
        if (stateChanged) {
          this.saveActivityToAccountData();
        }
      } catch (err: any) {
        if (err?.errcode === 'M_LIMIT_EXCEEDED') {
          console.warn('[MatrixStore] Presence update rate limited by server');
        } else {
          console.error('[MatrixStore] Failed to update presence:', err);
        }
      }
    },

    async setProfileDisplayName(displayName: string) {
      if (!this.client) return;
      try {
        await this.client.setDisplayName(displayName);
        if (this.user) this.user.displayName = displayName;
        toast.success('Display name updated');
      } catch (e) {
        console.error('[MatrixStore] Failed to set display name:', e);
        toast.error('Failed to update display name');
      }
    },

    async uploadAndSetProfileAvatar(file: File) {
      if (!this.client) return;
      try {
        const response = await this.client.uploadContent(file, { type: file.type });
        const mxcUrl = response.content_uri;
        await this.client.setAvatarUrl(mxcUrl);
        if (this.user) this.user.avatarUrl = mxcUrl;
        toast.success('Avatar updated');
      } catch (e) {
        console.error('[MatrixStore] Failed to upload/set avatar:', e);
        toast.error('Failed to update avatar');
      }
    },

    async toggleMemberList() {
      this.ui.memberListVisible = !this.ui.memberListVisible;
      if (this.ui.memberListVisible) {
        this.ui.sidebarOpen = false;
      }
      await setPref('matrix_member_list_visible', this.ui.memberListVisible);
    },

    setUISelectedUser(userId: string | null, pos?: { top: string; right: string }) {
      this.ui.selectedUserId = userId;
      if (pos) {
        this.ui.profileCardPos = pos;
      }
    },

    setUIComposerState(roomId: string, state: Partial<UIState['composerStates'][string]>) {
      if (!this.ui.composerStates[roomId]) {
        this.ui.composerStates[roomId] = {};
      }
      this.ui.composerStates[roomId] = {
        ...this.ui.composerStates[roomId],
        ...state
      };
    },

    async toggleUICategory(categoryId: string) {
      const index = this.ui.collapsedCategories.indexOf(categoryId);
      if (index === -1) {
        this.ui.collapsedCategories.push(categoryId);
      } else {
        this.ui.collapsedCategories.splice(index, 1);
      }
      await setPref('matrix_collapsed_categories', this.ui.collapsedCategories);
    },

    async toggleShowEmptyRooms() {
      this.ui.showEmptyRooms = !this.ui.showEmptyRooms;
      await setPref('matrix_show_empty_rooms', this.ui.showEmptyRooms);
    },

    toggleSidebar(open?: boolean) {
      if (typeof open === 'boolean') {
        this.ui.sidebarOpen = open;
      } else {
        this.ui.sidebarOpen = !this.ui.sidebarOpen;
      }
      if (this.ui.sidebarOpen) {
        this.ui.memberListVisible = false;
      }
    },

    async setThemePreset(id: string) {
      this.ui.themePreset = id;
      await setPref('matrix_theme_preset', id);
    },

    async setCustomCss(css: string) {
      this.ui.customCss = css;
      await setPref('matrix_custom_css', css);
    },

    setContextMenu(type: UIState['contextMenu']['type'], data: any = null) {
      this.ui.contextMenu.type = type;
      this.ui.contextMenu.data = data;
    },

    openRoomContextMenu(roomId: string) {
      this.setContextMenu('room', { roomId });
      this.ui._contextMenuHandled = true;
    },

    openMessageContextMenu(msg: any) {
      this.setContextMenu('message', { msg });
      this.ui._contextMenuHandled = true;
    },

    openConfirmationDialog(opts: {
      title: string;
      description: string;
      confirmLabel?: string;
      cancelLabel?: string;
      onConfirm: () => void;
    }) {
      this.ui.confirmationDialog = {
        isOpen: true,
        title: opts.title,
        description: opts.description,
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        onConfirm: opts.onConfirm,
      };
    },

    closeConfirmationDialog() {
      this.ui.confirmationDialog.isOpen = false;
    },

    // Message Actions (Global)
    handleReply(msg: any) {
      if (!msg || !msg.roomId) return;
      this.setUIComposerState(msg.roomId, { replyingTo: msg, editingMessage: null });
      // Focus will be handled by Chat.vue watching the state
    },

    handleEdit(msg: any) {
      if (!msg || !msg.roomId) return;
      this.setUIComposerState(msg.roomId, { editingMessage: msg, replyingTo: null, text: msg.body });
    },

    async handleReaction(msg: any, key: string) {
      if (!this.client || !msg || !msg.roomId) return;
      try {
        await this.client.sendEvent(msg.roomId, 'm.reaction' as any, {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: msg.eventId,
            key: key
          }
        });
        toast.success('Reaction sent');
      } catch (err) {
        console.error('Failed to send reaction', err);
        toast.error('Failed to react');
      }
    },

    async redactEvent(roomId: string, eventId: string) {
      if (!this.client) return;
      try {
        await this.client.redactEvent(roomId, eventId);
        toast.success('Message deleted');
      } catch (err) {
        console.error('Failed to delete message', err);
        toast.error('Failed to delete message');
      }
    },

    cancelLogin(errorReason?: string | null) {
      this.isLoggingIn = false;
      this.loginStatus = '';

      let friendlyMessage = "The authentication process was cancelled.";

      if (errorReason === 'access_denied') {
        friendlyMessage = "Access to the homeserver was denied.";
      } else if (errorReason) {
        // Clean up snake_case errors like 'invalid_request' -> 'invalid request'
        friendlyMessage = `Authentication failed: ${errorReason.replace(/_/g, ' ')}`;
      }

      toast.error('Login Cancelled', {
        description: friendlyMessage,
        duration: 5000,
      });

      const router = useRouter();
      if (router.currentRoute.value.path !== '/login') {
        router.push('/login');
      }
    },

    async startLogin(homeserverUrl: string) {
      console.log('[MatrixStore] startLogin called with:', homeserverUrl);
      this.isLoggingIn = true;
      this.loginStatus = 'Preparing…';

      // Ensure homeserverUrl has https:// for internal use
      const fullUrl = homeserverUrl.startsWith('http') ? homeserverUrl : `https://${homeserverUrl}`;
      console.log('[MatrixStore] startLogin: Normalized URL:', fullUrl);

      // We sync this to both the Tauri store AND localStorage.
      // Why? Because getHomeserverUrl() is a synchronous utility used during 
      // client creation before the asynchronous Tauri store is ready.
      console.log('[MatrixStore] startLogin: Setting matrix_homeserver_url...');
      await setPref('matrix_homeserver_url', fullUrl);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('matrix_homeserver_url', fullUrl);
      }

      // Stop any existing client to release DB locks
      if (this.client) {
        console.log('[MatrixStore] startLogin: Stopping existing client...');
        this.client.stopClient();
        this.client.removeAllListeners();
        this.client = null;
      }

      // CLEANUP: Remove old session data so the plugin doesn't try to auto-login when we land on the callback page.
      console.log('[MatrixStore] startLogin: Deleting old session secrets...');
      await deleteSecrets([
        'matrix_access_token',
        'matrix_refresh_token'
      ]);
      await deletePref('matrix_user_id');
      await deletePref('matrix_device_id');

      console.log('[MatrixStore] startLogin: Clearing persistent stores...');
      // Clear all persistent stores to prevent cross-contamination
      await this._clearPersistentStores();
      console.log('[MatrixStore] startLogin: Persistent stores cleared.');

      const isTauri = (process as any).client && !!(window as any).__TAURI_INTERNALS__;

      if (isTauri) {
        // --- Custom Loopback OAuth Flow (Desktop) ---
        // Start the custom Rust server
        const { invoke } = await import('@tauri-apps/api/core');
        const oauthPromise = invoke<string>('start_oauth_server');

        const redirectUri = "http://localhost:1420";
        await setPref('matrix_oidc_redirect_uri', redirectUri);

        this.loginStatus = 'Contacting homeserver…';
        const authConfig = await getOidcConfig(fullUrl);
        const clientId = await registerClient(authConfig, redirectUri);
        const nonce = generateNonce();

        await setPref('matrix_oidc_config', authConfig);
        await setPref('matrix_oidc_client_id', clientId);
        await setPref('matrix_oidc_nonce', nonce);

        const loginUrl = await getLoginUrl(authConfig, clientId, nonce, redirectUri, fullUrl);

        // Open the system browser (not the webview)
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(loginUrl);
        this.loginStatus = 'Waiting for browser authentication…';

        // Wait for the Rust server to capture the code
        try {
          const callbackUrl = await oauthPromise;
          const parsed = new URL(callbackUrl);
          const code = parsed.searchParams.get('code');
          const state = parsed.searchParams.get('state');
          const error = parsed.searchParams.get('error');

          if (error) {
            console.error("OAuth flow failed or was cancelled:", error);
            this.cancelLogin(error);
          } else if (code && state) {
            await this.handleCallback(code, state);
            await navigateTo('/chat', { replace: true });
          } else {
            console.error('[MatrixStore] Login failed: Missing code or state in callback URL');
            this.cancelLogin('missing_credentials');
          }
        } catch (err: any) {
          console.error('[MatrixStore] Login flow failed:', err);
          this.cancelLogin(err?.message || 'callback_failed');
        }
      } else {
        // --- Standard Web/PWA Flow ---
        this.loginStatus = 'Contacting homeserver…';
        const authConfig = await getOidcConfig(fullUrl);
        const clientId = await registerClient(authConfig);
        const nonce = generateNonce();

        await setPref('matrix_oidc_config', authConfig);
        await setPref('matrix_oidc_client_id', clientId);
        await setPref('matrix_oidc_nonce', nonce);
        await setPref('matrix_oidc_redirect_uri', window.location.origin + '/auth/callback');

        this.loginStatus = 'Redirecting to login…';
        const url = await getLoginUrl(authConfig, clientId, nonce, undefined, fullUrl);
        window.location.href = url;
      }
    },

    async handleCallback(code: string, state: string) {
      console.log('[MatrixStore] handleCallback started', { code: code.substring(0, 10) + '...', state });
      this.loginStatus = 'Exchanging tokens…';

      // Exchange Code for Token
      let data: any;
      try {
        data = await completeLoginFlow(code, state);
        console.log('[MatrixStore] completeLoginFlow success', {
          hasTokenResponse: !!data?.tokenResponse,
          homeserverUrl: data?.homeserverUrl
        });
      } catch (err) {
        console.error('[MatrixStore] completeLoginFlow failed:', err);
        throw err;
      }

      const accessToken = data.tokenResponse.access_token;
      const refreshToken = data.tokenResponse.refresh_token;

      // Fetch the real Matrix ID (MXID)
      this.loginStatus = 'Verifying your identity…';
      const tempClient = sdk.createClient({
        baseUrl: data.homeserverUrl,
        accessToken: accessToken
      });

      console.log('[MatrixStore] Fetching MXID with temp client...');
      let userId: string;
      try {
        const whoami = await tempClient.whoami();
        userId = whoami.user_id;
        console.log('[MatrixStore] MXID fetched:', userId);
      } catch (e) {
        console.warn("[MatrixStore] Failed to fetch MXID via whoami, trying fallback:", e);
        if (data.idTokenClaims?.sub) {
          userId = data.idTokenClaims.sub;
        } else {
          throw new Error("Could not verify user identity.");
        }
      }

      const deviceId = data.tokenResponse.device_id || (await tempClient.whoami().catch(() => ({} as { device_id?: string }))).device_id;
      console.log('[MatrixStore] Device ID found:', deviceId);

      // Persist Valid Credentials
      console.log('[MatrixStore] Persisting credentials to secure store...');
      await setSecret('matrix_access_token', accessToken);
      await setSecret('matrix_refresh_token', refreshToken);
      await setPref('matrix_user_id', userId);
      if (deviceId) await setPref('matrix_device_id', deviceId);

      // Persist OIDC session data needed for token refresh on reload
      const issuer = data.oidcClientSettings.issuer;
      const clientId = data.oidcClientSettings.clientId;
      const idTokenClaims = data.idTokenClaims;

      console.log('[MatrixStore] Persisting OIDC metadata...', { issuer, clientId });
      await setPref('matrix_oidc_issuer', issuer);
      await setPref('matrix_oidc_id_token_claims', idTokenClaims);

      // Initialize
      console.log('[MatrixStore] Calling initClient...');
      this.loginStatus = 'Connecting to Matrix…';
      await this.initClient(accessToken, userId, deviceId, refreshToken, issuer, clientId, idTokenClaims);
      console.log('[MatrixStore] handleCallback finished');
    },

    async initClient(
      accessToken: string,
      userId: string,
      deviceId?: string,
      refreshToken?: string,
      issuer?: string,
      clientId?: string,
      idTokenClaims?: IdTokenClaims,
    ) {
      console.time('[MatrixStore] initClient (total)');
      console.log("[MatrixStore] Initializing Matrix client...", { userId, deviceId, hasAccessToken: !!accessToken });
      this.isRestoringSession = true;

      // Force restart client
      if (this.client) {
        this.client.stopClient();
        this.client.removeAllListeners();
        this.client = null;
      }

      // 1. Fetch Device ID before client creation if missing.
      // This ensures we don't end up with an unidentifiable Olm device.
      if (!deviceId) {
        console.log('[MatrixStore] Device ID missing, fetching via whoami before creation...');
        const temp = sdk.createClient({ baseUrl: getHomeserverUrl(), accessToken });
        try {
          const whoami = await temp.whoami();
          deviceId = whoami.device_id || undefined;
          if (deviceId) {
            await setPref('matrix_device_id', deviceId);
            console.log('[MatrixStore] Fetched device ID:', deviceId);
          }
        } catch (e) {
          console.warn('[MatrixStore] whoami failed:', e);
        }
      }

      // Build tokenRefreshFunction when we have full OIDC context
      let tokenRefreshFunction: sdk.TokenRefreshFunction | undefined;
      if (refreshToken && issuer && clientId && idTokenClaims && deviceId) {
        const redirectUri = await getPref('matrix_oidc_redirect_uri', window.location.origin + '/auth/callback');
        console.log('[MatrixStore] Creating OIDC token refresher...', { issuer, clientId, redirectUri, deviceId });
        try {
          const refresher = new LocalStorageOidcTokenRefresher(issuer, clientId, redirectUri, deviceId, idTokenClaims);
          tokenRefreshFunction = refresher.doRefreshAccessToken.bind(refresher);
          console.log('[MatrixStore] OIDC token refresh function configured.');
        } catch (oidcErr) {
          console.error('[MatrixStore] CRITICAL: Failed to initialize OIDC refresher:', oidcErr);
          throw oidcErr;
        }
      } else if (refreshToken) {
        console.warn('Refresh token present but missing OIDC metadata — token refresh will not work.');
      }

      // Initialize room store
      let roomStorePromise: Promise<void> | null = null;
      let roomStore: any = new IndexedDBStore({
        indexedDB: window.indexedDB,
        dbName: "matrix-js-sdk::matrix-store",
      });

      // Load persisted SSSS keys before starting
      loadPersistedSecretStorageKeys();

      // 1.1 Request persistent storage (iOS/PWA optimization)
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(persisted => {
          console.log(`[MatrixStore] Storage persisted: ${persisted}`);
        }).catch(err => {
          console.warn('[MatrixStore] Failed to request storage persistence:', err);
        });
      }

      // Build client options
      const clientOpts: any = {
        baseUrl: getHomeserverUrl(),
        accessToken,
        userId,
        deviceId,
        refreshToken,
        tokenRefreshFunction,
        store: roomStore,
        verificationMethods: [
          'm.sas.v1',
          'm.qr_code.show.v1',
          'm.qr_code.scan.v1',
          'm.reciprocate.v1'
        ],
        // CRITICAL: We DO NOT pass IndexedDBCryptoStore here as it conflicts with Rust crypto.
        // However, we MUST pass LocalStorageCryptoStore so that Secret Storage Keys (like the 
        // Megolm backup key) gossiped to us from other devices survive a page refresh.
        cryptoStore: typeof window !== 'undefined' ? new LocalStorageCryptoStore(window.localStorage) : undefined,
        cryptoCallbacks: {
          getSecretStorageKey: async ({ keys }: { keys: Record<string, any> }): Promise<[string, Uint8Array<ArrayBuffer>] | null> => {
            const keyIds = Object.keys(keys);
            console.log('[SecretStorage] getSecretStorageKey called for keys:', keyIds);

            const firstKeyId = keyIds[0];
            if (!firstKeyId) return null;

            const cachedKeyId = keyIds.find(id => secretStorageKeys.has(id));
            if (cachedKeyId) {
              return [cachedKeyId, secretStorageKeys.get(cachedKeyId)!] as [string, Uint8Array<ArrayBuffer>];
            }

            // Suppress automatic modal on refresh if we are already verified and cross-signing is ready.
            // This prevents the annoying "Security Key Required" popup when everything is already working.
            if (this.isCrossSigningReady && this.isSecretStorageReady) {
              console.log('[SecretStorage] Device is already ready, suppressing automatic modal.');
              return null;
            }

            // If a device verification is active, wait for it instead of prompting immediately.
            // This prioritizes interactive verification (Emoji/QR) and gossip over backup keys.
            if (this.activeVerificationRequest || this.isRequestingVerification) {
              console.log('[SecretStorage] Verification in progress, deferring secret storage prompt...');
              return new Promise<[string, Uint8Array<ArrayBuffer>] | null>((resolve, reject) => {
                this.pendingSecretStorageRequests.push({
                  promise: { resolve, reject: (err?: any) => reject(err) },
                  keyId: firstKeyId,
                  keyInfo: keys[firstKeyId]
                });
              });
            }

            // Otherwise, tell the SDK to pause and wait for user input via modal
            return new Promise<[string, Uint8Array<ArrayBuffer>] | null>((resolve, reject) => {
              const keyInfo = keys[firstKeyId];
              console.log('[SecretStorage] Prompting user for key:', firstKeyId);

              this.secretStoragePrompt = {
                promise: { resolve, reject: (err: any) => reject(err) },
                keyId: firstKeyId,
                keyInfo
              } as any;
            });
          },
          cacheSecretStorageKey: (keyId: string, _keyInfo: any, privateKey: Uint8Array) => {
            secretStorageKeys.set(keyId, privateKey as Uint8Array<ArrayBuffer>);
            persistSecretStorageKey(keyId, privateKey);
          },
        }
      };

      // Create new client FIRST, then startup the store
      this.client = markRaw(sdk.createClient(clientOpts));

      try {
        console.log('[MatrixStore] Starting IndexedDBStore (after assignment to client)...');
        await roomStore.startup();
        console.log('[MatrixStore] Room store started successfully');
      } catch (err) {
        console.error("[MatrixStore] Failed to start IndexedDBStore, falling back to MemoryStore", err);
        window.indexedDB.deleteDatabase("matrix-js-sdk::matrix-store");
        // Re-assign a MemoryStore to the client
        roomStore = new MemoryStore();
        (this.client as any).store = roomStore;
      }

      // Initialize crypto
      let cryptoReady = false;
      this.loginStatus = 'Initialising encryption…';
      try {
        console.log('[MatrixStore] Calling initRustCrypto...');
        await this.client.initRustCrypto();
        cryptoReady = !!this.client.getCrypto();
        console.log('[MatrixStore] Rust crypto initialized:', cryptoReady);

        // Auto-restore if we have the keys locally and crypto is not fully ready
        if (cryptoReady) {
          const crypto = this.client.getCrypto();
          this.isCrossSigningReady = await crypto?.isCrossSigningReady() || false;
          this.isSecretStorageReady = await crypto?.isSecretStorageReady() || false;
          console.log('[MatrixStore] Crypto status (Early Init):', {
            crossSigningReady: this.isCrossSigningReady,
            secretStorageReady: this.isSecretStorageReady
          });

          if (this.isCrossSigningReady === false) {
            console.log('[MatrixStore] Cross-signing not ready, checking for local SSSS keys...');
            const hasSsssKey = await this.client.secretStorage.hasKey();
            if (hasSsssKey) {
              console.log('[MatrixStore] SSSS key found locally, triggering auto-restore...');
              this.loadSessionBackupPrivateKeyFromSecretStorage().catch(e => {
                console.error('[MatrixStore] Failed to auto-restore session from local secret storage:', e);
              });
            } else {
              console.log('[MatrixStore] No local SSSS key found, UI will prompt if needed.');
            }
          }
        }
      } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes("account in the store doesn't match") || e.name === 'InvalidCryptoStoreError' || msg.includes('version')) {
          console.warn('🚨 Crypto store error (stale data or version mismatch) — triggering reset...');

          if (e.name === 'InvalidCryptoStoreError' || msg.includes('version')) {
            console.error("🚨 Critical: Database version mismatch detected. Wiping crypto stores and resetting...");
            // Wipe IndexedDB crypto stores directly
            const dbs = [
              'matrix-js-sdk::matrix-store',
              'matrix-js-sdk::matrix-sdk-crypto',
              'matrix-js-sdk::matrix-sdk-crypto-meta',
              'matrix-js-sdk::crypto-store'
            ];
            for (const dbName of dbs) {
              try { window.indexedDB.deleteDatabase(dbName); } catch { /* ignore */ }
            }
            this.isAuthenticated = false;
            this.isRestoringSession = false;
            await navigateTo('/');
            return;
          }

          // Stop the current client to release the IndexedDB connection
          if (this.client) {
            this.client.stopClient();
            this.client.removeAllListeners();
            this.client = null;
          }

          // Brief pause to ensure DB lock is released
          await new Promise(resolve => setTimeout(resolve, 100));

          // Delete the stale Rust crypto IndexedDB databases
          const deleteDb = (name: string) => new Promise<void>((resolve) => {
            const req = window.indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => { console.warn(`IndexedDB delete blocked: ${name}`); resolve(); };
          });
          await deleteDb('matrix-js-sdk::matrix-sdk-crypto');
          await deleteDb('matrix-js-sdk::matrix-sdk-crypto-meta');
          // Recreate the client
          this.client = markRaw(sdk.createClient({
            baseUrl: getHomeserverUrl(),
            accessToken,
            userId,
            deviceId,
            refreshToken,
            tokenRefreshFunction,
            store: roomStore,
            cryptoCallbacks: {
              getSecretStorageKey: async ({ keys }: { keys: Record<string, any> }): Promise<[string, Uint8Array<ArrayBuffer>] | null> => {
                const keyIds = Object.keys(keys);
                const keyId = keyIds.find(id => secretStorageKeys.has(id));
                if (keyId) {
                  console.log('[SecretStorage] Reusing cached memory key for fallback prompt:', keyId);
                  return [keyId, secretStorageKeys.get(keyId)!] as [string, Uint8Array<ArrayBuffer>];
                }
                if (!keyId) {
                  return new Promise<[string, Uint8Array<ArrayBuffer>] | null>((resolve, reject) => {
                    const firstKeyId = Object.keys(keys)[0];
                    if (!firstKeyId) {
                      resolve(null);
                      return;
                    }
                    const keyInfo = keys[firstKeyId];
                    this.secretStoragePrompt = {
                      promise: { resolve, reject: (err: any) => reject(err) },
                      keyId: firstKeyId,
                      keyInfo
                    } as any;
                  }) as Promise<[string, Uint8Array<ArrayBuffer>] | null>;
                }
                return [keyId, secretStorageKeys.get(keyId)!] as [string, Uint8Array<ArrayBuffer>];
              },
              cacheSecretStorageKey: (keyId: string, _keyInfo: any, privateKey: Uint8Array) => {
                secretStorageKeys.set(keyId, privateKey as Uint8Array<ArrayBuffer>);
              },
            }
          }));
          // Retry init
          try {
            await this.client.initRustCrypto();
            cryptoReady = !!this.client.getCrypto();
            console.log('Crypto initialized after store reset:', cryptoReady);
          } catch (retryErr) {
            console.error('Crypto failed to initialize after reset:', retryErr);
          }
        } else {
          console.warn("Crypto failed to initialize:", e);
        }
      }

      // Suppress SDK debug noise during initial sync.
      // The SDK emits 70+ console.debug calls synchronously on every startup —
      // all the [MatrixRTCSession] "No membership changes" lines and FetchHttpApi
      // request traces. In WebKit, console.debug with string interpolation is
      // synchronous and expensive. We restore it after SyncState.Prepared.
      const _origDebug = console.debug;
      console.debug = () => { };

      // Start client with performance-optimised options:
      //
      // lazyLoadMembers: true — the single biggest win. Instructs the server to
      // only send m.room.member events for senders of visible timeline events,
      // not all members of all 74 rooms. Cuts initial sync payload by 60-80%.
      // Members for a specific room are fetched on demand when the user opens it
      // via room.loadMembersIfNeeded().
      //
      // initialSyncLimit: 1 — only fetch 1 timeline event per room on initial
      // sync. The room list and unread counts are available immediately; full
      // history loads when the user opens a room. This is the same approach
      // Cinny and Element use to achieve fast startup.
      //
      // pollTimeout: 10000 — long-poll window. Default 30s means the client
      // can sit idle for up to 29s after initial sync before receiving updates.
      // 10s keeps the client responsive without hammering the server.

      console.log('[MatrixStore] initClient (total) - Starting non-blocking sync setup...');
      let _debugRestored = false;

      // 5. Setup a listener to notify the UI when the "Initial Catch-up" is done
      this.client.once(sdk.ClientEvent.Sync, (state: sdk.SyncState) => {
        if (state === sdk.SyncState.Prepared || state === sdk.SyncState.Syncing) {
          console.log("⚡ [MatrixStore] Matrix background sync complete (Initial Catch-up).");
          this.isFullySynced = true;
          this.isClientReady = true;
          this.loginStatus = '';

          // Run post-sync tasks in background
          this.refreshPresence();
          this.forceRecalculateVoiceMemberships();
          this.checkSecretStorageSetup();
          // Note: cryptoReady is a local variable in initClient scope
          if (cryptoReady) {
            this.checkDeviceVerified();
            this.handleStartupDehydration();
            this.performCryptoSanityCheck();
          }
        }
      });

      this.client.on(sdk.ClientEvent.Sync, (state: sdk.SyncState) => {
        console.log('[MatrixStore] Sync state changed:', state);
        this.isSyncing = state === sdk.SyncState.Syncing || state === sdk.SyncState.Prepared;

        if (state === sdk.SyncState.Syncing && !_debugRestored) {
          _debugRestored = true;
          console.debug = _origDebug;
        }
      });

      // START BACKGROUND SYNC (Do NOT await this)
      console.log('[MatrixStore] Starting client in background...');
      this.loginStatus = 'Starting background sync…';
      this.client.startClient({
        lazyLoadMembers: true,
        initialSyncLimit: 10,
        pollTimeout: 10000,
      }).catch(err => {
        console.error('[MatrixStore] Failed to start client sync (background):', err);
        if (err?.httpStatus === 401) {
          toast.error('Session Expired', {
            description: 'Your session has expired. Please log in again.',
          });
        }
      });

      // IMMEDIATELY EXIT LOADING STATE
      // The store is hydrated (IndexedDB) and the client is syncing in background.
      this.isAuthenticated = true;
      this.isReady = true;
      this.isLoggingIn = false;
      this.isRestoringSession = false;
      console.log('[MatrixStore] UI Unlocked. Syncing in background.');

      // Listen for token invalidation from the server (e.g. device deleted)
      this.client.on(sdk.HttpApiEvent.SessionLoggedOut, (err) => {
        console.error("🚨 [MatrixStore] Server invalidated session (M_UNKNOWN_TOKEN). Forcing logout run.", err);
        // Instantly stop the client to prevent infinite request loops
        if (this.client) {
          this.client.stopClient();
        }
        // We use an arrow function so 'this' remains bound to the Pinia store
        this.logout();
      });

      // Global Error Interceptor for Crypto Failures (OTK 400s, etc.)
      this.client.on(sdk.ClientEvent.Sync, (state: sdk.SyncState, prevState: sdk.SyncState | null, data?: any) => {
        if (state === sdk.SyncState.Error) {
          const error = data?.error;
          this.lastSyncError = error;
          const msg = error?.message || "";
          const code = error?.errcode || error?.httpStatus;

          if (code === 400 && msg.includes("One time key") && msg.includes("already exists")) {
            console.error("🚨 [MatrixStore] Fatal Crypto Store Desync (OTK Conflict) detected!");
            this.isCryptoDegraded = true;
            this.cryptoStatusMessage = "Encryption store desync. Security repair may be required.";

            toast.error("Security Sync Error", {
              description: "A cryptographic desync was detected. Some messages may not be decryptable.",
              duration: 10000,
            });
          }
        }
      });

      // Listen for MatrixRTC memberships to update sidebar icons/lists.
      // We only parse the specific room that changed — never all rooms.
      // hierarchyTrigger is debounced to coalesce rapid bursts (e.g. initial sync
      // delivering dozens of stale membership events back-to-back).
      const debouncedHierarchyTrigger = useDebounceFn(() => {
        this.hierarchyTrigger++;
      }, 150);

      const debouncedUnreadTrigger = useDebounceFn(() => {
        this.unreadTrigger++;
      }, 200);

      this.client.on(sdk.RoomEvent.Receipt, () => {
        debouncedUnreadTrigger();
      });

      this.client.on(sdk.RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
        if (toStartOfTimeline) return;
        debouncedUnreadTrigger();
      });

      this.client.on(sdk.ClientEvent.Event, (event) => {
        const type = event.getType();
        const isMatrixRTC =
          type === 'org.matrix.msc4143.rtc.member' ||
          type === 'org.matrix.msc3401.call.member' ||
          type === 'm.call.member' ||
          type === 'm.rtc.member';

        if (isMatrixRTC) {
          // Reparse only the affected room, not all 74+
          const roomId = event.getRoomId();
          if (roomId) {
            const room = this.client?.getRoom(roomId);
            if (room) {
              const session = this.client?.matrixRTC.getRoomSession(room);
              if (session && typeof (session as any).ensureRecalculateSessionMembers === 'function') {
                (session as any).ensureRecalculateSessionMembers();
              }
            }
          }

          if (this.isClientReady) {
            console.log(`[Voice] MatrixRTC event received (${type}), refreshing hierarchy`);
            debouncedHierarchyTrigger();
          }
        }
      });


      // Register all listeners immediately — these are cheap and don't hit the network.
      this.setupCryptoListeners();
      this.setupVerificationListeners();
      this.setupHierarchyListeners();
      this.setupMatrixRTCListeners();

      // Fire-and-forget network calls that are safe to run in parallel with sync.
      // updateDeviceName and fetchUserProfile each make a single independent HTTP
      // call and don't depend on account_data, so they don't block anything.
      this.updateDeviceName();
      this.fetchUserProfile(userId);
    },

    setupHierarchyListeners() {
      if (!this.client) return;

      this.client.on(sdk.ClientEvent.Room, (room) => {
        if (this.isClientReady) {
          this.updateHierarchy();
          if (room.getMyMembership() === 'invite') {
            this.showInviteNotification(room);
          }
        }
      });
      this.client.on(sdk.ClientEvent.AccountData, (event) => {
        if (event.getType() === sdk.EventType.Direct) {
          this.updateHierarchy();
          this.updateDirectMessageMap();
        }
        if (event.getType() === 'cc.jackg.ruby.pinned_spaces') this.updatePinnedSpaces();
        if (event.getType() === 'cc.jackg.ruby.ui_order') this.loadUIOrderFromAccountData();
        if (event.getType() === 'cc.jackg.tumult.activity_details') this.loadRichActivityFromAccountData();
      });
      // Listen for parent/child changes
      this.client.on(sdk.RoomStateEvent.Events, (event) => {
        const type = event.getType();
        // Guard: initial sync fires dozens of space state events synchronously,
        // each triggering a full hierarchy re-render. Defer until Prepared.
        if (this.isClientReady) {
          if (type === 'm.space.child' || type === 'm.space.parent') {
            this.updateHierarchy();
          }
        }
        if (type === 'cc.jackg.ruby.game.state') {
          this.gameTrigger++;
        }
      });

      const handleGameEvent = (event: sdk.MatrixEvent) => {
        const isEncrypted = event.getType() === 'm.room.encrypted';

        // If it's encrypted and not yet decrypted, wait for it.
        // Guard against decryption failures: the SDK fires MatrixEventEvent.Decrypted
        // even when decryption fails, so we must check isDecryptionFailure() to avoid
        // endlessly re-registering once() listeners for events that will never clear.
        if (isEncrypted && !event.getClearContent()) {
          if (event.isDecryptionFailure()) return; // already failed, nothing to do
          event.once(sdk.MatrixEventEvent.Decrypted, (ev) => {
            if (!ev.isDecryptionFailure()) {
              handleGameEvent(ev);
            }
          });
          return;
        }

        const content = isEncrypted ? event.getClearContent() : event.getContent();
        // The type might be in the clear content or the event type itself
        const type = event.getType() === 'm.room.encrypted' ? content?.type : event.getType();

        if (type === 'cc.jackg.ruby.game.state' && content?.game_id) {
          console.log(`[GameStore] Applying state update for ${content.game_id}`, content);
          this.gameStates[content.game_id] = { ...content };
          this.gameTrigger++;
        } else if (type === 'cc.jackg.ruby.game.action' || type === 'cc.jackg.ruby.game.over') {
          console.log(`[GameStore] Action/Over event received: ${type}`);
          this.gameTrigger++;
        }
      };

      this.client.on(sdk.RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
        if (toStartOfTimeline) return;
        handleGameEvent(event);
      });

      // Initial trigger
      this.updatePinnedSpaces();
      this.loadUIOrderFromAccountData();
      this.loadRichActivityFromAccountData();
      this.updateDirectMessageMap();
      this.updateHierarchy();
    },

    updateDirectMessageMap() {
      if (!this.client) return;
      const dmEvent = this.client.getAccountData(sdk.EventType.Direct);
      if (!dmEvent) return;
      const content = dmEvent.getContent();
      const newMap: Record<string, string> = {};
      for (const [userId, roomIds] of Object.entries(content)) {
        if (Array.isArray(roomIds) && roomIds.length > 0) {
          newMap[userId] = roomIds[0];
        }
      }
      this.directMessageMap = newMap;
    },

    async loadUIOrderFromAccountData() {
      if (!this.client) return;
      const event = (this.client as any).getAccountData('cc.jackg.ruby.ui_order');
      if (event) {
        const content = event.getContent();
        if (content) {
          this.ui.uiOrder = {
            rootSpaces: Array.isArray(content.rootSpaces) ? content.rootSpaces : [],
            categories: content.categories || {},
            rooms: content.rooms || {}
          };
          await setPref('matrix_ui_order', this.ui.uiOrder);
        }
      }
    },

    async loadRichActivityFromAccountData() {
      if (!this.client) return;
      const userId = this.client.getUserId();
      if (!userId) return;

      const event = (this.client as any).getAccountData('cc.jackg.tumult.activity_details');
      if (event) {
        const content = event.getContent();
        if (content && typeof content === 'object' && Object.keys(content).length > 0) {
          // Only update if it's more recent than what we have locally (if anything)
          const remoteUpdated = content.last_updated || 0;
          const localUpdated = this.activityDetails?.last_updated || 0;

          // If we are currently running a game locally, we don't overwrite it with remote data
          // unless the remote data is also "running" and newer.
          if (!this.activityDetails?.is_running || remoteUpdated > localUpdated) {
            this.remoteActivityDetails[userId] = content;
          }
        } else {
          delete this.remoteActivityDetails[userId];
        }
      } else {
        delete this.remoteActivityDetails[userId];
      }
    },

    async saveActivityToAccountData() {
      if (!this.client) return;
      try {
        // Only sync OUR activityDetails (the ones from the sidecar)
        await (this.client as any).setAccountData('cc.jackg.tumult.activity_details', this.activityDetails || {});
      } catch (e) {
        console.error('Failed to save rich activity to account data:', e);
      }
    },

    async saveUIOrder() {
      // Optimistic update to local storage
      await setPref('matrix_ui_order', this.ui.uiOrder);

      if (!this.client) return;
      try {
        await (this.client as any).setAccountData('cc.jackg.ruby.ui_order', this.ui.uiOrder);
      } catch (e) {
        console.error('Failed to save UI order to account data:', e);
      }
    },

    async fetchSpaceHierarchy(spaceId: string) {
      if (!this.client) return;
      try {
        console.log(`[MatrixStore] Fetching hierarchy for space: ${spaceId}`);
        const result = await (this.client as any).getRoomHierarchy(spaceId);
        this.spaceHierarchies[spaceId] = result.rooms;
        this.hierarchyTrigger++;
      } catch (e) {
        console.error(`[MatrixStore] Failed to fetch hierarchy for space ${spaceId}:`, e);
      }
    },

    updateRootSpacesOrder(newOrder: string[]) {
      this.ui.uiOrder.rootSpaces = newOrder;
      this.saveUIOrder();
    },

    updateCategoryOrder(spaceId: string, newOrder: string[]) {
      this.ui.uiOrder.categories[spaceId] = newOrder;
      this.saveUIOrder();
    },

    updateRoomOrder(categoryId: string, newOrder: string[]) {
      this.ui.uiOrder.rooms[categoryId] = newOrder;
      this.saveUIOrder();
    },

    updatePinnedSpaces() {
      if (!this.client) return;
      const event = (this.client as any).getAccountData('cc.jackg.ruby.pinned_spaces');
      if (event) {
        const content = event.getContent();
        if (content && Array.isArray(content.rooms)) {
          this.pinnedSpaces = content.rooms;
        }
      }
    },

    updateHierarchy() {
      this.hierarchyTrigger++;
    },

    showInviteNotification(room: sdk.Room) {
      const myUserId = this.client?.getUserId();
      const member = room.getMember(myUserId!);
      const inviterId = member?.events.member?.getSender();
      const inviterName = room.getMember(inviterId!)?.name || inviterId || 'Someone';
      const isDirect = member?.events.member?.getContent().is_direct;

      const title = isDirect ? 'New DM Invite' : 'New Room Invite';
      const body = `${inviterName} invited you to ${room.name}`;

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
      toast.info(title, { description: body });
    },

    // Action to get avatar and name
    async fetchUserProfile(userId: string) {
      if (!this.client) return;
      try {
        const profile = await this.client.getProfileInfo(userId);

        // Store the mxc:// URL directly
        let avatarUrl = profile.avatar_url;

        // Update state
        this.user = {
          userId,
          displayName: profile.displayname,
          avatarUrl: avatarUrl || undefined
        };
      } catch (e) {
        console.error("Could not fetch profile:", e);
        this.user = { userId }; // Fallback
      }
    },

    async updateDeviceName() {
      if (!this.client) return;

      try {
        // 1. Check if the SDK knows the device ID
        let deviceId = this.client.getDeviceId();

        // 2. If missing (standard for OIDC), ask the server who we are!
        if (!deviceId) {
          const whoami = await this.client.whoami();
          deviceId = whoami.device_id ?? null;

          if (!deviceId) {
            console.warn('Cannot update device name: Still no device ID returned from the server.');
            return;
          }

          // CRITICAL: Save this device ID to your local storage!
          // You must pass this into sdk.createClient({ deviceId }) on future 
          // app boots so End-to-End Encryption (Emojis) works properly!
          await setPref('matrix_device_id', deviceId);
        }

        // 3. Grab the hardware details
        let host = 'Web';
        let osType = 'Unknown OS';
        let osVersion = '';

        const isTauri = (process as any).client && !!(window as any).__TAURI_INTERNALS__;
        if (isTauri) {
          try {
            const { hostname, type, version } = await import('@tauri-apps/plugin-os');
            host = await hostname() || 'Unknown Host';
            osType = type();
            osVersion = version();
          } catch (tauriErr) {
            console.warn('Failed to get OS info via Tauri:', tauriErr);
          }
        } else {
          // Fallback for web
          host = 'Browser';
          osType = navigator.platform;
        }

        const deviceName = `Tumult on ${host} (${osType}${osVersion ? ' ' + osVersion : ''})`;

        console.log(`Attempting to rename Matrix Device ${deviceId} to: ${deviceName}`);

        // 4. Update the actual Matrix Device Name in Synapse
        await this.client.setDeviceDetails(deviceId, {
          display_name: deviceName
        });

        console.log('✅ Successfully synced device name to ' + deviceName);
      } catch (err) {
        console.error('❌ Failed to update Matrix device name', err);
      }
    },

    async checkSecretStorageSetup() {
      if (!this.client) return;
      try {
        const defaultKey = await this.client.getAccountData('m.secret_storage.default_key');
        if (defaultKey) {
          const keyId = defaultKey.getContent().key;
          const keyInfo = await this.client.getAccountData(`m.secret_storage.key.${keyId}`);
          if (keyInfo) {
            const content = keyInfo.getContent();
            this.secretStorageSetup = {
              defaultKeyId: keyId,
              needsPassphrase: !!content.passphrase,
              passphraseInfo: content.passphrase
            };
            console.log('[SecretStorage] Setup detected:', this.secretStorageSetup);
          }
        }

        // Proactively bootstrap cross-signing (without overwriting) to ensure 
        // this device is "ready to share" secrets with new verified devices.
        const crypto = this.client.getCrypto();
        if (crypto) {
          await crypto.bootstrapCrossSigning({ setupNewCrossSigning: false }).catch(e => {
            console.log('[SecretStorage] Background bootstrap (expected to fail if unverified):', e.message);
          });
        }
      } catch (e) {
        console.error('[SecretStorage] Failed to check setup:', e);
      }
    },


    // --- Verification Actions ---



    async submitSecretStorageKey(input: string) {
      if (!this.secretStoragePrompt || !this.client) return;

      const { promise, keyId, keyInfo } = this.secretStoragePrompt;

      try {
        let keyArray: Uint8Array;

        // Try to decode as Recovery Key (Base58)
        const cleanInput = input.trim();
        let isRecoveryKey = false;
        try {
          keyArray = decodeRecoveryKey(cleanInput);
          isRecoveryKey = true;
        } catch (e) {
          // Not a valid recovery key, assume passphrase
        }

        if (!isRecoveryKey) {
          if (keyInfo.passphrase) {
            keyArray = await deriveRecoveryKeyFromPassphrase(
              input,
              keyInfo.passphrase.salt,
              keyInfo.passphrase.iterations
            );
          } else {
            throw new Error("Input is not a valid recovery key and no passphrase info available.");
          }
        }

        // Validate the key mathematically
        const match = await this.client.secretStorage.checkKey(keyArray!, keyInfo);
        if (!match) {
          throw new Error("Invalid key: The provided recovery key or passphrase does not match.");
        }

        // Cache in memory Map for background SDK
        secretStorageKeys.set(keyId, keyArray! as Uint8Array<ArrayBuffer>);
        // Force persistence to localStorage so it survives page refresh
        persistSecretStorageKey(keyId, keyArray!);

        // Also cache in the Pinia record for any other listeners
        this.secretStorageKeyCache[keyId] = keyArray! as Uint8Array<ArrayBuffer>;

        // Resolve the callback's promise
        promise.resolve([keyId, keyArray! as Uint8Array<ArrayBuffer>]);
        this.secretStoragePrompt = null;

      } catch (e: any) {
        console.error("Failed to process secret storage key:", e);
        toast.error('Encryption Key Error', {
          description: e.message || "Failed to validate encryption key.",
        });
      }
    },

    cancelSecretStorageKey() {
      if (this.secretStoragePrompt) {
        this.secretStoragePrompt.promise.resolve(null); // Return null to indicate cancellation/skipping
        this.secretStoragePrompt = null;
      }
    },

    async requestVerification() {
      console.log('[Verification] Initiating outgoing verification request...');
      this.verificationModalOpen = true;
      this.isRequestingVerification = true;

      const crypto = this.client?.getCrypto();
      if (!crypto) {
        console.error('Crypto not available');
        toast.error('Encryption not ready', {
          description: 'The secure messaging stack is still initializing. Please wait a moment and try again.'
        });
        this.isRequestingVerification = false;
        return;
      }

      const userId = this.client?.getUserId();
      if (userId) {
        try {
          console.log('[Verification] Downloading own keys...');
          await this.client?.downloadKeysForUsers([userId]);
        } catch (e) {
          console.warn('[Verification] downloadKeysForUsers failed, continuing anyway:', e);
        }
      }

      try {
        // Cancel any existing request first to avoid conflicts
        if (this.activeVerificationRequest) {
          try {
            console.log('[Verification] Cancelling existing request before starting new one');
            await this.activeVerificationRequest.cancel();
          } catch (e) {
            console.warn("Failed to cancel previous verification request:", e);
          }
          this.activeVerificationRequest = null;
        }

        this.isVerificationCompleted = false;
        this.activeSas = null;

        const request = await crypto.requestOwnUserVerification();
        console.log('[Verification] Request created successfully:', {
          phase: request.phase,
          initiatedByMe: request.initiatedByMe,
          id: (request as any).transactionId
        });

        this.activeVerificationRequest = markRaw(request);
        this.isVerificationInitiatedByMe = request.initiatedByMe;
        this.verificationPhase = request.phase;
        this._attachRequestListeners(request);
      } catch (e) {
        console.error('Failed to request verification:', e);
        // Don't close modal, let it show the choice state or error
      } finally {
        this.isRequestingVerification = false;
      }
    },

    openVerificationModal() {
      this.verificationModalOpen = true;
    },

    closeVerificationModal() {
      this.verificationModalOpen = false;
      if (!this.activeVerificationRequest && !this.isVerificationCompleted) {
        // Only reset if we aren't in the middle of something or just finished
        this._resetVerificationState();
      }
    },

    setupCryptoListeners() {
      if (!this.client) return;

      // 1. Responder Logic (Old Device)
      // Listen for secret requests and share if the device is verified
      this.client.on("crypto.secrets.request" as any, async (request: any) => {
        const userId = request.userId;
        const deviceId = request.deviceId;

        console.log(`[Gossip] Secret request received for ${request.name} from ${deviceId}`);

        try {
          const crypto = this.client?.getCrypto();
          if (!crypto) return;

          const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
          if (status && (status as any).isVerified()) {
            console.log(`[Gossip] Device ${deviceId} is verified. Sharing ${request.name}...`);
            await request.share();
          } else {
            console.warn(`[Gossip] Unverified device ${deviceId} requested ${request.name}. Ignoring.`);
          }
        } catch (e) {
          console.error(`[Gossip] Error processing secret request from ${deviceId}:`, e);
        }
      });

      // 2. Receiver Logic (New Device)
      // Listen for secrets arriving to provide feedback and trigger recovery
      this.client.on("crypto.secrets.receiving" as any, (name: string) => {
        console.log(`[Gossip] Receiving secret: ${name}`);
      });

      this.client.on("crypto.secrets.received" as any, async (name: string) => {
        console.log(`[Gossip] Successfully received and stored: ${name}`);

        if (name === 'm.megolm_backup.v1') {
          console.log('[Gossip] Megolm backup key received! Triggering automated restoration...');
          // Load the key into crypto memory
          await this.loadSessionBackupPrivateKeyFromSecretStorage();
          // Restore the actual keys from server
          await this.restoreKeysFromBackup();
          // Retry decryption of any blocked messages
          await this.retryDecryption();

          // Close the modal if we were in the restoration phase
          this.isRestoringHistory = false;
          this.cancelSecretStorageKey();

          // If we've successfully restored history, we can likely reset the whole verification UI
          setTimeout(() => {
            if (this.isVerificationCompleted && !this.isRestoringHistory) {
              this._resetVerificationState();
            }
          }, 1000);
        } else if (name === 'm.cross_signing.master') {
          await this.checkDeviceVerified();
          this.cancelSecretStorageKey();
        }
      });
    },

    setupVerificationListeners() {
      if (!this.client) return;

      this.client.on(CryptoEvent.VerificationRequestReceived, (request: VerificationRequest) => {
        // 1. Ignore if we started this request ourselves (SDK handles this but double check)
        if (request.initiatedByMe) {
          console.log('[Verification] Ignoring loopback request:', (request as any).transactionId);
          return;
        }

        // 2. If we already have an active request that we initiated, ignore incoming ones 
        // until ours is resolved/cancelled to avoid UI flickering
        if (this.isVerificationInitiatedByMe && this.activeVerificationRequest && this.activeVerificationRequest.phase !== VerificationPhase.Cancelled && this.activeVerificationRequest.phase !== VerificationPhase.Done) {
          console.log('[Verification] Ignoring incoming request because we have an active outgoing one');
          return;
        }

        console.log('Incoming verification from:', request.otherUserId, (request as any).transactionId);

        // 3. Save it to state so your UI can pop open a modal
        this.activeVerificationRequest = markRaw(request);
        this.isVerificationInitiatedByMe = request.initiatedByMe;
        this.verificationPhase = request.phase;
        this.verificationModalOpen = true;

        // 4. Attach standard request listeners (handles Done/Cancelled)
        this._attachRequestListeners(request);
      });

      // Listen for security status changes to update UI in real-time
      this.client.on(CryptoEvent.KeysChanged, () => this.checkDeviceVerified());
      this.client.on(CryptoEvent.UserTrustStatusChanged, () => this.checkDeviceVerified());
    },

    _attachRequestListeners(request: VerificationRequest) {
      const checkPhase = async () => {
        try {
          const phase = request.phase;
          this.verificationPhase = phase;
          this.isVerificationInitiatedByMe = request.initiatedByMe;
          const isTerminal = phase === VerificationPhase.Done || phase === VerificationPhase.Cancelled;

          console.log(`[Verification] Phase changed: ${phase} (initiatedByMe: ${this.isVerificationInitiatedByMe})`);

          let methods: string[] = [];
          try {
            methods = (request as any).methods || [];
          } catch (e) {
            if (!isTerminal) console.warn('[Verification] methods not available');
          }

          if (phase === VerificationPhase.Ready) {
            // Check for QR code data
            const qrData = (request as any).qrCodeData;
            if (qrData) {
              // We store the raw QRCode object so we can use its methods if needed,
              // or extract encoded data.
              this.qrCodeData = qrData;
              console.log('[Verification] QR code data available');
            } else {
              this.qrCodeData = null;
            }

            // Initiator auto-starts SAS only if QR is not an option
            const canShowQr = (request as any).qrCodeData || request.otherPartySupportsMethod('m.qr_code.scan.v1');
            const canScanQr = request.otherPartySupportsMethod('m.qr_code.show.v1');
            const qrPossible = canShowQr || canScanQr;

            if (this.isVerificationInitiatedByMe && (methods.includes('m.sas.v1') || methods.length === 0) && !request.verifier && !this.activeSas && !qrPossible) {
              console.log('[Verification] Auto-starting SAS (no QR support detected)...');
              try {
                const verifier = await request.startVerification('m.sas.v1');
                this._setupVerifierListeners(verifier);
              } catch (e) {
                console.error('[Verification] Proactive start failed:', e);
              }
            } else if (qrPossible) {
              console.log('[Verification] QR support detected, waiting for user or reciprocal scan.');
            }
          } else if (phase === VerificationPhase.Started) {
            const verifier = request.verifier;
            if (verifier && !this._isVerifierSetup(verifier)) {
              this._setupVerifierListeners(verifier);
            }
          } else if (phase === VerificationPhase.Done) {
            this.isVerificationCompleted = true;
            this.activeSas = null;
            this.isRestoringHistory = true; // Show "Syncing History..." spinner

            // If we were prompting for a secret key, clear it since verification 
            // should provide the keys via gossip soon.
            this.cancelSecretStorageKey();

            await this.checkDeviceVerified();

            // Proactively trigger gossip once trusted
            await this.requestSecretsFromOtherDevices();

            // Use a longer timeout for the "grace period" before falling back to manual input
            setTimeout(async () => {
              // Final check: did secrets arrive?
              await this.restoreKeysFromBackup();

              // Resolve any deferred requests if gossip provided the keys
              const satisfiedIndices: number[] = [];
              for (let i = 0; i < this.pendingSecretStorageRequests.length; i++) {
                const req = this.pendingSecretStorageRequests[i];
                if (!req) continue;
                if (secretStorageKeys.has(req.keyId)) {
                  console.log(`[SecretStorage] Resolving deferred request for ${req.keyId} via gossip.`);
                  req.promise.resolve([req.keyId, secretStorageKeys.get(req.keyId)!]);
                  satisfiedIndices.push(i);
                }
              }
              satisfiedIndices.slice().reverse().forEach(idx => this.pendingSecretStorageRequests.splice(idx, 1));

              // End the restoration phase
              this.isRestoringHistory = false;

              // If any requests remain, they likely need a manual security key.
              if (this.pendingSecretStorageRequests.length > 0) {
                console.log('[SecretStorage] Gossip did not provide keys, showing manual prompt.');
                const nextReq = this.pendingSecretStorageRequests.shift();
                if (nextReq) {
                  this.secretStoragePrompt = nextReq;
                  this.verificationModalOpen = true;
                }
              }

              await this.retryDecryption();

              // If we are fully decrypted now, we can probably close the modal
              if (!this.secretStoragePrompt) {
                setTimeout(() => this._resetVerificationState(), 1000);
              }
            }, 5000); // 5 second grace period for gossip

            toast.success('Device verified!');
          } else if (phase === VerificationPhase.Cancelled) {
            this._resetVerificationState();
          }

          if (isTerminal) {
            request.off(VerificationRequestEvent.Change, checkPhase);
          }
        } catch (err) {
          console.error('[Verification] Error in checkPhase:', err);
        }
      };

      request.on(VerificationRequestEvent.Change, checkPhase);
      checkPhase();
    },

    _setupVerifierListeners(verifier: Verifier) {
      if (this._isVerifierSetup(verifier)) return;

      console.log('[Verification] Setting up listeners for verifier:', verifier.userId);
      this.isSasTimeout = false;

      // Timeout Guard: If SAS doesn't progress within 15 seconds, flag it.
      const sasTimeout = setTimeout(() => {
        if (!this.activeSas && !this.isVerificationCompleted) {
          console.warn('[Verification] SAS Exchange timed out before emoji display.');
          this.isSasTimeout = true;
        }
      }, 15000);

      const onShowSas = (sas: ShowSasCallbacks) => {
        clearTimeout(sasTimeout);
        this.isSasTimeout = false;

        // Defensive Guard: Validate negotiation before showing UI
        const method = (verifier as any).getChosenSasMethod?.() || 'm.sas.v1';
        if (method !== 'm.sas.v1') {
          console.warn(`[Verification] Negotiation failed: unexpected method ${method}`);
          this.isCryptoDegraded = true;
          this.cryptoStatusMessage = "Security negotiation failed. Methods mismatch.";
          return;
        }

        console.log('[Verification] SAS data received, showing emojis.');
        this.activeSas = sas;
      };

      const onCancel = () => {
        clearTimeout(sasTimeout);
        console.warn('[Verification] Verifier cancelled by remote.');
        cleanup();
        this._resetVerificationState();
      };

      const cleanup = () => {
        console.log('[Verification] Cleaning up verifier listeners.');
        verifier.off(VerifierEvent.ShowSas, onShowSas);
        verifier.off(VerifierEvent.Cancel, onCancel);
      };

      verifier.on(VerifierEvent.ShowSas, onShowSas);
      verifier.on(VerifierEvent.Cancel, onCancel);

      // Kick off the verification exchange
      console.log('[Verification] Kicking off verifier.verify()...');
      verifier.verify().then(() => {
        clearTimeout(sasTimeout);
        cleanup();
      }).catch((e) => {
        clearTimeout(sasTimeout);
        console.error('[Verification] verifier.verify() failed:', e);
        cleanup();
        // Only reset if it's a real error, not just a cancellation we handled
        if (!(verifier as any).hasBeenCancelled) {
          this._resetVerificationState();
        }
      });
    },

    _isVerifierSetup(verifier: Verifier): boolean {
      // Use the internal event emitter count as a robust check
      return verifier.listenerCount(VerifierEvent.ShowSas) > 0;
    },

    async acceptVerification() {
      if (!this.activeVerificationRequest) return;
      const request = this.activeVerificationRequest;

      try {
        if (request.phase === VerificationPhase.Ready) {
          // If already Ready, "Accept" means "Start the exchange"
          console.log('[Verification] Manual Accept: Request is already Ready, starting SAS...');
          const verifier = await request.startVerification('m.sas.v1');
          this._setupVerifierListeners(verifier);
        } else if (request.phase < VerificationPhase.Ready) {
          // Otherwise, we need to send the 'ready' event
          console.log('[Verification] Manual Accept: Sending .ready event...');
          await request.accept();
        } else {
          console.warn('[Verification] Manual Accept: Request is already in phase', request.phase);
        }
      } catch (e) {
        console.error('Failed to accept verification:', e);
        toast.error('Failed to handle verification request');
        this._resetVerificationState();
      }
    },

    async reciprocateQrCode(scannedData: string | Uint8ClampedArray) {
      if (!this.activeVerificationRequest) return;

      console.log('[QRVerification] Reciprocating QR code...');
      try {
        let uint8Array: Uint8ClampedArray;

        if (scannedData instanceof Uint8ClampedArray) {
          uint8Array = scannedData;
        } else {
          // Fallback for legacy string format: matrix-qrcode/...base64...
          const parts = scannedData.split('/');
          const base64 = parts[parts.length - 1];
          const binaryString = atob(base64 || '');
          uint8Array = new Uint8ClampedArray(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            uint8Array[i] = binaryString.charCodeAt(i);
          }
        }

        // Call the official SDK method for scanning a QR code
        // (request as any) because the interface might not have scanQRCode exported if the type definitions are lagging
        const verifier = await (this.activeVerificationRequest as any).scanQRCode(uint8Array);
        this._setupVerifierListeners(verifier);

        console.log('[QRVerification] Reciprocal scan successful.');
      } catch (e) {
        console.error('[QRVerification] Failed to reciprocate QR code:', e);
        toast.error('Invalid QR code', {
          description: 'The scanned data is not a valid Matrix verification code.'
        });
      }
    },

    async confirmSasMatch(match: boolean = true) {
      if (!this.activeSas) return;
      try {
        if (match) {
          await this.activeSas.confirm();
        } else {
          await this.activeSas.mismatch();
          this.activeVerificationRequest?.cancel();
        }
        // Hide emojis while waiting for Done phase
        this.activeSas = null;
      } catch (e) {
        console.error('Failed to confirm SAS:', e);
        toast.error('Verification failed');
        this._resetVerificationState();
      }
    },

    async cancelVerification() {
      if (this.activeVerificationRequest) {
        try {
          await this.activeVerificationRequest.cancel();
        } catch (e) {
          console.error('Failed to cancel verification:', e);
        }
      }
      this._resetVerificationState();
    },

    async checkDeviceVerified() {
      const crypto = this.client?.getCrypto();
      if (!crypto) return;
      const userId = this.client?.getUserId();
      const deviceId = this.client?.getDeviceId();
      if (!userId || !deviceId) return;

      try {
        const wasReady = this.isCrossSigningReady;

        // Force download our own keys to ensure we see our cross-signing status correctly
        // and that other devices see us as verified so they can share secrets.
        await this.client?.downloadKeysForUsers([userId]);

        // Refresh security status
        this.isCrossSigningReady = await crypto.isCrossSigningReady();
        this.isSecretStorageReady = await crypto.isSecretStorageReady();

        console.log('[Verification] Status:', {
          crossSigningReady: this.isCrossSigningReady,
          secretStorageReady: this.isSecretStorageReady
        });

        // If we just became verified/ready, attempt to decrypt any blocked messages
        if (!wasReady && this.isCrossSigningReady) {
          console.log('[Verification] Cross-signing is now ready. Triggering secret gossip and re-decryption...');

          // Request secrets just in case they haven't arrived yet
          this.requestSecretsFromOtherDevices();

          // Ensure we try to restore history if we now have the keys
          await this.restoreKeysFromBackup();

          // Provision a dehydrated device now that we are verified
          this.provisionDehydratedDevice();

          // Don't await this, let it run in background so UI updates immediately
          this.retryDecryption();
        }
      } catch (e) {
        console.error('Failed to check device verification:', e);
      }
    },

    /**
     * Phase 1: Startup Rehydration
     * Attempt to rehydrate a device if one exists on the server.
     */
    async handleStartupDehydration() {
      if (!this.client) return;
      const crypto = this.client.getCrypto();
      if (!crypto) return;

      console.log("[Dehydration] Checking for dehydrated devices...");
      try {
        // Start dehydration logic with rehydrate: true
        // This will attempt to rehydrate if a device exists.
        // Use any to bypass outdated type definitions and ensure correct 'this' context.
        await (crypto as any).startDehydration.call(crypto, {
          rehydrate: true,
          onlyIfKeyCached: false,
        });

        // After rehydration attempt, check if we need maintenance
        this.maintenanceDehydration();
      } catch (e) {
        console.warn("[Dehydration] Startup rehydration failed (expected if none exist):", e);
      }
    },

    /**
     * Phase 2: Post-Verification Provisioning
     * Once verified, ensure a dehydrated device is created so future sessions can rehydrate.
     */
    async provisionDehydratedDevice() {
      if (!this.client || !this.isCrossSigningReady) return;
      const crypto = this.client.getCrypto();
      if (!crypto) return;

      console.log("[Dehydration] Provisioning dehydrated device...");
      try {
        await (crypto as any).startDehydration.call(crypto, {
          rehydrate: false,
          onlyIfKeyCached: false,
        });
        console.log("[Dehydration] Dehydrated device provisioned successfully.");
      } catch (e) {
        console.error("[Dehydration] Failed to provision dehydrated device:", e);
      }
    },

    /**
     * Phase 3: Throttled Maintenance
     * Ensure the dehydrated device is rotated/updated periodically.
     */
    async maintenanceDehydration() {
      if (!this.client || !this.isCrossSigningReady) return;

      // Throttle to once every 24 hours + random jitter (0-4 hours)
      const lastRun = await getPref('matrix_crypto_dehydration_last_run', 0);
      const now = Date.now();
      const jitter = Math.floor(Math.random() * 4 * 60 * 60 * 1000);
      const threshold = 24 * 60 * 60 * 1000 + jitter;

      if (now - lastRun < threshold) {
        return;
      }

      console.log("[Dehydration] Running maintenance...");
      try {
        const crypto = this.client.getCrypto();
        if (crypto) {
          await (crypto as any).startDehydration.call(crypto, {
            rehydrate: false,
            onlyIfKeyCached: true, // Only rotate if we already have the keys cached
          });
          await setPref('matrix_crypto_dehydration_last_run', now);
          console.log("[Dehydration] Maintenance complete.");
        }
      } catch (e) {
        console.error("[Dehydration] Maintenance failed:", e);
      }
    },

    // --- File Upload ---

    async uploadFile(roomId: string, file: File) {
      if (!this.client) return;

      const isEncrypted = this.client.isRoomEncrypted(roomId);
      let contentUrl: string | undefined;
      let encryptedFile: any = undefined;

      // Determine message type
      let msgType = MsgType.File;
      if (file.type.startsWith('image/')) msgType = MsgType.Image;
      else if (file.type.startsWith('video/')) msgType = MsgType.Video;
      else if (file.type.startsWith('audio/')) msgType = MsgType.Audio;

      // Extract image dimensions if possible
      let info: any = {
        size: file.size,
        mimetype: file.type,
      };

      if (msgType === MsgType.Image) {
        try {
          const dims = await this._getImageDimensions(file);
          info.w = dims.w;
          info.h = dims.h;
        } catch (e) {
          console.warn('Failed to get image dimensions', e);
        }
      }

      if (isEncrypted) {
        // Encrypt
        const data = await file.arrayBuffer();
        const encryptionResult = await this._encryptAttachment(data);

        // Upload ciphertext
        const blob = new Blob([encryptionResult.data], { type: 'application/octet-stream' });
        const response = await this.client.uploadContent(blob, {
          type: 'application/octet-stream',
        });

        encryptedFile = {
          ...encryptionResult.info,
          url: response.content_uri,
          mimetype: file.type, // Spec says mimetype should be here too
        };
      } else {
        // Plaintext
        const response = await this.client.uploadContent(file);
        contentUrl = response.content_uri;
      }

      // Construct content
      const content: any = {
        body: file.name || 'Attachment',
        msgtype: msgType,
        info,
      };

      if (isEncrypted) {
        content.file = encryptedFile;
      } else {
        content.url = contentUrl!;
      }

      await this.client.sendEvent(roomId, EventType.RoomMessage, content);
    },

    async _encryptAttachment(data: ArrayBuffer) {
      // 1. Generate 32-byte AES-CTR key
      const keyFn = await window.crypto.subtle.generateKey(
        { name: 'AES-CTR', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      const exportedKey = await window.crypto.subtle.exportKey('jwk', keyFn);

      // Generate IV (Counter Block)
      const iv = window.crypto.getRandomValues(new Uint8Array(16));
      if (iv[8]) iv[8] &= 0x7f;

      // Encrypt
      const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-CTR', counter: iv, length: 64 },
        keyFn,
        data
      );

      // SHA-256 hash
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', ciphertext);

      return {
        data: ciphertext,
        info: {
          v: 'v2',
          key: {
            alg: 'A256CTR',
            k: exportedKey.k!,
            ext: true,
            key_ops: ['encrypt', 'decrypt'],
            kty: 'oct'
          },
          iv: sdk.encodeBase64(iv),
          hashes: {
            sha256: sdk.encodeUnpaddedBase64(new Uint8Array(hashBuffer))
          }
        }
      };
    },

    _getImageDimensions(file: File): Promise<{ w: number, h: number }> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          resolve({ w: img.naturalWidth, h: img.naturalHeight });
          URL.revokeObjectURL(url);
        };
        img.onerror = reject;
        img.src = url;
      });
    },

    _resetVerificationState() {
      console.log('[Verification] Resetting state');
      this.activeVerificationRequest = null;
      this.isVerificationInitiatedByMe = false;
      this.isRequestingVerification = false;
      this.activeSas = null;
      this.qrCodeData = null;
      this.isVerificationCompleted = false;
      this.verificationPhase = null;
      this.isRestoringHistory = false;
      this.activeVerificationRequest = null;
      this.verificationModalOpen = false;
    },

    async bootstrapVerification() {
      if (!this.client) return;
      const crypto = this.client.getCrypto();
      if (!crypto) return;

      try {
        console.log("Bootstrapping verification and secret storage...");
        this.verificationModalOpen = true;
        this.isRequestingVerification = true;

        // 1. Bootstrap Cross-Signing (find or create keys)
        // We use setupNewCrossSigning: false to attempt rehydrating existing keys
        // from secret storage rather than blowing them away and creating new ones
        // which would invalidate other devices.
        await crypto.bootstrapCrossSigning({
          setupNewCrossSigning: false
        });

        // 2. Bootstrap Secret Storage (ensure we have access to secrets)
        await crypto.bootstrapSecretStorage({
          setupNewSecretStorage: false
        });

        // Update local state and trigger re-decryption
        await this.checkDeviceVerified();
        await this.restoreKeysFromBackup();
        await this.retryDecryption();

        if (this.isCrossSigningReady) {
          this.isVerificationCompleted = true;
          this.verificationModalOpen = true; // Stay open to show success
          setTimeout(() => this._resetVerificationState(), 3000);
        }
      } catch (e) {
        console.error("Bootstrap failed:", e);
      } finally {
        this.isRequestingVerification = false;
      }
    },

    async restoreKeysFromBackup() {
      if (!this.client || this.isRestoringKeys) return;
      const crypto = this.client.getCrypto();
      if (!crypto) return;

      this.isRestoringKeys = true;
      console.log("[SecretGossiping] Checking for historical key backups...");
      try {
        const backupInfo = await crypto.getKeyBackupInfo();
        if (!backupInfo) {
          console.log("[SecretGossiping] No key backup found on server.");
          this.isRestoringKeys = false;
          return;
        }

        // 1. Wait for secrets to arrive via gossip (Secret Sharing)
        // We poll for up to 10 seconds (20 * 500ms) to be patient with cross-network gossip
        console.log("[SecretGossiping] Polling for backup key via gossip...");
        // @ts-ignore - access internal crypto method if needed
        let backupKey = await (crypto as any).getSessionBackupPrivateKey();
        let attempts = 0;
        const maxAttempts = 20;

        while (!backupKey && attempts < maxAttempts) {
          // Logic: Wait, then check
          await new Promise(r => setTimeout(r, 500));
          backupKey = await (crypto as any).getSessionBackupPrivateKey();
          attempts++;

          if (backupKey) {
            console.log(`[SecretGossiping] Backup key received via gossip after ${attempts * 0.5}s!`);
            break;
          }

          if (attempts % 4 === 0) {
            console.log(`[SecretGossiping] Still waiting for gossip... (${attempts * 0.5}s)`);
          }
        }

        // 2. Fallback to SSSS if gossip failed
        if (!backupKey) {
          console.warn("[SecretGossiping] Gossip timed out after 10s. Falling back to manual Secret Storage prompt.");
          await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
        }

        // 3. Restore the backup
        console.log("[SecretGossiping] Restoring keys from backup...");
        await crypto.restoreKeyBackup({
          progressCallback: (p) => {
            if (p.stage === 'load_keys' && p.total > 0) {
              if (p.successes % 100 === 0 || p.successes === p.total) {
                console.log(`[SecretGossiping] Restoring keys: ${p.successes}/${p.total}`);
              }
            }
          }
        });
        await crypto.checkKeyBackupAndEnable();
        console.log("[SecretGossiping] History restoration complete.");
      } catch (err) {
        console.warn("[SecretGossiping] Failed to restore keys from backup:", err);
      } finally {
        this.isRestoringKeys = false;
        this.isRestoringHistory = false;
      }
    },

    async requestSecretsFromOtherDevices() {
      if (!this.client) return;

      console.log('[SecretGossiping] Checking for available secrets and initiating gossip if needed...');

      try {
        // Trigger the gossip mechanism (broadcasts m.secret_storage.request)
        // checkOwnCrossSigningTrust audits the local state and requests missing secrets.
        if (typeof (this.client as any).checkOwnCrossSigningTrust === 'function') {
          console.log('[SecretGossiping] Triggering checkOwnCrossSigningTrust...');
          await (this.client as any).checkOwnCrossSigningTrust();
        }

        // With Rust crypto, we also try to pull the megolm backup key once we have 4S access.
        await this.loadSessionBackupPrivateKeyFromSecretStorage().catch(err => {
          console.warn('[SecretGossiping] Automatic backup key load failed (expected if not yet verified or no backup exists):', err);
        });

        console.log('[SecretGossiping] Background secret sync initiated.');
      } catch (e) {
        console.error('[SecretGossiping] Error during secret sync:', e);
      }
    },

    async loadSessionBackupPrivateKeyFromSecretStorage() {
      if (!this.client) return;
      const crypto = this.client.getCrypto();
      if (!crypto) return;

      console.log('[SecretStorage] Attempting to load Megolm backup key from secret storage...');
      try {
        await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
        console.log('[SecretStorage] Successfully loaded Megolm backup key.');
        // Trigger decryption retry since we now have the backup key
        (this as any).retryDecryption();
      } catch (e) {
        console.warn('[SecretStorage] Failed to load backup key from secret storage:', e);
        throw e;
      }
    },


    async retryDecryption() {
      if (!this.client) return;
      const crypto = this.client.getCrypto();
      const rooms = this.client.getRooms();

      console.log(`Retrying decryption for ${rooms.length} rooms...`);

      const retryRoom = async (index: number) => {
        if (index >= rooms.length || !this.client) {
          console.log('[MatrixStore] Finished retrying decryption for all rooms.');
          return;
        }

        const room = rooms[index];
        if (!room) {
          setTimeout(() => retryRoom(index + 1), 0);
          return;
        }

        // Search through all cached timelines for this room
        const timelineSets = [room.getUnfilteredTimelineSet()];
        for (const timelineSet of timelineSets) {
          const timelines = (timelineSet as any).getTimelines?.() || [];
          for (const timeline of timelines) {
            const events = timeline.getEvents();
            for (const event of events) {
              if (event.isDecryptionFailure()) {
                await event.attemptDecryption(this.client.getCrypto() as any, { isRetry: true });
              }
            }
          }

          // Also check the live timeline events directly as a fallback
          const liveEvents = timelineSet.getLiveTimeline().getEvents();
          for (const event of liveEvents) {
            if (event.isDecryptionFailure()) {
              await event.attemptDecryption(this.client.getCrypto() as any, { isRetry: true });
            }
          }
        }

        setTimeout(() => retryRoom(index + 1), 0);
      };

      retryRoom(0);
    },

    // Reset the session and redirect to login
    async logout() {
      // Stop RPC server on logout
      await this.stopRpcServer();
      if (this.isLoggingOut) {
        console.warn("[MatrixStore] Logout already in progress, skipping duplicate call.");
        return;
      }
      this.isLoggingOut = true;
      console.log("Logging out...");

      try {
        // Stop the Matrix client (Kill Sync & Crypto)
        if (this.client) {
          await this.client.stopClient();
          // Skip this.client.clearStores() as it can trigger legacy crypto errors in Rust-crypto mode
          this.client.removeAllListeners();
        }

        // Clear Pinia State
        this.client = null;
        this.user = null;
        this.isAuthenticated = false;
        this.isSyncing = false;
        this.isClientReady = false;
        this._resetVerificationState();

        // Wipe Tauri Storage, remove critical session data
        await deleteSecret('matrix_access_token');
        await deleteSecret('matrix_refresh_token');
        await deletePref('matrix_user_id');
        await deletePref('matrix_device_id');

        // CRITICAL FOR CRYPTO RESYNC:
        // Also purge from localStorage in case it leaked or was cached there, 
        // preventing "UISI / Device Not Verified" loops on next login.
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('matrix_device_id');
        }

        // Remove OIDC data (forces fresh discovery/registration next time)
        await deletePref('matrix_oidc_config');
        await deletePref('matrix_oidc_client_id');
        await deletePref('matrix_oidc_nonce');
        await deletePref('matrix_oidc_issuer');
        await deletePref('matrix_oidc_id_token_claims');

        // Clear all local stores
        await this._clearPersistentStores();

        // Redirect to landing page
        await navigateTo('/');
      } finally {
        this.isLoggingOut = false;
      }
    },

    async refreshRoom(roomId: string) {
      if (!this.client) return;
      console.log(`[MatrixStore] Manual refresh requested for room: ${roomId}`);

      // If sync has stopped for some reason, restart it
      if (!this.isSyncing) {
        console.log('[MatrixStore] Sync was stopped, restarting...');
        await this.client.startClient();
      }
    },

    async performCryptoSanityCheck() {
      if (!this.client) return;

      try {
        const crypto = this.client.getCrypto();
        if (!crypto) return;

        // Query the server for the current device's OTK count
        // Note: Using the internal API as a sanity check.
        // We use the path without leading slash to avoid double-prefixing in some SDK versions.
        const res = await (this.client as any).getInternalHttpApi().authedRequest(
          sdk.Method.Post,
          "keys/upload",
          {},
          {}
        );

        const otkCounts = res.one_time_key_counts || {};
        const signedCurveCount = otkCounts['signed_curve25519'] || 0;

        console.log(`[CryptoSanity] Server OTK Count: ${signedCurveCount}`);

        // If the server has 0 OTKs, it's a strong sign of a desync or exhausted keys.
        if (signedCurveCount === 0) {
          console.error("🚨 [CryptoSanity] FATAL: Server reports 0 One-Time Keys for this device!");
          this.isCryptoDegraded = true;
          this.cryptoStatusMessage = "Encryption keys exhausted. Security repair required.";

          toast.error("Encryption Warning", {
            description: "Your security keys are out of sync. Click to repair.",
            duration: 15000,
            action: {
              label: "Repair",
              onClick: () => { this.openVerificationModal(); }
            }
          });
        }
      } catch (e) {
        console.warn("[CryptoSanity] Check failed (non-fatal):", e);
      }
    },

    async repairCrypto() {
      if (!this.client) return;
      const userId = this.client.getUserId();
      console.warn(`🚨 [MatrixStore] Starting manual crypto repair for ${userId}...`);
      this.loginStatus = 'Repairing encryption…';

      try {
        // 1. Stop the current client
        this.client.stopClient();
        this.client.removeAllListeners();

        // 2. Target specific crypto stores for deletion while keeping room store if possible
        const deleteDb = (name: string) => new Promise<void>((resolve) => {
          const req = window.indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => { console.warn(`IndexedDB delete blocked: ${name}`); resolve(); };
        });

        // Wipe both legacy and modern (Rust) crypto databases
        const dbsToWipe = [
          'matrix-js-sdk::matrix-sdk-crypto',
          'matrix-js-sdk::matrix-sdk-crypto-meta',
          'matrix-js-sdk::crypto-store'
        ];

        if (userId) {
          dbsToWipe.push(`matrix-sdk-crypto-${userId}`);
          dbsToWipe.push(`matrix-sdk-crypto-meta-${userId}`);
        }

        await Promise.all(dbsToWipe.map(name => deleteDb(name)));

        // 3. Clear local device ID so we get a fresh one if the desync was device-bound
        await deletePref('matrix_device_id');
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('matrix_device_id');
        }

        // 4. Re-initialize
        const accessToken = await getSecret('matrix_access_token');
        const userId = await getPref('matrix_user_id');
        if (accessToken && userId) {
          // This will effectively restart everything
          window.location.reload();
        } else {
          this.logout();
        }
      } catch (e) {
        console.error("[MatrixStore] Crypto repair failed:", e);
        toast.error("Repair Failed", {
          description: "Please try logging out and back in.",
        });
      }
    },

    async resetSecurity() {
      this.openConfirmationDialog({
        title: "Reset All Security?",
        description: "This will log you out and clear all local encryption keys. You will need your Recovery Key or another device to access your history after logging back in.",
        confirmLabel: "Reset & Logout",
        onConfirm: () => {
          this.logout();
        }
      });
    },

    async _clearPersistentStores() {
      const userId = this.client?.getUserId();
      const deleteDb = (name: string) => new Promise<void>((resolve) => {
        const req = window.indexedDB.deleteDatabase(name);
        req.onsuccess = () => {
          console.log(`[MatrixStore] Database deleted: ${name}`);
          resolve();
        };
        req.onerror = () => {
          console.warn(`[MatrixStore] Error deleting database: ${name}`);
          resolve();
        };
        req.onblocked = () => {
          console.warn(`[MatrixStore] DB delete blocked: ${name}`);
          resolve();
        };
      });

      console.log('[MatrixStore] Clearing all persistent stores...');
      const dbsToWipe = [
        'matrix-js-sdk::matrix-store',
        'matrix-js-sdk::matrix-sdk-crypto',
        'matrix-js-sdk::matrix-sdk-crypto-meta',
        'matrix-js-sdk::crypto-store'
      ];

      if (userId) {
        dbsToWipe.push(`matrix-sdk-crypto-${userId}`);
        dbsToWipe.push(`matrix-sdk-crypto-meta-${userId}`);
      }

      await Promise.all(dbsToWipe.map(name => deleteDb(name))).catch(e => console.error('[MatrixStore] Error during DB wiping:', e));
      console.log('[MatrixStore] Finished clearing persistent stores');
    },

    // --- Room & Space Management ---
    openGlobalSearchModal() {
      this.globalSearchModalOpen = true;
    },

    closeGlobalSearchModal() {
      this.globalSearchModalOpen = false;
    },

    openCreateRoomModal() {
      this.createRoomModalOpen = true;
      this.globalSearchModalOpen = false;
    },

    closeCreateRoomModal() {
      this.createRoomModalOpen = false;
    },

    openCreateSpaceModal() {
      this.createSpaceModalOpen = true;
      this.globalSearchModalOpen = false;
    },

    closeCreateSpaceModal() {
      this.createSpaceModalOpen = false;
    },

    openRoomSettingsModal(roomId: string) {
      this.activeSettingsRoomId = roomId;
      this.roomSettingsModalOpen = true;
    },

    closeRoomSettingsModal() {
      this.roomSettingsModalOpen = false;
      this.activeSettingsRoomId = null;
    },

    openSpaceSettingsModal(spaceId: string) {
      this.activeSettingsSpaceId = spaceId;
      this.spaceSettingsModalOpen = true;
    },

    closeSpaceSettingsModal() {
      this.spaceSettingsModalOpen = false;
      this.activeSettingsSpaceId = null;
    },

    async createRoom(opts: {
      name: string;
      topic?: string;
      isPublic?: boolean;
      enableEncryption?: boolean;
      roomAliasName?: string;
      spaceId?: string;
    }): Promise<string | undefined> {
      if (!this.client) throw new Error("Matrix client not initialized.");
      console.log(`[MatrixStore] Creating room: ${opts.name}...`);

      try {
        const createOpts: any = {
          name: opts.name,
          topic: opts.topic,
          visibility: opts.isPublic ? sdk.Visibility.Public : sdk.Visibility.Private,
          preset: opts.isPublic ? sdk.Preset.PublicChat : sdk.Preset.PrivateChat,
          initial_state: []
        };

        if (opts.enableEncryption) {
          createOpts.initial_state.push({
            type: "m.room.encryption",
            state_key: "",
            content: { algorithm: "m.megolm.v1.aes-sha2" }
          });
        }

        if (opts.roomAliasName) {
          createOpts.room_alias_name = opts.roomAliasName;
        }

        const result = await this.client.createRoom(createOpts);
        const roomId = result.room_id;

        // If a spaceId is provided, add the room to the space
        if (opts.spaceId) {
          await this.addRoomToSpace(opts.spaceId, roomId);
        }

        console.log(`[MatrixStore] Created room ${roomId}`);
        return roomId;
      } catch (err: any) {
        console.error("[MatrixStore] Failed to create room:", err);
        throw new Error(err.message || "Failed to create room.");
      }
    },

    async createSpace(opts: {
      name: string;
      topic?: string;
      isPublic?: boolean;
      roomAliasName?: string;
    }): Promise<string | undefined> {
      if (!this.client) throw new Error("Matrix client not initialized.");
      console.log(`[MatrixStore] Creating space: ${opts.name}...`);

      try {
        const createOpts: any = {
          name: opts.name,
          topic: opts.topic,
          visibility: opts.isPublic ? sdk.Visibility.Public : sdk.Visibility.Private,
          preset: opts.isPublic ? sdk.Preset.PublicChat : sdk.Preset.PrivateChat,
          creation_content: {
            type: "m.space"
          }
        };

        if (opts.roomAliasName) {
          createOpts.room_alias_name = opts.roomAliasName;
        }

        const result = await this.client.createRoom(createOpts);
        console.log(`[MatrixStore] Created space ${result.room_id}`);
        return result.room_id;
      } catch (err: any) {
        console.error("[MatrixStore] Failed to create space:", err);
        throw new Error(err.message || "Failed to create space.");
      }
    },

    async addRoomToSpace(spaceId: string, roomId: string) {
      if (!this.client) return;
      try {
        // Add child to space
        await this.client.sendStateEvent(spaceId, "m.space.child", {
          via: [this.client.getDomain()!],
          suggested: false
        }, roomId);

        // Add parent to room
        await this.client.sendStateEvent(roomId, "m.space.parent", {
          via: [this.client.getDomain()!],
          canonical: true
        }, spaceId);

        console.log(`[MatrixStore] Added room ${roomId} to space ${spaceId}`);
      } catch (err) {
        console.error(`[MatrixStore] Failed to add room ${roomId} to space ${spaceId}:`, err);
        throw err;
      }
    },

    async updateRoomMetadata(roomId: string, metadata: { name?: string; topic?: string; avatarFile?: File }) {
      if (!this.client) return;
      try {
        if (metadata.name) {
          await this.client.setRoomName(roomId, metadata.name);
        }
        if (metadata.topic) {
          await this.client.setRoomTopic(roomId, metadata.topic);
        }
        if (metadata.avatarFile) {
          const response = await this.client.uploadContent(metadata.avatarFile);
          await this.client.sendStateEvent(roomId, "m.room.avatar", { url: response.content_uri }, "");
        }
        toast.success("Settings updated successfully");
      } catch (err: any) {
        console.error("[MatrixStore] Failed to update room metadata:", err);
        toast.error("Failed to update settings", { description: err.message });
      }
    },

    async kickUser(roomId: string, userId: string, reason?: string) {
      if (!this.client) return;
      try {
        await this.client.kick(roomId, userId, reason);
        toast.success(`Kicked user ${userId}`);
      } catch (err: any) {
        console.error("[MatrixStore] Failed to kick user:", err);
        toast.error("Failed to kick user", { description: err.message });
      }
    },

    async banUser(roomId: string, userId: string, reason?: string) {
      if (!this.client) return;
      try {
        await this.client.ban(roomId, userId, reason);
        toast.success(`Banned user ${userId}`);
      } catch (err: any) {
        console.error("[MatrixStore] Failed to ban user:", err);
        toast.error("Failed to ban user", { description: err.message });
      }
    },

    async setRoomJoinRule(roomId: string, joinRule: string) {
      if (!this.client) return;
      try {
        await this.client.sendStateEvent(roomId, "m.room.join_rules", { join_rule: joinRule }, "");
        toast.success("Join rules updated");
      } catch (err: any) {
        console.error("Failed to set join rules:", err);
        toast.error("Failed to update join rules", { description: err.message });
      }
    },

    async setRoomDirectoryVisibility(roomId: string, visibility: sdk.Visibility) {
      if (!this.client) return;
      try {
        await this.client.setRoomDirectoryVisibility(roomId, visibility);
        toast.success("Room visibility updated");
      } catch (err: any) {
        console.error("Failed to set room visibility:", err);
        toast.error("Failed to update visibility", { description: err.message });
      }
    },

    async joinRoom(roomIdOrAlias: string): Promise<any> {
      if (!this.client) throw new Error("Matrix client not initialized.");
      console.log(`[MatrixStore] Joining room ${roomIdOrAlias}...`);

      try {
        const result = await this.client.joinRoom(roomIdOrAlias);
        console.log(`[MatrixStore] Joined room ${result.roomId}`);
        return result;
      } catch (err: any) {
        console.error("[MatrixStore] Failed to join room:", err);
        throw new Error(err.message || "Failed to join room.");
      }
    },

    async createDirectRoom(userId: string): Promise<string | undefined> {
      if (!this.client) throw new Error("Matrix client not initialized.");
      console.log(`[MatrixStore] Creating direct room with ${userId}...`);

      try {
        const result = await this.client.createRoom({
          is_direct: true,
          invite: [userId],
          preset: sdk.Preset.TrustedPrivateChat,
        });

        console.log(`[MatrixStore] Created room ${result.room_id}`);
        return result.room_id;
      } catch (err: any) {
        console.error("[MatrixStore] Failed to create direct room:", err);
        throw new Error(err.message || "Failed to create room.");
      }
    },

    async setLastVisitedRoom(context: 'dm' | 'rooms' | string, roomId: string | null) {
      if (context === 'dm') {
        this.lastVisitedRooms.dm = roomId;
      } else if (context === 'rooms') {
        this.lastVisitedRooms.rooms = roomId;
      } else {
        // Assume context is a Space ID
        if (roomId) {
          this.lastVisitedRooms.spaces[context] = roomId;
        } else {
          delete this.lastVisitedRooms.spaces[context];
        }
      }

      await setPref('matrix_last_visited_rooms', this.lastVisitedRooms);
    },

    async pinSpace(roomId: string) {
      if (!this.client) return;
      console.log(`[MatrixStore] Pinning space: ${roomId}`);
      if (!this.pinnedSpaces.includes(roomId)) {
        const newPinned = [...this.pinnedSpaces, roomId];
        this.pinnedSpaces = newPinned;
        await (this.client as any).setAccountData('cc.jackg.ruby.pinned_spaces', { rooms: newPinned });
        await setPref('matrix_pinned_spaces', newPinned);
      }
    },

    async unpinSpace(roomId: string) {
      if (!this.client) return;
      console.log(`[MatrixStore] Unpinning space: ${roomId}`);
      const newPinned = this.pinnedSpaces.filter(id => id !== roomId);
      this.pinnedSpaces = newPinned;
      await (this.client as any).setAccountData('cc.jackg.ruby.pinned_spaces', { rooms: newPinned });
      await setPref('matrix_pinned_spaces', newPinned);
    },

    async acceptInvite(roomId: string) {
      if (!this.client) return;
      try {
        const room = this.client.getRoom(roomId);
        const myUserId = this.client.getUserId();
        const myMember = room?.getMember(myUserId!);
        const isDirect = myMember?.events.member?.getContent().is_direct;

        await this.client.joinRoom(roomId);

        if (isDirect) {
          await this.markRoomAsDirect(roomId);
        }

        toast.success('Joined room');
      } catch (err: any) {
        console.error('Failed to accept invite:', err);
        toast.error('Failed to join room', { description: err.message });
      }
    },

    async declineInvite(roomId: string) {
      if (!this.client) return;
      try {
        await this.client.leave(roomId);
        await this.client.forget(roomId);
        toast.success('Invite declined');
        this.hierarchyTrigger++;
      } catch (err: any) {
        console.error('Failed to decline invite:', err);
        toast.error('Failed to decline invite', { description: err.message });
      }
    },

    async leaveRoom(roomId: string) {
      if (!this.client) return;
      try {
        await this.client.leave(roomId);
        await this.client.forget(roomId);
        toast.success('Left room');
        this.hierarchyTrigger++;
      } catch (err: any) {
        console.error('Failed to leave room:', err);
        toast.error('Failed to leave room', { description: err.message });
      }
    },

    async setRoomTag(roomId: string, tag: string, value: any) {
      if (!this.client) return;
      try {
        if (value === null) {
          await this.client.deleteTag(roomId, tag);
        } else {
          await this.client.setTag(roomId, tag, value);
        }
        this.hierarchyTrigger++;
      } catch (err: any) {
        console.error(`Failed to set tag ${tag} for room ${roomId}:`, err);
        toast.error('Failed to update room tag');
      }
    },

    async markAsRead(roomId: string) {
      if (!this.client) return;
      const room = this.client.getRoom(roomId);
      if (!room) return;

      const lastEvent = room.timeline[room.timeline.length - 1];
      if (lastEvent) {
        try {
          await this.client.sendReadReceipt(lastEvent);
          delete this.manualUnread[roomId];
          this.unreadTrigger++;
        } catch (err) {
          console.error('Failed to send read receipt:', err);
        }
      }
    },

    markAsUnread(roomId: string) {
      this.manualUnread[roomId] = true;
      this.unreadTrigger++;
    },

    async markSpaceAsRead(spaceId: string) {
      if (!this.client) return;

      const queue = [spaceId];
      const visited = new Set<string>();
      const joinedRooms: string[] = [];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const room = this.client.getRoom(currentId);
        if (!room) continue;

        if (room.isSpaceRoom()) {
          const children = room.currentState.getStateEvents('m.space.child');
          children.forEach(ev => {
            const childId = ev.getStateKey();
            if (childId) queue.push(childId);
          });
          if (room.getMyMembership() === 'join') {
            joinedRooms.push(currentId);
          }
        } else if (room.getMyMembership() === 'join') {
          joinedRooms.push(currentId);
        }
      }

      await Promise.all(joinedRooms.map(id => this.markAsRead(id)));
      toast.success('Marked space as read');
    },

    setInviteRoomId(roomId: string | null) {
      this.inviteRoomId = roomId;
    },

    async markRoomAsDirect(roomId: string) {
      if (!this.client) return;
      const room = this.client.getRoom(roomId);
      if (!room) return;

      const myUserId = this.client.getUserId();
      const otherMember = room.getMembers().find(m => m.userId !== myUserId);
      if (!otherMember) return;

      const dmEvent = this.client.getAccountData(sdk.EventType.Direct);
      const content = dmEvent ? JSON.parse(JSON.stringify(dmEvent.getContent())) : {};

      const userRooms = content[otherMember.userId] || [];
      if (!userRooms.includes(roomId)) {
        userRooms.push(roomId);
        content[otherMember.userId] = userRooms;
        await (this.client as any).setAccountData(sdk.EventType.Direct, content);
      }
    },

    setupMatrixRTCListeners() {
      if (!this.client) {
        console.warn('[MatrixRTC] setupMatrixRTCListeners: No client');
        return;
      }

      console.log('[MatrixRTC] setupMatrixRTCListeners: Initializing listeners');
      const rtc = this.client.matrixRTC;

      const triggerHierarchyRefresh = useDebounceFn(() => {
        this.hierarchyTrigger++;
      }, 500);

      const onMembershipsChanged = (oldM: any, newM: any) => {
        // Ensure session has reparsed before Vue re-renders
        // Note: We can't access the room here directly, but the session is already bound to the room
        triggerHierarchyRefresh();
      };

      const bindToSession = (roomId: string, session: any) => {
        if (this.matrixRTCBoundSessions.has(roomId)) return;
        console.log(`[MatrixRTC] Binding listeners to session in ${roomId}`);
        // Do NOT call ensureRecalculateSessionMembers here — doing so for every
        // voice room at startup causes a blocking IDB read per room.
        // The MembershipsChanged listener will fire when state actually changes.
        session.on(MatrixRTCSessionEvent.MembershipsChanged, onMembershipsChanged);
        this.matrixRTCBoundSessions.add(roomId);
      };

      // Listen for session starts/ends to bind to new sessions
      rtc.on(MatrixRTCSessionManagerEvents.SessionStarted, (roomId: string, session: any) => {
        console.log(`[MatrixRTC] Session started in ${roomId}, binding listeners`);
        bindToSession(roomId, session);
        triggerHierarchyRefresh();
      });

      rtc.on(MatrixRTCSessionManagerEvents.SessionEnded, (roomId: string, session: any) => {
        console.log(`[MatrixRTC] Session ended in ${roomId}, unbinding listeners`);
        session.off(MatrixRTCSessionEvent.MembershipsChanged, onMembershipsChanged);
        this.matrixRTCBoundSessions.delete(roomId);
        triggerHierarchyRefresh();
      });

      // Bind to any already active sessions after sync is prepared
      const bindExisting = () => {
        if (!this.client) return;
        const rooms = this.client.getRooms();
        console.log(`[MatrixRTC] Checking ${rooms.length} rooms for existing MatrixRTC presence`);

        for (const room of rooms) {
          // Bind to anything that is a voice channel OR already has memberships
          const isVoice = isVoiceChannel(room);
          const hasRtcState = room.currentState.getStateEvents('m.rtc.member').length > 0 ||
            room.currentState.getStateEvents('org.matrix.msc4143.rtc.member').length > 0 ||
            room.currentState.getStateEvents('org.matrix.msc3401.call.member').length > 0; // ← add this

          if (isVoice || hasRtcState) {
            const session = rtc.getRoomSession(room);
            bindToSession(room.roomId, session);
          }
        }
        triggerHierarchyRefresh();
      };

      if (this.client.isInitialSyncComplete()) {
        bindExisting();
      } else {
        this.client.once(sdk.ClientEvent.Sync, (state) => {
          if (state === 'PREPARED') {
            console.log('[MatrixRTC] Initial sync prepared, checking existing sessions');
            bindExisting();
          }
        });
      }
    },

    forceRecalculateVoiceMemberships() {
      if (!this.client) return;

      // Only touch rooms that are bound voice sessions — not every room.
      // Calling getRoomSession + ensureRecalculateSessionMembers on all 70+
      // rooms at startup blocks the main thread for several seconds.
      const boundRoomIds = Array.from(this.matrixRTCBoundSessions);

      for (const roomId of boundRoomIds) {
        try {
          const room = this.client.getRoom(roomId);
          if (!room) continue;
          const session = this.client.matrixRTC.getRoomSession(room);
          if (!session) continue;

          if (typeof (session as any).ensureRecalculateSessionMembers === 'function') {
            (session as any).ensureRecalculateSessionMembers();
          }
        } catch (e) {
          console.warn(`[MatrixRTC] Failed to recalculate session for ${roomId}:`, e);
        }
      }

      // Force Vue to re-evaluate getVoiceParticipants
      this.hierarchyTrigger++;
    },

  }
});