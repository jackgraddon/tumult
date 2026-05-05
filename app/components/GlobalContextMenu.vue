<template>
  <UiContextMenu @update:open="onOpenChange">
    <UiContextMenuTrigger
      class="contents"
      @contextmenu="onGlobalContextMenu"
    >
      <div v-long-press="onGlobalLongPress" class="contents">
        <slot />
      </div>
    </UiContextMenuTrigger>
    <UiContextMenuContent class="w-64">
      <!-- Room Context Menu Content -->
      <template v-if="uiStore.contextMenu.type === 'room'">
        <template v-if="room">
          <!-- Room/DM Options -->
          <template v-if="!isSpace">
            <UiContextMenuItem class="cursor-pointer" @click="toggleRead">
              <Icon :name="isUnread ? 'solar:letter-opened-bold-duotone' : 'solar:letter-bold-duotone'" class="mr-2 h-4 w-4" />
              Mark as {{ isUnread ? 'Read' : 'Unread' }}
            </UiContextMenuItem>
            <UiContextMenuItem class="cursor-pointer" @click="toggleFavorite">
              <Icon :name="isFavorite ? 'solar:star-fall-bold-duotone' : 'solar:star-bold-duotone'" class="mr-2 h-4 w-4" />
              {{ isFavorite ? 'Remove from Favorites' : 'Favorite' }}
            </UiContextMenuItem>
            <UiContextMenuItem class="cursor-pointer" @click="() => roomId && uiStore.openRoomSettingsModal(roomId)">
              <Icon name="solar:settings-minimalistic-bold-duotone" class="mr-2 h-4 w-4" />
              Settings
            </UiContextMenuItem>
            <UiContextMenuItem class="cursor-pointer" @click="openInvite">
              <Icon name="solar:user-plus-bold-duotone" class="mr-2 h-4 w-4" />
              Invite
            </UiContextMenuItem>
            <UiContextMenuItem class="cursor-pointer" @click="copyLink">
              <Icon name="solar:link-bold-duotone" class="mr-2 h-4 w-4" />
              Copy Room Link
            </UiContextMenuItem>
            <UiContextMenuSeparator />
            <UiContextMenuItem class="cursor-pointer text-destructive focus:text-destructive" @click="confirmLeave">
              <Icon name="solar:logout-bold-duotone" class="mr-2 h-4 w-4" />
              {{ isDM ? 'Close DM' : 'Leave the room' }}
            </UiContextMenuItem>
          </template>

          <!-- Space Options -->
          <template v-else>
            <UiContextMenuItem class="cursor-pointer" @click="markSpaceAsRead">
              <Icon name="solar:letter-opened-bold-duotone" class="mr-2 h-4 w-4" />
              Mark Space as Read
            </UiContextMenuItem>
            <UiContextMenuItem class="cursor-pointer" @click="() => roomId && uiStore.openSpaceSettingsModal(roomId)">
              <Icon name="solar:settings-minimalistic-bold-duotone" class="mr-2 h-4 w-4" />
              Settings
            </UiContextMenuItem>
            <UiContextMenuItem class="cursor-pointer" @click="openInvite">
              <Icon name="solar:user-plus-bold-duotone" class="mr-2 h-4 w-4" />
              Invite
            </UiContextMenuItem>
            <UiContextMenuItem class="cursor-pointer" @click="copyLink">
              <Icon name="solar:link-bold-duotone" class="mr-2 h-4 w-4" />
              Copy Space Link
            </UiContextMenuItem>
            <UiContextMenuItem class="cursor-pointer" @click="togglePin">
              <Icon :name="isPinned ? 'solar:pin-off-bold-duotone' : 'solar:pin-bold-duotone'" class="mr-2 h-4 w-4" />
              {{ isPinned ? 'Unpin from Sidebar' : 'Pin to Sidebar' }}
            </UiContextMenuItem>
            <UiContextMenuSeparator />
            <UiContextMenuItem class="cursor-pointer text-destructive focus:text-destructive" @click="confirmLeave">
              <Icon name="solar:logout-bold-duotone" class="mr-2 h-4 w-4" />
              Leave space
            </UiContextMenuItem>
          </template>
        </template>
        <template v-else>
          <UiContextMenuItem disabled>Loading room...</UiContextMenuItem>
        </template>
      </template>

      <!-- Message Context Menu Content -->
      <template v-else-if="uiStore.contextMenu.type === 'message'">
        <UiContextMenuItem @click="uiStore.setUIComposerState(activeMessage.roomId, { replyingTo: activeMessage })">
          Reply
        </UiContextMenuItem>

        <div 
          class="relative flex items-center px-2 py-1.5 text-sm hover:bg-muted hover:text-foreground rounded-sm transition-colors cursor-default select-none group/react"
          @mousedown.stop
          @mouseup.stop
          @click.stop
        >
          <UiPopover v-model:open="showReactionPicker" :modal="false">
            <UiPopoverTrigger as-child>
              <div class="flex items-center w-full gap-2 cursor-pointer">
                <span class="text-sm">React</span>
                <div class="flex items-center gap-1 ml-auto">
                  <button class="hover:bg-muted rounded px-1.5 py-0.5 transition-colors text-base" @click.stop="quickReact('👍')">👍</button>
                  <button class="hover:bg-muted rounded px-1.5 py-0.5 transition-colors text-base" @click.stop="quickReact('❤️')">❤️</button>
                  <button class="hover:bg-muted rounded px-1.5 py-0.5 transition-colors text-base" @click.stop="quickReact('😂')">😂</button>
                  <div class="w-px h-3.5 bg-border mx-0.5" />
                  <div class="hover:bg-muted rounded p-1 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center w-6 h-6">
                    <Icon name="solar:add-circle-linear" class="w-4 h-4" />
                  </div>
                </div>
              </div>
            </UiPopoverTrigger>
            <UiPopoverContent side="top" :side-offset="0" align="center" class="w-auto p-0 border-none shadow-2xl z-[100] bg-transparent">
              <EmojiPicker theme="auto" @select="onEmojiSelect" />
            </UiPopoverContent>
          </UiPopover>
        </div>

        <UiContextMenuItem @click="copyToClipboard(activeMessage.body)">
          Copy Text
        </UiContextMenuItem>
        
        <UiContextMenuItem @click="viewSource">
          View Source
        </UiContextMenuItem>

        <UiContextMenuSeparator v-if="activeMessage.isOwn" />
        <UiContextMenuItem v-if="activeMessage.isOwn" @click="uiStore.setUIComposerState(activeMessage.roomId, { editingMessage: activeMessage, text: activeMessage.body })">
          Edit
        </UiContextMenuItem>
        <UiContextMenuItem v-if="activeMessage.isOwn" class="text-red-500 focus:text-red-500" @click="confirmDeleteMessage">
          Delete
        </UiContextMenuItem>
      </template>

      <!-- Music Item Context Menu Content -->
      <template v-else-if="uiStore.contextMenu.type === 'music-item'">
        <template v-if="musicItem">
          <UiContextMenuItem class="cursor-pointer" @click="toggleMusicFavorite">
            <Icon :name="musicItem.UserData?.IsFavorite ? 'solar:heart-bold' : 'solar:heart-linear'" class="mr-2 h-4 w-4" :class="{'text-red-500': musicItem.UserData?.IsFavorite}" />
            {{ musicItem.UserData?.IsFavorite ? 'Remove from Favorites' : 'Favorite' }}
          </UiContextMenuItem>

          <UiContextMenuSeparator />

          <UiContextMenuItem v-if="musicItem.AlbumId || musicItem.Type === 'MusicAlbum'" class="cursor-pointer" @click="navigateTo(`/chat/music/albums/${musicItem.AlbumId || musicItem.Id}`)">
            <Icon name="solar:album-bold" class="mr-2 h-4 w-4" />
            Go to Album
          </UiContextMenuItem>
          <UiContextMenuItem v-if="musicItem.ArtistItems?.[0]?.Id || musicItem.Type === 'Artist' || musicItem.Type === 'MusicArtist'" class="cursor-pointer" @click="navigateTo(`/chat/music/artists/${musicItem.ArtistItems?.[0]?.Id || musicItem.Id}`)">
            <Icon name="solar:user-bold" class="mr-2 h-4 w-4" />
            Go to Artist
          </UiContextMenuItem>

          <UiContextMenuSeparator v-if="musicItem.Type === 'Audio'" />

          <UiContextMenuItem v-if="musicItem.Type === 'Audio'" class="cursor-pointer" @click="addMusicToStartOfQueue">
            <Icon name="solar:list-arrow-up-bold" class="mr-2 h-4 w-4" />
            Add to Start of Queue
          </UiContextMenuItem>
          <UiContextMenuItem v-if="musicItem.Type === 'Audio'" class="cursor-pointer" @click="addMusicToEndOfQueue">
            <Icon name="solar:list-arrow-down-bold" class="mr-2 h-4 w-4" />
            Add to End of Queue
          </UiContextMenuItem>
        </template>
        <template v-else>
          <UiContextMenuItem disabled>Loading item...</UiContextMenuItem>
        </template>
      </template>

      <!-- Global App Context Menu -->
      <template v-else>
        <UiContextMenuItem inset class="cursor-pointer" @click="reloadPage">
          Reload
        </UiContextMenuItem>
        <UiContextMenuItem inset class="cursor-pointer" @click="goBack">
          Back
        </UiContextMenuItem>
        <UiContextMenuItem inset class="cursor-pointer" @click="goForward">
          Forward
        </UiContextMenuItem>
        <UiContextMenuSeparator />
        <UiContextMenuItem inset class="cursor-pointer" @click="openAboutModal">
          About
        </UiContextMenuItem>
      </template>
    </UiContextMenuContent>
  </UiContextMenu>
