import * as sdk from 'matrix-js-sdk';
import { useMatrixStore } from '~/stores/matrix';
import { useUIStore } from '~/stores/ui';
import { useActivityStore } from '~/stores/activity';
import { getHomeserverUrl, completeLoginFlow  } from '~/utils/matrix-auth';
import { setPref, getPref, setSecret, deleteSecrets, deletePref } from '~/composables/useAppStorage';
import { markRaw } from 'vue';
import { navigateTo } from '#app';
import { VerificationService } from './verification.service';
import { OidcTokenRefresher, type AccessTokens, IndexedDBStore, LocalStorageCryptoStore, EventType, MsgType } from 'matrix-js-sdk';
import type { IdTokenClaims } from 'oidc-client-ts';
import { useDebounceFn } from '@vueuse/core';
import { dismissNotification } from "~/utils/notify";

export class LocalStorageOidcTokenRefresher extends OidcTokenRefresher {
  public override async doRefreshAccessToken(refreshToken: string): Promise<AccessTokens> {
    const performRefresh = async (): Promise<AccessTokens> => {
      const latestRefreshToken = await getSecret('matrix_refresh_token');
      if (latestRefreshToken && latestRefreshToken !== refreshToken) {
        const latestAccessToken = await getSecret('matrix_access_token');
        const latestExpiry = await getPref<number | null>('matrix_token_expiry', null);
        return {
          accessToken: latestAccessToken!,
          refreshToken: latestRefreshToken,
          expiry: latestExpiry ? new Date(latestExpiry) : undefined
        };
      }
      try {
        return await super.doRefreshAccessToken(refreshToken);
      } catch (e) {
        const finalRefreshToken = await getSecret('matrix_refresh_token');
        if (finalRefreshToken && finalRefreshToken !== refreshToken) {
          const finalAccessToken = await getSecret('matrix_access_token');
          const finalExpiry = await getPref<number | null>('matrix_token_expiry', null);
          return {
            accessToken: finalAccessToken!,
            refreshToken: finalRefreshToken,
            expiry: finalExpiry ? new Date(finalExpiry) : undefined
          };
        }
        throw e;
      }
    };
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request('matrix-token-refresh', { mode: 'exclusive' }, performRefresh);
    } else {
      return await performRefresh();
    }
  }

  protected override async persistTokens(tokens: { accessToken: string; refreshToken?: string; expiry?: Date }): Promise<void> {
    await setSecret('matrix_access_token', tokens.accessToken);
    if (tokens.refreshToken) await setSecret('matrix_refresh_token', tokens.refreshToken);
    if (tokens.expiry) await setPref('matrix_token_expiry', tokens.expiry.getTime());
    try {
      const { saveMatrixAuth } = await import('~/utils/crypto-db');
      const hsUrl = await getHomeserverUrl();
      const deviceId = await getPref<string | null>('matrix_device_id', null);
      await saveMatrixAuth(tokens.accessToken, hsUrl, deviceId || undefined);
    } catch (err) {}
  }
}

export class MatrixService {
  private static instance: MatrixService;
  private client: sdk.MatrixClient | null = null;
  private secretStorageKeys = new Map<string, Uint8Array>();

  private constructor() {}

  public static getInstance(): MatrixService {
    if (!MatrixService.instance) MatrixService.instance = new MatrixService();
    return MatrixService.instance;
  }

  public getClient(): sdk.MatrixClient | null {
    return this.client;
  }

