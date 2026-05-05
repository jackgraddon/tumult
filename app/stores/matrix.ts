import { markRaw } from 'vue';
import { defineStore } from 'pinia';
import * as sdk from 'matrix-js-sdk';
import {
  IndexedDBStore,
  IndexedDBCryptoStore,
  MemoryStore,
  LocalStorageCryptoStore,
  EventType,
  MsgType,
  OidcTokenRefresher,
  type AccessTokens
} from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api/CryptoEvent';
import { VerificationPhase, VerificationRequestEvent, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api/verification';
import type { VerificationRequest, Verifier, ShowSasCallbacks } from 'matrix-js-sdk/lib/crypto-api/verification';
import { deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api/key-passphrase';
import { decodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key';
import type { IdTokenClaims } from 'oidc-client-ts';
import { getOidcConfig, registerClient, getLoginUrl } from '~/utils/matrix-auth';
import { LocalStorageOidcTokenRefresher, MatrixService } from '~/services/matrix.service';
import { toast } from 'vue-sonner';
import { useRouter, navigateTo } from '#app';
import { setPref, getPref, deletePref, deleteSecrets } from '~/composables/useAppStorage';
import { dismissNotification } from '~/utils/notify';

const secretStorageKeys = new Map<string, Uint8Array>();

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
          secretStorageKeys.set(keyId, bytes);
        }
      }
    }
  } catch (err) {
    console.warn('[SecretStorage] Failed to load keys:', err);
  }
}

function generateNonce(): string {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    return Math.random().toString(16).slice(2);
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}


export interface LastVisitedRooms {
  dm: string | null;
  rooms: string | null;
  spaces: Record<string, string>;
}