</template>

<script setup lang="ts">
import { computed, ref, toRaw } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import { useUIStore } from '~/stores/ui';
import { useMusicStore } from '~/stores/music';
import { useJellyfinStore } from '~/stores/jellyfin';
import { useJellyfin } from '~/composables/useJellyfin';
import { useWebHaptics } from 'web-haptics/vue';
import { useServices } from '~/composables/useServices';
import { toast } from 'vue-sonner';
import { EventType } from 'matrix-js-sdk';
import EmojiPicker from 'vue3-emoji-picker';
import 'vue3-emoji-picker/css';

const store = useMatrixStore();
const uiStore = useUIStore();
const { matrixService } = useServices();
const musicStore = useMusicStore();
const jellyfinStore = useJellyfinStore();
const { fetcher: jellyfinFetch } = useJellyfin();
const { trigger } = useWebHaptics({
  debug: uiStore.hapticsDebugEnabled
});
const showReactionPicker = ref(false);

// --- Global Actions ---
const reloadPage = () => window.location.reload();
const goBack = () => window.history.back();
const goForward = () => window.history.forward();
const openAboutModal = () => uiStore.openAboutModal();

// --- Context Menu Management ---
const onGlobalContextMenu = (e: MouseEvent) => {
  // If a child component handled the right click, _contextMenuHandled will be true.
  // We don't want to reset it to false until AFTER the menu has been triggered to render.
  // Using nextTick or a small timeout to clear the flag ensures it stays true during the bubble phase.
  if (uiStore._contextMenuHandled) {
    setTimeout(() => {
        uiStore._contextMenuHandled = false;
    }, 10);
    return;
  }
  uiStore.setContextMenu('global');
};