  async initClient(
    accessToken: string,
    userId: string,
    deviceId?: string,
    refreshToken?: string,
    issuer?: string,
    clientId?: string,
    idTokenClaims?: IdTokenClaims,
  ) {
    const store = useMatrixStore();
    const uiStore = useUIStore();
    store.isRestoringSession = true;

    if (this.client) {
      this.client.stopClient();
      this.client.removeAllListeners();
      this.client = null;
    }

    if (!deviceId) {
      const temp = sdk.createClient({ baseUrl: await getHomeserverUrl(), accessToken });
      try {
        const whoami = await temp.whoami();
        deviceId = whoami.device_id || undefined;
        if (deviceId) await setPref('matrix_device_id', deviceId);
      } catch (e) {}
    }

    let tokenRefreshFunction: sdk.TokenRefreshFunction | undefined;
    if (refreshToken && issuer && clientId && idTokenClaims && deviceId) {
      const redirectUri = await getPref('matrix_oidc_redirect_uri', window.location.origin + '/auth/callback');
      const refresher = new LocalStorageOidcTokenRefresher(issuer, clientId, redirectUri, deviceId, idTokenClaims);
      tokenRefreshFunction = refresher.doRefreshAccessToken.bind(refresher);
    }

    const roomStore = new IndexedDBStore({
      indexedDB: window.indexedDB,
      dbName: "matrix-js-sdk::matrix-store",
    });

    const clientOpts: any = {
      baseUrl: await getHomeserverUrl(),
      accessToken,
      userId,
      deviceId,
      refreshToken,
      tokenRefreshFunction,
      store: roomStore,
      verificationMethods: ['m.sas.v1', 'm.qr_code.show.v1', 'm.qr_code.scan.v1', 'm.reciprocate.v1'],
      cryptoStore: typeof window !== 'undefined' ? new LocalStorageCryptoStore(window.localStorage) : undefined,
      cryptoCallbacks: {
        getSecretStorageKey: async ({ keys }: { keys: Record<string, any> }): Promise<[string, Uint8Array] | null> => {
            const keyIds = Object.keys(keys);
            const firstKeyId = keyIds[0];
            if (!firstKeyId) return null;
            const cachedKeyId = keyIds.find(id => this.secretStorageKeys.has(id));
            if (cachedKeyId) return [cachedKeyId, this.secretStorageKeys.get(cachedKeyId)!];

            return new Promise((resolve, reject) => {
                store.secretStoragePrompt = {
                    promise: { resolve, reject },
                    keyId: firstKeyId,
                    keyInfo: keys[firstKeyId]
                } as any;
                uiStore.setVerificationModalOpen(true);
            });
        },
        cacheSecretStorageKey: (keyId: string, _info: any, privateKey: Uint8Array) => {
            this.secretStorageKeys.set(keyId, privateKey);
        },
      }
    };

    this.client = markRaw(sdk.createClient(clientOpts));
    store.client = this.client;

    const storedExpiry = await getPref<number | null>('matrix_token_expiry', null);
    if (storedExpiry && (this.client as any).tokenRefresher) {
      (this.client as any).tokenRefresher.latestTokenRefreshExpiry = new Date(storedExpiry);
    }

    await roomStore.startup();
    await this.client.initRustCrypto();

    this.client.once(sdk.ClientEvent.Sync, async (state: sdk.SyncState) => {
      if (state === sdk.SyncState.Prepared || state === sdk.SyncState.Syncing) {
        store.isFullySynced = true;
        store.isClientReady = true;
        store.loginStatus = '';
        this.fetchUserProfile(userId);
      }
    });

    this.client.on(sdk.ClientEvent.Sync, (state: sdk.SyncState) => {
      store.isSyncing = state === sdk.SyncState.Syncing || state === sdk.SyncState.Prepared;
    });

    this.client.on(sdk.HttpApiEvent.SessionLoggedOut, () => this.logout());

    this.setupListeners();
    VerificationService.getInstance().setClient(this.client);

    this.client.startClient({ lazyLoadMembers: true, initialSyncLimit: 10 });
    store.isAuthenticated = true;
    store.isReady = true;
    store.isRestoringSession = false;
  }