export const useMatrixStore = defineStore('matrix', {
  state: () => ({
    client: null as sdk.MatrixClient | null,
    isAuthenticated: false,
    isSyncing: false,
    isClientReady: false,
    isReady: false,
    isRestoringSession: true,
    isCryptoDegraded: false,
    cryptoStatusMessage: null as string | null,
    lastSyncError: null as any | null,
    user: null as {
      userId: string;
      displayName?: string;
      avatarUrl?: string;
      description?: string;
      status_msg?: string;
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
    secretStoragePrompt: null as {
      promise: { resolve: (val: any) => void, reject: (err: any) => void },
      keyId: string,
      keyInfo: any
    } | null,

    // Settings & State
    pushNotificationsEnabled: true,
    showContentInNotifications: true,
    customPushEndpoint: null as string | null,
    notificationsQuietUntil: 0,
    lastVisitedRooms: { dm: null, rooms: null, spaces: {} } as LastVisitedRooms,
    lastPresenceState: null as { presence: string; status_msg: string } | null,

    // Dehydration & Hierarchy
    hierarchyTrigger: 0,
    spaceHierarchies: {} as Record<string, any[]>,
    isIdle: false,
    pinnedSpaces: [] as string[],
    unreadTrigger: 0,
    unreadCountType: sdk.NotificationCountType.Total as sdk.NotificationCountType,
    manualUnread: {} as Record<string, boolean>,
    directMessageMap: {} as Record<string, string>,

    customStatus: null as string | null,
    gameDetectionLevel: 'off' as 'off' | 'basic' | 'advanced',
    activityDetails: null as any | null,
    musicActivity: null as any | null,
    remoteActivityDetails: {} as Record<string, { game?: any; music?: any }>,
    gameTrigger: 0,
    lastPresenceUpdate: 0,
    loginStatus: '' as string,
    isFullySynced: false,
    isLoggingOut: false,
    isLoggingIn: false,
    startMinimized: false,
    inviteRoomId: null as string | null,
    isSasConfirming: false,
    isSasTimeout: false,
  }),

  getters: {
    invites: (state) => {
      if (!state.client) return [];
      return state.client.getVisibleRooms().filter(r => r.getMyMembership() === 'invite');
    },
    hierarchy(state) {
      state.hierarchyTrigger;
      if (!state.client) return { rootSpaces: [], directMessages: [], orphanRooms: [] };

      const all = state.client.getVisibleRooms().filter(r => ['join', 'invite'].includes(r.getMyMembership()));
      const childIds = new Set<string>();
      const spacesWithChildren = new Set<string>();

      all.forEach(r => {
        if (r.isSpaceRoom()) {
          r.currentState.getStateEvents('m.space.child').forEach(ev => {
            if (ev.getContent()?.via?.length) {
              childIds.add(ev.getStateKey()!);
              spacesWithChildren.add(r.roomId);
            }
          });
        }
      });

      const dmRoomIds = new Set<string>();
      const dmEvent = state.client.getAccountData(sdk.EventType.Direct);
      if (dmEvent) Object.values(dmEvent.getContent()).forEach((list: any) => list.forEach((id: string) => dmRoomIds.add(id)));

      return {
        rootSpaces: all.filter(r => r.isSpaceRoom() && (state.pinnedSpaces.includes(r.roomId) || (!childIds.has(r.roomId) && spacesWithChildren.has(r.roomId)))),
        directMessages: all.filter(r => dmRoomIds.has(r.roomId)),
        orphanRooms: all.filter(r => !r.isSpaceRoom() && !childIds.has(r.roomId) && !dmRoomIds.has(r.roomId)),
      };
    },
    totalInviteCount(state): number {
      state.unreadTrigger;
      return state.client?.getVisibleRooms().filter(r => r.getMyMembership() === 'invite').length || 0;
    },
    totalDmUnreadCount(): number {
      this.unreadTrigger;
      return this.hierarchy.directMessages.reduce((sum, r) => sum + (r.getUnreadNotificationCount(this.unreadCountType) || 0), 0);
    },

    resolveActivities(userId: string | null): { game: any | null; music: any | null } {
      // Ensure reactivity
      this.gameTrigger;
      const _m = this.musicActivity;
      const _a = this.activityDetails;
      const _r = this.remoteActivityDetails;
      const _p = this.lastPresenceState;

      const currentUserId = this.user?.userId || this.client?.getUserId();
      const targetUserId = userId || currentUserId;
      if (!targetUserId) return { game: null, music: null };

      const isSelf = !!(currentUserId && targetUserId === currentUserId);

      const sanitize = (val: any) => {
        if (val === null || val === undefined) return null;
        const s = String(val).trim();
        if (!s || s === 'undefined' || s === 'null' || s === 'None') return null;
        return s;
      };

      let game: any = null;
      let music: any = null;

      const isTauri = (process as any).client && !!(window as any).__TAURI_INTERNALS__;

      // 1. Local data (highest priority for self)
      if (isSelf) {
        if (this.activityDetails?.is_running && this.activityDetails?.type !== 'music') {
          if (sanitize(this.activityDetails.name)) {
            game = { ...this.activityDetails };
          }
        }
        if (this.musicActivity) {
          music = {
            name: `${this.musicActivity.title} by ${this.musicActivity.artist}`,
            details: this.musicActivity.album,
            coverUrl: this.musicActivity.coverUrl,
            duration: this.musicActivity.duration,
            currentTime: this.musicActivity.currentTime,
            startTimestamp: this.musicActivity.startTime || Date.now(),
            is_running: true,
            is_paused: !this.musicActivity.isRunning,
            type: 'music'
          };
        }
      }

      // 2. Synced account data (self other sessions OR remote users)
      const remote = this.remoteActivityDetails[targetUserId];
      if (remote) {
        const now = Date.now();
        const freshnessThreshold = 5 * 60 * 1000;

        if (remote.game && remote.game.is_running && (now - (remote.game.last_updated || 0) < freshnessThreshold)) {
          if (!game && sanitize(remote.game.name)) game = remote.game;
        }
        if (remote.music && remote.music.is_running && (now - (remote.music.last_updated || 0) < freshnessThreshold)) {
          if (!music && sanitize(remote.music.name)) music = remote.music;
        }
      }

      // 3. Presence fallback (if still missing)
      // Special case: if we are on Tauri and we are self, we trust our local activityDetails.
      // If activityDetails is null/not running, it means NO game is running on this device.
      // We skip presence fallback for 'game' to prevent the "stuck activity" bug.
      const shouldSkipGamePresenceFallback = isSelf && isTauri && this.gameDetectionLevel !== 'off';

      if ((!game && !shouldSkipGamePresenceFallback) || !music) {
        let presenceMsg: string | undefined;
        if (isSelf && this.lastPresenceState !== null) {
          presenceMsg = this.lastPresenceState.status_msg;
        } else {
          const user = this.client?.getUser(targetUserId);
          presenceMsg = user?.presenceStatusMsg;
        }

        if (presenceMsg) {
          if (presenceMsg.startsWith('{')) {
            try {
              const parsed = JSON.parse(presenceMsg);
              if (parsed.playing && parsed.is_running) {
                const type = parsed.type || (parsed.playing.includes(' by ') ? 'music' : 'game');
                const act = {
                  name: parsed.playing,
                  details: parsed.details,
                  state: parsed.state,
                  applicationId: parsed.applicationId,
                  iconHash: parsed.iconHash,
                  smallIconHash: parsed.smallIconHash,
                  startTimestamp: parsed.startTimestamp,
                  duration: parsed.duration,
                  currentTime: parsed.currentTime,
                  coverUrl: parsed.coverUrl,
                  type: type,
                  is_running: true,
                  is_paused: parsed.is_paused ?? false,
                };
                if (type === 'music') {
                  if (!music) music = act;
                } else {
                  if (!game) game = act;
                }
              }
            } catch (e) {
              console.error('Failed to parse presence message', e);
            }
          }
        }
      }

      return { game, music };
    },

    totalOrphanRoomUnreadCount(): number {
      this.unreadTrigger;
      if (!this.client) return 0;
      const { orphanRooms } = this.hierarchy;
      return orphanRooms.reduce((sum, room) => {
        const count = room.getUnreadNotificationCount(this.unreadCountType) || 0;
        const manual = this.manualUnread[room.roomId] ? 1 : 0;
        return sum + Math.max(count, manual);
      }, 0);
    },

    getSpaceUnreadCount: (state) => (spaceId: string): number => {
      state.unreadTrigger;
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
            const childId = ev.getStateKey();
            if (childId) queue.push(childId);
          });
        } else {
          roomIds.add(currentId);
        }
      }

      let total = 0;
      roomIds.forEach(id => {
        const room = state.client?.getRoom(id);
        total += room?.getUnreadNotificationCount(state.unreadCountType) || 0;
      });
      return total;
    },

    getVoiceParticipants: (state) => (roomId: string) => {
      const room = state.client?.getRoom(roomId);
      if (!room) return [];
      // Map members who are in the call
      return room.getMembersWithMembership('join')
        .filter(m => {
          const event = room.currentState.getStateEvents('org.matrix.msc3401.call.member', m.userId);
          return event && event.getContent().memberships?.length > 0;
        })
        .map(m => ({
          id: m.userId,
          name: m.name,
          avatarUrl: m.getMxcAvatarUrl()
        }));
    },
    isVerificationRequested: (state) => {
      return !!state.activeVerificationRequest && state.verificationPhase === VerificationPhase.Requested;
    },
    isVerificationReady: (state) => {
      return !!state.activeVerificationRequest && state.verificationPhase === VerificationPhase.Ready;
    },
    isWaitingForRecoveryKey: (state) => {
      return !!state.secretStoragePrompt;
    },
    needsRecoveryKeySetup: (state) => {
      return state.isAuthenticated && !state.isSecretStorageReady && !state.isCryptoDegraded;
    }
  },

  actions: {
    async initialize() {
      this.pushNotificationsEnabled = await getPref('matrix_push_notifications_enabled', true);
      this.showContentInNotifications = await getPref('matrix_show_content_in_notifications', true);
      this.customPushEndpoint = await getPref('matrix_custom_push_endpoint', null);
      this.notificationsQuietUntil = await getPref('matrix_notifications_quiet_until', 0);
      this.lastVisitedRooms = await getPref('matrix_last_visited_rooms', { dm: null, rooms: null, spaces: {} });
    },

    async _clearPersistentStores() {
      const userId = this.client?.getUserId();
      const deleteDb = (name: string) => new Promise<void>((resolve) => {
        const req = window.indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });

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
    },

    _resetVerificationState() {
      this.activeVerificationRequest = null;
      this.isVerificationInitiatedByMe = false;
      this.activeSas = null;
      this.qrCodeData = null;
      this.isVerificationCompleted = false;
      this.verificationPhase = null;
      this.isRestoringHistory = false;
    },

    setIdle(idle: boolean) {
      this.isIdle = idle;
    },

    async setPushNotificationsEnabled(enabled: boolean) {
      this.pushNotificationsEnabled = enabled;
      await setPref('matrix_push_notifications_enabled', enabled);
    },

    async setShowContentInNotifications(show: boolean) {
      this.showContentInNotifications = show;
      await setPref('matrix_show_content_in_notifications', show);
    },

    async setCustomPushEndpoint(endpoint: string | null) {
      this.customPushEndpoint = endpoint;
      await setPref('matrix_custom_push_endpoint', endpoint);
    },

    async setNotificationsQuietUntil(until: number) {
      this.notificationsQuietUntil = until;
      await setPref('matrix_notifications_quiet_until', until);
    },

    async setCustomStatus(status: string | null) {
      this.customStatus = status;
      if (this.client) {
        await this.client.setAccountData('cc.jackg.ruby.status' as any, { status_msg: status } as any);
      }
    },

    async handleRpcActivity(data: any) {
      if (data.activity) {
        const name = data.activity.name;
        const details = data.activity.details;
        const appId = data.activity.application_id;
        const appIcon = null;

        const largeImage = data.activity.assets?.large_image;
        const smallImage = data.activity.assets?.small_image;

        // Enhanced activity details from rsRPC
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
        if (!this.remoteActivityDetails[userId]) {
          this.remoteActivityDetails[userId] = {};
        }

        if (this.activityDetails) {
          this.remoteActivityDetails[userId].game = { ...this.activityDetails };
        } else {
          this.remoteActivityDetails[userId].game = null;
        }
      }
    },

    async setPinnedSpaces(spaceIds: string[]) {
      this.pinnedSpaces = spaceIds;
      if (this.client) {
        await this.client.setAccountData('cc.jackg.ruby.pinned_spaces' as any, { rooms: spaceIds } as any);
      }
    },

    updateRootSpacesOrder(spaceIds: string[]) {
      const uiStore = useUIStore();
      uiStore.uiOrder.rootSpaces = spaceIds;
      MatrixService.getInstance().saveUIOrder();
    },

    updateCategoryOrder(spaceId: string, categoryIds: string[]) {
      const uiStore = useUIStore();
      uiStore.uiOrder.categories[spaceId] = categoryIds;
      MatrixService.getInstance().saveUIOrder();
    },

    updateRoomOrder(categoryId: string, roomIds: string[]) {
      const uiStore = useUIStore();
      uiStore.uiOrder.rooms[categoryId] = roomIds;
      MatrixService.getInstance().saveUIOrder();
    },

    setInviteRoomId(roomId: string | null) {
      this.inviteRoomId = roomId;
    },
    _sanitizeActivityString(val: any): string | null {
      if (val === null || val === undefined) return null;
      const s = String(val).trim();
      if (!s || s === "undefined" || s === "null" || s === "None") return null;
      return s;
    },

    async refreshPresence() {
      if (!this.client || !this.isAuthenticated || !this.isClientReady) return;

      const { game, music } = this.resolveActivities(null);
      const bestActivity = game || music;
      const hasLiveActivity = (game?.is_running && !game?.is_paused) || (music?.is_running && !music?.is_paused);
      const presence = (this.isIdle && !hasLiveActivity) ? "unavailable" : "online";

      let status_msg: string = this.customStatus || "";

      if (!status_msg && bestActivity?.is_running) {
        const act = bestActivity;
        const name = this._sanitizeActivityString(act.name);
        if (name) {
          status_msg = JSON.stringify({
            playing: name,
            details: act.details ?? null,
            state: act.state ?? null,
            applicationId: act.applicationId ?? null,
            iconHash: act.iconHash ?? null,
            smallIconHash: act.smallIconHash ?? null,
            startTimestamp: act.startTimestamp ?? null,
            duration: act.duration ?? null,
            currentTime: act.currentTime ?? null,
            coverUrl: act.coverUrl ?? null,
            type: act.type || (name.includes(" by ") ? "music" : "game"),
            is_running: true,
            is_paused: act.is_paused ?? false,
            game: game ? { ...game } : null,
            music: music ? { ...music } : null
          });
        }
      }

      const stateChanged = !this.lastPresenceState ||
        this.lastPresenceState.presence !== presence ||
        this.lastPresenceState.status_msg !== status_msg;

      let isCriticalChange = false;
      if (stateChanged && this.lastPresenceState) {
        try {
          const lastMsg = this.lastPresenceState.status_msg;
          const currentMsg = status_msg;

          if (lastMsg.startsWith('{') && currentMsg.startsWith('{')) {
            const last = JSON.parse(lastMsg);
            const current = JSON.parse(currentMsg);

            if (last.type === 'music' && current.type === 'music') {
              const trackChanged = last.playing !== current.playing;
              const pauseStateChanged = last.is_paused !== current.is_paused;
              // Detect seeks: if the startTimestamp shifted by more than 2 seconds, it's a seek
              const seeked = Math.abs((last.startTimestamp || 0) - (current.startTimestamp || 0)) > 2000;

              if (trackChanged || pauseStateChanged || seeked) {
                isCriticalChange = true;
              }
            }
          } else if (lastMsg !== currentMsg) {
            // If one is JSON and the other isn't, or both are plain text and changed, consider it critical enough
            isCriticalChange = true;
          }
        } catch (e) {
          isCriticalChange = true;
        }
      } else if (stateChanged && !this.lastPresenceState) {
        isCriticalChange = true;
      }

      const now = Date.now();
      const throttleMs = 20 * 1000; // 20 seconds

      // Only skip if:
      // 1. No state change at all
      // 2. OR state changed but it's not critical AND we are within the throttle window
      if (!stateChanged || (!isCriticalChange && (now - this.lastPresenceUpdate < throttleMs))) {
        // Double check: if it's been more than throttleMs, we should update anyway to keep presence alive
        if (now - this.lastPresenceUpdate < throttleMs) {
          return;
        }
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

    async setProfileDescription(description: string) {
      if (!this.client) return;
      const userId = this.client.getUserId();
      if (!userId) return;

      try {
        const path = `/profile/${encodeURIComponent(userId)}/org.matrix.msc2403.description`;
        const res = await this.client.http.authedRequest(
          sdk.Method.Put,
          path,
          undefined,
          { "org.matrix.msc2403.description": description }
        );
        console.log('[MatrixStore] Bio update response:', res);

        // Update local state
        if (this.user) {
          this.user.description = description;
        }

        toast.success('Bio updated');
      } catch (e) {
        console.error('[MatrixStore] Failed to update bio:', e);
        toast.error('Failed to update bio');
      }
    },

    async toggleMemberList() {
      this.ui.memberListVisible = !this.ui.memberListVisible;
      if (this.ui.memberListVisible) {
        this.ui.sidebarOpen = false;
      }
      if (this.ui.hapticFeedbackEnabled) {
        const { WebHaptics } = await import('web-haptics');
        const haptics = new WebHaptics({ debug: this.ui.hapticsDebugEnabled });
        haptics.trigger('light');
      }
      await setPref('matrix_member_list_visible', this.ui.memberListVisible);
    },

    setUISelectedUser(userId: string | null, pos?: { top: string; right: string; left?: string }) {
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

    async toggleSidebar(open?: boolean) {
      if (typeof open === 'boolean') {
        this.ui.sidebarOpen = open;
      } else {
        this.ui.sidebarOpen = !this.ui.sidebarOpen;
      }
      if (this.ui.sidebarOpen) {
        this.ui.memberListVisible = false;
      }
      if (this.ui.hapticFeedbackEnabled) {
        const { WebHaptics } = await import('web-haptics');
        const haptics = new WebHaptics({ debug: this.ui.hapticsDebugEnabled });
        haptics.trigger('light');
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

    async setHapticFeedbackEnabled(enabled: boolean) {
      this.ui.hapticFeedbackEnabled = enabled;
      await setPref('matrix_haptic_feedback_enabled', enabled);
    },

    async setHapticsDebugEnabled(enabled: boolean) {
      this.ui.hapticsDebugEnabled = enabled;
      await setPref('matrix_haptics_debug_enabled', enabled);
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

    openMusicItemContextMenu(item: any) {
      this.setContextMenu('music-item', { item });
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

      // Sync to Service Worker store for background decryption
      try {
        const { saveMatrixAuth, saveSwSettings } = await import('~/utils/crypto-db');
        await saveMatrixAuth(accessToken, data.homeserverUrl, deviceId);
        await saveSwSettings({
          showContent: this.showContentInNotifications,
          quietUntil: this.notificationsQuietUntil
        });
      } catch (err) {
        console.warn('[MatrixStore] Failed to sync auth to SW store:', err);
      }

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

      // Ensure auth is synced to SW store on initialization
      try {
        const { saveMatrixAuth } = await import('~/utils/crypto-db');
        const hsUrl = await getHomeserverUrl();
        await saveMatrixAuth(accessToken, hsUrl, deviceId);
      } catch (err) {
        console.warn('[MatrixStore] Failed to sync auth to SW store on init:', err);
      }

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
        const temp = sdk.createClient({ baseUrl: await getHomeserverUrl(), accessToken });
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
      const roomStorePromise: Promise<void> | null = null;
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
        baseUrl: await getHomeserverUrl(),
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

      // Restore token expiry to the client's internal TokenRefresher
      const storedExpiry = await getPref<number | null>('matrix_token_expiry', null);
      if (storedExpiry && (this.client as any).tokenRefresher) {
        const expiryDate = new Date(storedExpiry);
        console.log(`[MatrixStore] Restoring token expiry: ${expiryDate.toISOString()}`);
        (this.client as any).tokenRefresher.latestTokenRefreshExpiry = expiryDate;
      }

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
            baseUrl: await getHomeserverUrl(),
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
      this.client.once(sdk.ClientEvent.Sync, async (state: sdk.SyncState) => {
        if (state === sdk.SyncState.Prepared || state === sdk.SyncState.Syncing) {
          console.log("⚡ [MatrixStore] Matrix background sync complete (Initial Catch-up).");
          if (this.ui.hapticFeedbackEnabled) {
            const { WebHaptics } = await import('web-haptics');
            const haptics = new WebHaptics({ debug: this.ui.hapticsDebugEnabled });
            haptics.trigger('success');
          }
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

      // 1.2 Session Heartbeat & Storage Sanity Check
      // Check if both the Session and the Crypto Store exist to prevent "Asymmetric Wipe" logouts.
      const hasCryptoStore = await (window.indexedDB.databases ? window.indexedDB.databases().then(dbs => dbs.some(db => db.name?.includes('crypto'))) : Promise.resolve(true));
      const hasAccessToken = !!accessToken;
      const isTauri = (process as any).client && !!(window as any).__TAURI_INTERNALS__;

      console.log('[MatrixStore] Session Heartbeat:', { hasAccessToken, hasCryptoStore });

      if (hasAccessToken && !hasCryptoStore && !isTauri) {
        console.warn('[MatrixStore] Asymmetric Wipe detected: Access token exists but crypto store is missing. Triggering repair...');
        // We could proactively trigger bootstrapVerification() here in a real scenario,
        // but for now we'll let the standard init proceed which will likely prompt for recovery.
      }

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
        console.error("🚨 [MatrixStore] Server invalidated session (M_UNKNOWN_TOKEN). Forcing logout run.", {
          message: err?.message,
          errcode: err?.errcode,
          httpStatus: err?.httpStatus,
          data: err?.data
        });
        // Instantly stop the client to prevent infinite request loops
        if (this.client) {
          this.client.stopClient();
        }
        // We use an arrow function so 'this' remains bound to the Pinia store
        this.logout();
      });

      // Handle background sync requests from Service Worker
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SYNC_BUFFERS') {
            console.log('[MatrixStore] Service Worker requested buffer sync');
            // This is already being handled by the client's continuous background sync.
          }
        });

        // Sync current quiet status and content visibility to SW on boot
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SET_QUIET_UNTIL',
            timestamp: this.notificationsQuietUntil
          });
          navigator.serviceWorker.controller.postMessage({
            type: 'SET_SHOW_CONTENT',
            enabled: this.showContentInNotifications
          });
        }
      }

      // Global Error Interceptor for Crypto Failures (OTK 400s, etc.)
      this.client.on(sdk.ClientEvent.Sync, async (state: sdk.SyncState, prevState: sdk.SyncState | null, data?: any) => {
        if (state === sdk.SyncState.Error) {
          const error = data?.error;
          this.lastSyncError = error;
          const msg = error?.message || "";
          const code = error?.errcode || error?.httpStatus;

          if (code === 400 && msg.includes("One time key") && msg.includes("already exists")) {
            console.error("🚨 [MatrixStore] Fatal Crypto Store Desync (OTK Conflict) detected! Attempting Soft-Reset...");

            // 2. OTK Collision Soft-Reset Handler
            // Instead of stopping the client and forcing a logout, we tell the crypto backend
            // to "forget" its current OTK count so it can upload fresh ones or skip the duplicate.
            try {
              const crypto = this.client?.getCrypto();
              if (crypto) {
                // In the Rust crypto backend, we can trigger a keys upload to resync state.
                // This is a "soft-reset" that doesn't nuke the account but clears the blocker.
                // (Note: The exact method may vary by SDK version, but authedRequest 'keys/upload'
                // often forces a server-side state alignment).
                await (this.client as any).getInternalHttpApi().authedRequest(
                  sdk.Method.Post,
                  "/_matrix/client/v3/keys/upload",
                  {},
                  {}
                );
                console.log('[MatrixStore] OTK Soft-Reset: Key sync forced.');
              }
            } catch (err) {
              console.error('[MatrixStore] OTK Soft-Reset failed:', err);
              this.isCryptoDegraded = true;
              this.cryptoStatusMessage = "Encryption store desync. Security repair required.";

              toast.error("Security Sync Error", {
                description: "A cryptographic desync was detected. Some messages may not be decryptable. Click to repair.",
                action: {
                  label: "Repair",
                  onClick: () => { this.repairCrypto(); }
                },
                duration: 15000,
              });
            }
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

      const { handleDecryptedEvent } = useMatrixNotifications();

      this.client.on(sdk.RoomEvent.Timeline, async (event, room, toStartOfTimeline) => {
        if (toStartOfTimeline) return;
        debouncedUnreadTrigger();

        if (!room) return;
        if (event.isDecryptionFailure()) return;

        // Don't notify/cache for events that arrived during initial sync
        if (this.client && !this.client.isInitialSyncComplete()) return;

        const processDecrypted = async (ev: sdk.MatrixEvent) => {
          if (ev.isDecryptionFailure()) return;

          // Only notify/cache for messages and custom game events
          const notifiableTypes = ['m.room.message', 'cc.jackg.ruby.game.action', 'cc.jackg.ruby.game.over'];
          const type = ev.getType();
          if (!notifiableTypes.includes(type)) return;

          handleDecryptedEvent(ev, room);
        };

        if (event.getType() === 'm.room.encrypted' && !event.getClearContent()) {
          event.once(sdk.MatrixEventEvent.Decrypted, (ev) => {
            processDecrypted(ev);
          });
        } else {
          processDecrypted(event);
        }
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
        if (event.getType() === 'cc.tumult.jellyfin.config') this.loadJellyfinConfigFromAccountData();
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

      this.client.on(sdk.UserEvent.Presence, (event, user) => {
        if (!user?.userId) return;

        const msg = user.presenceStatusMsg;
        if (msg?.startsWith('{')) {
          try {
            const parsed = JSON.parse(msg);
            let changed = false;

            if (!this.remoteActivityDetails[user.userId]) {
              this.remoteActivityDetails[user.userId] = {};
            }

            const processParsedAct = (item: any) => {
              if (item && (item.playing || item.name) && item.is_running) {
                const playing = item.playing || item.name;
                const type = item.type || (playing.includes(' by ') ? 'music' : 'game');
                const act = {
                  name: playing,
                  details: item.details,
                  state: item.state,
                  applicationId: item.applicationId,
                  iconHash: item.iconHash,
                  smallIconHash: item.smallIconHash,
                  startTimestamp: item.startTimestamp,
                  duration: item.duration,
                  currentTime: item.currentTime,
                  coverUrl: item.coverUrl,
                  type: type,
                  is_running: true,
                  is_paused: item.is_paused ?? false,
                  last_updated: Date.now(),
                };

                if (type === 'music') {
                  this.remoteActivityDetails[user.userId].music = act;
                } else {
                  this.remoteActivityDetails[user.userId].game = act;
                }
                changed = true;
              }
            };

            if (parsed.game || parsed.music) {
              if (parsed.game) processParsedAct(parsed.game);
              if (parsed.music) processParsedAct(parsed.music);
            } else {
              processParsedAct(parsed);
            }

            if (changed) {
              this.gameTrigger++;
              if (user.userId === this.client?.getUserId()) {
                this.refreshPresence();
              }
            }
          } catch { /* malformed JSON, ignore */ }
        } else if (msg?.startsWith('Playing ')) {
          const name = msg.substring(8).trim();
          if (name) {
            if (!this.remoteActivityDetails[user.userId]) {
              this.remoteActivityDetails[user.userId] = {};
            }
            this.remoteActivityDetails[user.userId].game = {
              name,
              is_running: true,
              last_updated: Date.now()
            };
            this.gameTrigger++;
          }
        } else if (!msg || msg === 'Online' || msg === 'Idle') {
          const remote = this.remoteActivityDetails[user.userId];
          if (remote) {
            const now = Date.now();
            const staleThreshold = 2 * 60 * 1000;
            if ((!remote.game || (now - (remote.game.last_updated || 0) > staleThreshold)) &&
              (!remote.music || (now - (remote.music.last_updated || 0) > staleThreshold))) {
              delete this.remoteActivityDetails[user.userId];
              this.gameTrigger++;
            }
          }
        }
      });

      // Initial trigger
      this.updatePinnedSpaces();
      this.loadUIOrderFromAccountData();
      this.loadRichActivityFromAccountData();
      this.loadJellyfinConfigFromAccountData();
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

    async loadJellyfinConfigFromAccountData() {
      if (!this.client) return;
      const jellyfinStore = useJellyfinStore();
      if (jellyfinStore.isAuthenticated) return;

      // 1. Try Matrix Secret Storage (SSSS) first
      try {
        const crypto = this.client.getCrypto();
        if (crypto && this.isSecretStorageReady) {
          const secret = await crypto.getSecret('cc.tumult.jellyfin.config');
          if (secret) {
            console.log('[MatrixStore] Loading Jellyfin credentials from Secret Storage');
            const config = JSON.parse(secret);
            await jellyfinStore.setCredentials(config.serverUrl, config.accessToken, config.userId);
            return;
          }
        }
      } catch (e) {
        console.warn('[MatrixStore] Failed to load Jellyfin credentials from Secret Storage:', e);
      }

      // 2. Fallback to standard Account Data
      const event = (this.client as any).getAccountData('cc.tumult.jellyfin.config');
      if (event) {
        const content = event.getContent();
        if (content && typeof content === 'object') {
          console.log('[MatrixStore] Loading Jellyfin credentials from Account Data fallback');
          await jellyfinStore.setCredentials(content.serverUrl, content.accessToken, content.userId);
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
        if (content && typeof content === 'object') {
          // Map of deviceId -> { game, music } OR deviceId -> Activity (legacy)
          let activities: Record<string, any> = {};

          if (content.is_running !== undefined) {
            activities['legacy'] = content;
          } else {
            activities = content;
          }

          let bestGame: any = null;
          let bestMusic: any = null;
          const currentDeviceId = this.client.getDeviceId();

          for (const [deviceId, data] of Object.entries(activities)) {
            if (deviceId === currentDeviceId) continue;

            // Handle nested format { game, music }
            if (data.game || data.music) {
              if (data.game?.is_running && (!bestGame || (data.game.last_updated || 0) > (bestGame.last_updated || 0))) {
                bestGame = data.game;
              }
              if (data.music?.is_running && (!bestMusic || (data.music.last_updated || 0) > (bestMusic.last_updated || 0))) {
                bestMusic = data.music;
              }
            } else if (data.is_running) {
              // Handle legacy single-activity format
              if (data.type === 'music') {
                if (!bestMusic || (data.last_updated || 0) > (bestMusic.last_updated || 0)) bestMusic = data;
              } else {
                if (!bestGame || (data.last_updated || 0) > (bestGame.last_updated || 0)) bestGame = data;
              }
            }
          }

          this.remoteActivityDetails[userId] = {
            game: bestGame,
            music: bestMusic
          };

          this.gameTrigger++;
          this.refreshPresence();
        }
      }
    },

    async saveActivityToAccountData() {
      if (!this.client) return;
      const deviceId = this.client.getDeviceId();
      if (!deviceId) return;

      try {
        // 1. Get existing data
        const event = (this.client as any).getAccountData('cc.jackg.tumult.activity_details');
        let activities: Record<string, any> = {};

        if (event) {
          const content = event.getContent();
          if (content.is_running !== undefined) {
            activities['legacy'] = content;
          } else {
            activities = { ...content };
          }
        }

        // 2. Prepare our current activity
        let myGame: any = null;
        let myMusic: any = null;

        if (this.activityDetails?.is_running) {
          myGame = { ...this.activityDetails };
        }

        if (this.musicActivity) {
          myMusic = {
            name: `${this.musicActivity.title} by ${this.musicActivity.artist}`,
            details: this.musicActivity.album,
            coverUrl: this.musicActivity.coverUrl,
            duration: this.musicActivity.duration,
            currentTime: this.musicActivity.currentTime,
            startTimestamp: this.musicActivity.startTime || Date.now(),
            is_running: true,
            is_paused: !this.musicActivity.isRunning,
            type: 'music',
            last_updated: Date.now()
          };
        }

        // 3. Update map
        if (myGame || myMusic) {
          activities[deviceId] = {
            game: myGame,
            music: myMusic
          };
        } else {
          delete activities[deviceId];
        }

        // 4. Clean up stale activities (older than 24h)
        const now = Date.now();
        for (const [id, act] of Object.entries(activities)) {
          if (!act.last_updated || now - act.last_updated > 24 * 60 * 60 * 1000) {
            delete activities[id];
          }
        }

        // 5. Save back
        await (this.client as any).setAccountData('cc.jackg.tumult.activity_details', activities);
      } catch (e) {
        console.error('Failed to save rich activity to account data:', e);
      }
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
        const avatarUrl = profile.avatar_url;

        // Update state
        console.log(`[MatrixStore] Fetched profile for ${userId}:`, profile);
        this.user = {
          userId,
          displayName: profile.displayname,
          avatarUrl: avatarUrl || undefined,
          description: (profile as any).description || (profile as any).status_msg_description || (profile as any)['org.matrix.msc2403.description'],
          status_msg: (profile as any).status_msg || (profile as any)['org.matrix.msc2403.status_msg']
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
          this.isSasConfirming = true;
          await this.activeSas.confirm();
        } else {
          await this.activeSas.mismatch();
          this.activeVerificationRequest?.cancel();
        }
        // Let the checkPhase listener handle setting activeSas to null
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
      const info: any = {
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
      console.log("Logging out...", new Error('Stack Trace').stack);

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
        console.log('[MatrixStore] logout: Wiping critical session data...');
        await deleteSecret('matrix_access_token');
        await deleteSecret('matrix_refresh_token');
        await deletePref('matrix_user_id');
        await deletePref('matrix_device_id');
        await deletePref('matrix_token_expiry');

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

        // Clear SW Auth Store
        try {
          const { clearMatrixAuth } = await import('~/utils/crypto-db');
          await clearMatrixAuth();
        } catch (e) {
          console.warn('[MatrixStore] Failed to clear SW auth on logout:', e);
        }

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
          "/_matrix/client/v3/keys/upload",
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
        const storedUserId = await getPref('matrix_user_id', null);
        if (accessToken && storedUserId) {
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

    openAboutModal() {
      this.aboutModalOpen = true;
    },

    closeAboutModal() {
      this.aboutModalOpen = false;
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
        await this.client.sendStateEvent(spaceId, "m.space.child" as any, {
          via: [this.client.getDomain()!],
          suggested: false
        }, roomId);

        // Add parent to room
        await this.client.sendStateEvent(roomId, "m.space.parent" as any, {
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
          await this.client.sendStateEvent(roomId, "m.room.avatar" as any, { url: response.content_uri }, "");
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
        await this.client.sendStateEvent(roomId, "m.room.join_rules" as any, { join_rule: joinRule }, "");
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

    async joinRoom(roomIdOrAlias: string, viaServers?: string[]): Promise<any> {
      if (!this.client) throw new Error("Matrix client not initialized.");
      console.log(`[MatrixStore] Joining room ${roomIdOrAlias} (via: ${viaServers?.join(', ') || 'none'})...`);

      try {
        const result = await this.client.joinRoom(roomIdOrAlias, { viaServers });
        console.log(`[MatrixStore] Joined room ${result.roomId}`);
        this.hierarchyTrigger++;
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

        // Extract via servers from the inviter's homeserver
        const inviterId = room?.getDMInviter();
        const viaServers: string[] = [];
        if (inviterId && inviterId.includes(':')) {
          viaServers.push(inviterId.split(':')[1]!);
        }

        await this.joinRoom(roomId, viaServers);

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
          await (this.client as any).deleteTag(roomId, tag);
        } else {
          await (this.client as any).setTag(roomId, tag, value);
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

      // Clear any active notifications for this room
      await dismissNotification(roomId);

      // If total unread count is going to be 0, proactively clear the badge
      if (this.totalDmUnreadCount + this.totalOrphanRoomUnreadCount + this.totalInviteCount <= 1) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_BADGE' });
        } else if ('clearAppBadge' in navigator) {
          (navigator as any).clearAppBadge().catch(() => { });
        }
      }

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
    }
  }
});