const onGlobalLongPress = () => {
  if (uiStore._contextMenuHandled) return;
  if (uiStore.hapticFeedbackEnabled) trigger('medium');
  uiStore.setContextMenu('global');
};

const onOpenChange = (open: boolean) => {
  if (!open) {
    showReactionPicker.value = false;
    // Reset context menu state when closed
    uiStore.setContextMenu(null);
  }
};

// --- Room Context Logic ---
const roomId = computed(() => uiStore.contextMenu.type === 'room' ? uiStore.contextMenu.data?.roomId : null);
const room = computed(() => {
  if (!roomId.value || !store.client) return null;
  const r = store.client.getRoom(roomId.value);
  return r ? toRaw(r) : null;
});
const isSpace = computed(() => room.value && (room.value as any).isSpaceRoom?.());
const isDM = computed(() => {
  if (!room.value || !store.client || !roomId.value) return false;
  const directEvent = store.client.getAccountData(EventType.Direct);
  const directContent = directEvent ? directEvent.getContent() as Record<string, string[]> : {};
  return Object.values(directContent).some(roomIds => Array.isArray(roomIds) && roomIds.includes(roomId.value!));
});

const isUnread = computed(() => {
  if (!room.value || !roomId.value || typeof (room.value as any).getUnreadNotificationCount !== 'function') return false;
  const count = (room.value as any).getUnreadNotificationCount(store.unreadCountType) ?? 0;
  const manual = store.manualUnread[roomId.value] ? 1 : 0;
  return Math.max(count, manual) > 0;
});

const isFavorite = computed(() => {
  if (!room.value || typeof (room.value as any).getTags !== 'function') return false;
  const tags = (room.value as any).getTags();
  return 'm.favourite' in tags;
});

const isPinned = computed(() => roomId.value ? store.pinnedSpaces.includes(roomId.value) : false);

const togglePin = () => {
  if (!roomId.value) return;
  if (isPinned.value) {
    store.unpinSpace(roomId.value);
  } else {
    store.pinSpace(roomId.value);
  }
};

const toggleRead = () => {
  if (!roomId.value) return;
  if (isUnread.value) {
    matrixService.markAsRead(roomId.value);
  } else {
    store.markAsUnread(roomId.value);
  }
};

const markSpaceAsRead = () => roomId.value && matrixService.markSpaceAsRead(roomId.value);

const toggleFavorite = () => {
  if (!roomId.value) return;
  matrixService.setRoomTag(roomId.value, 'm.favourite', isFavorite.value ? null : { order: 0.5 });
};

const openInvite = () => {
  if (!roomId.value) return;
  store.setInviteRoomId(roomId.value);
  uiStore.openGlobalSearchModal();
};