  private setupListeners() {
    if (!this.client) return;
    const store = useMatrixStore();
    const activityStore = useActivityStore();
    const debouncedHierarchyTrigger = useDebounceFn(() => { store.hierarchyTrigger++; }, 150);

    this.client.on(sdk.ClientEvent.Room, () => { if (store.isClientReady) debouncedHierarchyTrigger(); });
    this.client.on(sdk.ClientEvent.AccountData, (ev) => {
        if (ev.getType() === sdk.EventType.Direct) debouncedHierarchyTrigger();
        if (ev.getType() === 'cc.jackg.ruby.pinned_spaces') {
            const content = ev.getContent();
            if (content?.rooms) store.pinnedSpaces = content.rooms;
        }
    });
    this.client.on(sdk.RoomStateEvent.Events, (ev) => {
        const type = ev.getType();
        if (store.isClientReady && ['m.space.child', 'm.space.parent'].includes(type)) debouncedHierarchyTrigger();
        if (type === 'cc.jackg.ruby.game.state') {
            const content = ev.getContent();
            if (content?.game_id) activityStore.updateGameState(content.game_id, content);
        }
    });
  }

  async fetchUserProfile(userId: string) {
    if (!this.client) return;
    const store = useMatrixStore();
    try {
      const profile = await this.client.getProfileInfo(userId);
      store.user = { userId, displayName: profile.displayname, avatarUrl: profile.avatar_url || undefined };
    } catch (e) { store.user = { userId }; }
  }

  async logout() {
    const store = useMatrixStore();
    if (this.client) {
      this.client.stopClient();
      this.client.removeAllListeners();
    }
    this.client = null;
    store.client = null;
    store.isAuthenticated = false;
    await deleteSecrets(['matrix_access_token', 'matrix_refresh_token']);
    await deletePref('matrix_user_id');
    await deletePref('matrix_device_id');
    await store._clearPersistentStores();
    await navigateTo('/');
  }

  async createRoom(opts: {
    name: string;
    topic?: string;
    isPublic?: boolean;
    enableEncryption?: boolean;
    roomAliasName?: string;
    spaceId?: string;
  }): Promise<string | undefined> {
    if (!this.client) throw new Error("Matrix client not initialized.");
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
    if (opts.roomAliasName) createOpts.room_alias_name = opts.roomAliasName;
    const result = await this.client.createRoom(createOpts);
    if (opts.spaceId) await this.addRoomToSpace(opts.spaceId, result.room_id);
    return result.room_id;
  }

  async createSpace(opts: {
    name: string;
    topic?: string;
    isPublic?: boolean;
    roomAliasName?: string;
  }): Promise<string | undefined> {
    if (!this.client) throw new Error("Matrix client not initialized.");
    const createOpts: any = {
      name: opts.name,
      topic: opts.topic,
      visibility: opts.isPublic ? sdk.Visibility.Public : sdk.Visibility.Private,
      preset: opts.isPublic ? sdk.Preset.PublicChat : sdk.Preset.PrivateChat,
      creation_content: { type: "m.space" }
    };
    if (opts.roomAliasName) createOpts.room_alias_name = opts.roomAliasName;
    const result = await this.client.createRoom(createOpts);
    return result.room_id;
  }

  async addRoomToSpace(spaceId: string, roomId: string) {
    if (!this.client) return;
    await this.client.sendStateEvent(spaceId, "m.space.child" as any, { via: [this.client.getDomain()!], suggested: false }, roomId);
    await this.client.sendStateEvent(roomId, "m.space.parent" as any, { via: [this.client.getDomain()!], canonical: true }, spaceId);
  }

  async sendTextMessage(roomId: string, text: string) {
    return this.client?.sendTextMessage(roomId, text);
  }

  async sendEdit(roomId: string, eventId: string, text: string) {
    if (!this.client) return;
    const content = {
      body: ` * ${text}`,
      msgtype: MsgType.Text,
      'm.new_content': { body: text, msgtype: MsgType.Text },
      'm.relates_to': { rel_type: 'm.replace', event_id: eventId }
    };
    return this.client.sendEvent(roomId, EventType.RoomMessage, content as any);
  }

  async sendReply(roomId: string, eventId: string, text: string) {
    if (!this.client) return;
    const content = {
      body: text,
      msgtype: MsgType.Text,
      'm.relates_to': { 'm.in_reply_to': { event_id: eventId } }
    };
    return this.client.sendEvent(roomId, EventType.RoomMessage, content as any);
  }

  async sendReadReceipt(event: sdk.MatrixEvent) {
    if (!this.client) return;
    return this.client.sendReadReceipt(event);
  }

  async markAsRead(roomId: string) {
    const store = useMatrixStore();
    const room = this.client?.getRoom(roomId);
    await dismissNotification(roomId);
    const last = room?.timeline[room.timeline.length - 1];
    if (last) {
        await this.client?.sendReadReceipt(last);
        delete store.manualUnread[roomId];
        store.unreadTrigger++;
    }
  }

  async acceptInvite(roomId: string) {
    if (!this.client) return;
    await this.client.joinRoom(roomId);
    const room = this.client.getRoom(roomId);
    if (room?.getMember(this.client.getUserId()!)?.events.member?.getContent().is_direct) {
        await this.markRoomAsDirect(roomId);
    }
  }

  async declineInvite(roomId: string) {
    if (!this.client) return;
    await this.client.leave(roomId);
    await this.client.forget(roomId);
  }

  async markRoomAsDirect(roomId: string) {
      if (!this.client) return;
      const room = this.client.getRoom(roomId);
      const other = room?.getMembers().find(m => m.userId !== this.client?.getUserId());
      if (!other) return;
      const dmEvent = this.client.getAccountData(sdk.EventType.Direct);
      const content = dmEvent ? JSON.parse(JSON.stringify(dmEvent.getContent())) : {};
      if (!content[other.userId]) content[other.userId] = [];
      if (!content[other.userId].includes(roomId)) {
          content[other.userId].push(roomId);
          await this.client.setAccountData(sdk.EventType.Direct, content);
      }
  }

  async setLastVisitedRoom(context: string, roomId: string | null) {
    const store = useMatrixStore();
    if (context === 'dm') store.lastVisitedRooms.dm = roomId;
    else if (context === 'rooms') store.lastVisitedRooms.rooms = roomId;
    else {
        if (roomId) store.lastVisitedRooms.spaces[context] = roomId;
        else delete store.lastVisitedRooms.spaces[context];
    }
    await setPref('matrix_last_visited_rooms', store.lastVisitedRooms);
  }

  async leaveRoom(roomId: string) {
    if (!this.client) return;
    await this.client.leave(roomId);
    await this.client.forget(roomId);
  }

  async redactEvent(roomId: string, eventId: string, reason?: string) {
    if (!this.client) return;
    return await this.client.redactEvent(roomId, eventId, undefined, { reason });
  }

  async markSpaceAsRead(spaceId: string) {
    if (!this.client) return;
    const room = this.client.getRoom(spaceId);
    if (!room) return;

    // Recursive read marking for space children
    const childEvents = room.currentState.getStateEvents('m.space.child');
    for (const ev of childEvents) {
        const childId = ev.getStateKey();
        if (childId) await this.markAsRead(childId);
    }
  }

  async setRoomTag(roomId: string, tag: string, content: any) {
    if (!this.client) return;
    if (content === null) {
        await (this.client as any).deleteTag(roomId, tag);
    } else {
        await (this.client as any).setTag(roomId, tag, content);
    }
  }