const copyLink = () => {
  if (!room.value || !roomId.value || !(room.value as any).currentState) return;
  const via = (room.value as any).currentState.getStateEvents('m.room.member')
    .map((ev: any) => ev.getSender()?.split(':').pop())
    .filter((v: any, i: any, a: any) => v && a.indexOf(v) === i)
    .slice(0, 3);
  if (via.length === 0 && store.client?.getUserId()) {
    const userId = store.client.getUserId();
    if (userId) via.push(userId.split(':').pop()!);
  }
  const viaParams = via.map((v: any) => `via=${v}`).join('&');
  const link = `https://matrix.to/#/${roomId.value}${viaParams ? '?' + viaParams : ''}`;
  navigator.clipboard.writeText(link);
  toast.success('Link copied to clipboard');
};

const confirmLeave = () => {
  if (!roomId.value) return;
  const id = roomId.value;
  uiStore.openConfirmationDialog({
    title: 'Are you sure?',
    description: isSpace.value ? 'You are about to leave this space. You will no longer see its rooms unless you are still a member of them individually.' : 
                 (isDM.value ? 'This will close the DM and remove it from your list. You can restart it later by searching for the user.' : 
                 'You are about to leave this room. You will need an invite to rejoin if it is private.'),
    confirmLabel: isSpace.value ? 'Leave Space' : (isDM.value ? 'Close DM' : 'Leave Room'),
    onConfirm: () => matrixService.leaveRoom(id)
  });
};

// --- Message Context Logic ---
const activeMessage = computed(() => uiStore.contextMenu.type === 'message' ? uiStore.contextMenu.data?.msg : null);

const quickReact = (key: string) => {
  if (activeMessage.value) {
    matrixService.handleReaction(activeMessage.value, key);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }
};

const onEmojiSelect = (emoji: any) => {
  if (emoji && emoji.i && activeMessage.value) {
    matrixService.handleReaction(activeMessage.value, emoji.i);
    showReactionPicker.value = false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success('Copied to clipboard');
};

const viewSource = async () => {
  if (activeMessage.value && store.client) {
    // This part still requires some logic in Chat.vue to show the source dialog, 
    // or we move the source dialog to a global one too.
    // For now, let's trigger it via a custom event or a store property.
    (window as any).dispatchEvent(new CustomEvent('view-message-source', { detail: activeMessage.value.eventId }));
  }
};

const confirmDeleteMessage = () => {
  if (!activeMessage.value) return;
  const msg = activeMessage.value;
  uiStore.openConfirmationDialog({
    title: 'Delete Message?',
    description: 'Are you sure you want to delete this message? This action cannot be undone.',
    confirmLabel: 'Delete',
    onConfirm: () => matrixService.redactEvent(msg.roomId, msg.eventId)
  });
};

// --- Music Context Logic ---
const musicItem = computed(() => uiStore.contextMenu.type === 'music-item' ? uiStore.contextMenu.data?.item : null);

async function toggleMusicFavorite() {
  if (!musicItem.value || !jellyfinStore.isAuthenticated) return;

  const isFavorite = musicItem.value.UserData?.IsFavorite;
  try {
    await jellyfinFetch(`/Users/${jellyfinStore.userId}/FavoriteItems/${musicItem.value.Id}`, {
      method: isFavorite ? 'DELETE' : 'POST'
    });

    // Optimistic UI update for the context menu
    if (musicItem.value.UserData) {
      musicItem.value.UserData.IsFavorite = !isFavorite;
    }

    toast.success(isFavorite ? 'Removed from favorites' : 'Added to favorites');
  } catch (e) {
    console.error('[MusicContextMenu] Failed to toggle favorite:', e);
    toast.error('Failed to update favorite status');
  }
}

function mapToSong(item: any) {
  if (!item.Id || !item.Name) return null;
  const streamUrl = `${jellyfinStore.serverUrl}/Audio/${item.Id}/stream?static=true&api_key=${jellyfinStore.accessToken}`;
  const coverUrl = item.ImageTags?.Primary
    ? `${jellyfinStore.serverUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&maxWidth=100&api_key=${jellyfinStore.accessToken}`
    : undefined;

  return {
    id: item.Id,
    title: item.Name,
    artist: item.ArtistItems?.[0]?.Name || 'Unknown Artist',
    album: item.Album || undefined,
    coverUrl,
    streamUrl
  };
}

function addMusicToStartOfQueue() {
  if (musicItem.value) {
    const song = mapToSong(musicItem.value);
    if (song) {
      musicStore.addToStartOfQueue(song);
      toast.success('Added to start of queue');
    }
  }
}

function addMusicToEndOfQueue() {
  if (musicItem.value) {
    const song = mapToSong(musicItem.value);
    if (song) {
      musicStore.addToQueue(song);
      toast.success('Added to end of queue');
    }
  }
}
</script>