  async handleReaction(msg: any, key: string) {
    if (!this.client) return;
    await this.client.sendEvent(msg.roomId, 'm.reaction' as any, {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: msg.eventId,
        key: key
      }
    });
  }

  async uploadFile(roomId: string, file: File) {
    if (!this.client) return;
    const { content_uri } = await this.client.uploadContent(file);
    const content = {
      body: file.name,
      msgtype: file.type.startsWith('image/') ? MsgType.Image : MsgType.File,
      url: content_uri,
      info: {
        mimetype: file.type,
        size: file.size,
      }
    };
    return this.client.sendEvent(roomId, EventType.RoomMessage, content as any);
  }

  async refreshRoom(roomId: string) {
    // This could just be a trigger to components to re-render or a manual room fetch
    // For now, let's just ensure we have the room in the client
    return this.client?.getRoom(roomId);
  }

  async updateRoomMetadata(roomId: string, opts: { name?: string, topic?: string, avatarFile?: File }) {
    if (!this.client) return;
    if (opts.name) await this.client.setRoomName(roomId, opts.name);
    if (opts.topic) await this.client.setRoomTopic(roomId, opts.topic);
    if (opts.avatarFile) {
        const { content_uri } = await this.client.uploadContent(opts.avatarFile);
        await this.client.sendStateEvent(roomId, 'm.room.avatar' as any, { url: content_uri }, '');
    }
  }

  async kickUser(roomId: string, userId: string, reason?: string) {
    if (!this.client) return;
    return await this.client.kick(roomId, userId, reason);
  }

  async banUser(roomId: string, userId: string, reason?: string) {
    if (!this.client) return;
    return await this.client.ban(roomId, userId, reason);
  }

  async setRoomJoinRule(roomId: string, rule: string) {
    if (!this.client) return;
    return await this.client.sendStateEvent(roomId, 'm.room.join_rules' as any, { join_rule: rule }, '');
  }

  async createDirectRoom(userId: string) {
    if (!this.client) return;
    const response = await this.client.createRoom({
        invite: [userId],
        is_direct: true,
        preset: sdk.Preset.TrustedPrivateChat,
        visibility: sdk.Visibility.Private,
    });
    return response.room_id;
  }

  async joinRoom(roomIdOrAlias: string) {
    if (!this.client) return;
    return await this.client.joinRoom(roomIdOrAlias);
  }

  async setProfileDisplayName(name: string) {
    if (!this.client) return;
    await this.client.setDisplayName(name);
    await this.fetchUserProfile(this.client.getUserId()!);
  }

  async uploadAndSetProfileAvatar(file: File) {
    if (!this.client) return;
    const { content_uri } = await this.client.uploadContent(file);
    await this.client.setAvatarUrl(content_uri);
    await this.fetchUserProfile(this.client.getUserId()!);
  }

  async setProfileDescription(description: string) {
    if (!this.client) return;
    await this.client.setAccountData('cc.jackg.ruby.profile' as any, { description } as any);
    const store = useMatrixStore();
    if (store.user) store.user.description = description;
  }

  async handleCallback(code: string, state: string) {
    const result = await completeLoginFlow(code, state);
    const { accessToken, refreshToken, decodedIdToken, issuer, clientId, userId, deviceId } = result;

    await setPref('matrix_user_id', userId);
    if (deviceId) await setPref('matrix_device_id', deviceId);

    await this.initClient(
      accessToken,
      userId,
      deviceId,
      refreshToken,
      issuer,
      clientId,
      decodedIdToken
    );
  }

  async fetchSpaceHierarchy(spaceId: string) {
    if (!this.client) return;
    const store = useMatrixStore();
    try {
        // @ts-ignore - newer versions of SDK have this, or it's provided by a plugin
        const hierarchy = await this.client.getSpaceSummary(spaceId);
        store.spaceHierarchies[spaceId] = hierarchy.rooms;
        store.hierarchyTrigger++;
    } catch (e) {
        // Fallback for older SDK or different method name
        try {
           const hierarchy = await (this.client as any).getSpaceHierarchy(spaceId);
           store.spaceHierarchies[spaceId] = hierarchy.rooms;
           store.hierarchyTrigger++;
        } catch (e2) {
           console.error('Failed to fetch space hierarchy', e2);
        }
    }
  }

  async checkPendingShare() {
      const store = useMatrixStore();
      const uiStore = useUIStore();
      // Logic for checking pending shares from IndexedDB
      try {
          const { getPendingShare } = await import('~/utils/crypto-db');
          const share = await getPendingShare();
          if (share) {
              uiStore.pendingShare = share;
          }
      } catch (e) {
          console.error('[MatrixService] Failed to check pending share', e);
      }
  }

  async saveUIOrder() {
    const uiStore = useUIStore();
    await setPref('matrix_ui_order', uiStore.uiOrder);

    if (!this.client) return;
    try {
      await (this.client as any).setAccountData('cc.jackg.ruby.ui_order', uiStore.uiOrder);
    } catch (e) {
      console.error('Failed to save UI order to account data:', e);
    }
  }
}
