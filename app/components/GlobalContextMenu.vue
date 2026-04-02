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
      <template v-if="store.ui.contextMenu.type === 'room'">
        <template v-if="room">
          <!-- Room/DM Options -->
          <template v-if="!isSpace">
            <UiContextMenuItem @click="toggleRead" class="cursor-pointer">
              <Icon :name="isUnread ? 'solar:letter-opened-bold-duotone' : 'solar:letter-bold-duotone'" class="mr-2 h-4 w-4" />
              Mark as {{ isUnread ? 'Read' : 'Unread' }}
            </UiContextMenuItem>
            <UiContextMenuItem @click="toggleFavorite" class="cursor-pointer">
              <Icon :name="isFavorite ? 'solar:star-fall-bold-duotone' : 'solar:star-bold-duotone'" class="mr-2 h-4 w-4" />
              {{ isFavorite ? 'Remove from Favorites' : 'Favorite' }}
            </UiContextMenuItem>
            <UiContextMenuItem @click="() => roomId && store.openRoomSettingsModal(roomId)" class="cursor-pointer">
              <Icon name="solar:settings-minimalistic-bold-duotone" class="mr-2 h-4 w-4" />
              Settings
            </UiContextMenuItem>
            <UiContextMenuItem @click="openInvite" class="cursor-pointer">
              <Icon name="solar:user-plus-bold-duotone" class="mr-2 h-4 w-4" />
              Invite
            </UiContextMenuItem>
            <UiContextMenuItem @click="copyLink" class="cursor-pointer">
              <Icon name="solar:link-bold-duotone" class="mr-2 h-4 w-4" />
              Copy Room Link
            </UiContextMenuItem>
            <UiContextMenuSeparator />
            <UiContextMenuItem @click="confirmLeave" class="cursor-pointer text-destructive focus:text-destructive">
              <Icon name="solar:logout-bold-duotone" class="mr-2 h-4 w-4" />
              {{ isDM ? 'Close DM' : 'Leave the room' }}
            </UiContextMenuItem>
          </template>

          <!-- Space Options -->
          <template v-else>
            <UiContextMenuItem @click="markSpaceAsRead" class="cursor-pointer">
              <Icon name="solar:letter-opened-bold-duotone" class="mr-2 h-4 w-4" />
              Mark Space as Read
            </UiContextMenuItem>
            <UiContextMenuItem @click="() => roomId && store.openSpaceSettingsModal(roomId)" class="cursor-pointer">
              <Icon name="solar:settings-minimalistic-bold-duotone" class="mr-2 h-4 w-4" />
              Settings
            </UiContextMenuItem>
            <UiContextMenuItem @click="openInvite" class="cursor-pointer">
              <Icon name="solar:user-plus-bold-duotone" class="mr-2 h-4 w-4" />
              Invite
            </UiContextMenuItem>
            <UiContextMenuItem @click="copyLink" class="cursor-pointer">
              <Icon name="solar:link-bold-duotone" class="mr-2 h-4 w-4" />
              Copy Space Link
            </UiContextMenuItem>
            <UiContextMenuItem @click="togglePin" class="cursor-pointer">
              <Icon :name="isPinned ? 'solar:pin-off-bold-duotone' : 'solar:pin-bold-duotone'" class="mr-2 h-4 w-4" />
              {{ isPinned ? 'Unpin from Sidebar' : 'Pin to Sidebar' }}
            </UiContextMenuItem>
            <UiContextMenuSeparator />
            <UiContextMenuItem @click="confirmLeave" class="cursor-pointer text-destructive focus:text-destructive">
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
      <template v-else-if="store.ui.contextMenu.type === 'message'">
        <UiContextMenuItem @click="store.handleReply(activeMessage)">
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
                  <button @click.stop="quickReact('👍')" class="hover:bg-muted rounded px-1.5 py-0.5 transition-colors text-base">👍</button>
                  <button @click.stop="quickReact('❤️')" class="hover:bg-muted rounded px-1.5 py-0.5 transition-colors text-base">❤️</button>
                  <button @click.stop="quickReact('😂')" class="hover:bg-muted rounded px-1.5 py-0.5 transition-colors text-base">😂</button>
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
        <UiContextMenuItem v-if="activeMessage.isOwn" @click="store.handleEdit(activeMessage)">
          Edit
        </UiContextMenuItem>
        <UiContextMenuItem v-if="activeMessage.isOwn" @click="confirmDeleteMessage" class="text-red-500 focus:text-red-500">
          Delete
        </UiContextMenuItem>
      </template>

      <!-- Global App Context Menu -->
      <template v-else>
        <UiContextMenuItem inset @click="reloadPage" class="cursor-pointer">
          Reload
        </UiContextMenuItem>
        <UiContextMenuItem inset @click="goBack" class="cursor-pointer">
          Back
        </UiContextMenuItem>
        <UiContextMenuItem inset @click="goForward" class="cursor-pointer">
          Forward
        </UiContextMenuItem>
        <UiContextMenuSeparator />
        <UiContextMenuItem inset @click="openAboutModal" class="cursor-pointer">
          About
        </UiContextMenuItem>
      </template>
    </UiContextMenuContent>
  </UiContextMenu>
</template>

<script setup lang="ts">
import { computed, ref, toRaw } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import { toast } from 'vue-sonner';
import { EventType } from 'matrix-js-sdk';
import EmojiPicker from 'vue3-emoji-picker';
import 'vue3-emoji-picker/css';

const store = useMatrixStore();
const haptics = useHaptics();
const showReactionPicker = ref(false);

// --- Global Actions ---
const reloadPage = () => window.location.reload();
const goBack = () => window.history.back();
const goForward = () => window.history.forward();
const openAboutModal = () => {};

// --- Context Menu Management ---
const onGlobalContextMenu = (e: MouseEvent) => {
  // If a child component handled the right click, _contextMenuHandled will be true.
  // We don't want to reset it to false until AFTER the menu has been triggered to render.
  // Using nextTick or a small timeout to clear the flag ensures it stays true during the bubble phase.
  if (store.ui._contextMenuHandled) {
    setTimeout(() => {
        store.ui._contextMenuHandled = false;
    }, 10);
    return;
  }
  store.setContextMenu('global');
};

const onGlobalLongPress = () => {
  if (store.ui._contextMenuHandled) return;
  haptics.medium();
  store.setContextMenu('global');
};

const onOpenChange = (open: boolean) => {
  if (!open) {
    showReactionPicker.value = false;
    // Reset context menu state when closed
    store.setContextMenu(null);
  }
};

// --- Room Context Logic ---
const roomId = computed(() => store.ui.contextMenu.type === 'room' ? store.ui.contextMenu.data?.roomId : null);
const room = computed(() => {
  if (!roomId.value || !store.client) return null;
  const r = store.client.getRoom(roomId.value);
  return r ? toRaw(r) : null;
});
const isSpace = computed(() => room.value && typeof room.value.isSpaceRoom === 'function' && room.value.isSpaceRoom());
const isDM = computed(() => {
  if (!room.value || !store.client || !roomId.value) return false;
  const directEvent = store.client.getAccountData(EventType.Direct);
  const directContent = directEvent ? directEvent.getContent() as Record<string, string[]> : {};
  return Object.values(directContent).some(roomIds => roomIds.includes(roomId.value!));
});

const isUnread = computed(() => {
  if (!room.value || !roomId.value || typeof room.value.getUnreadNotificationCount !== 'function') return false;
  const count = room.value.getUnreadNotificationCount(store.unreadCountType) ?? 0;
  const manual = store.manualUnread[roomId.value] ? 1 : 0;
  return Math.max(count, manual) > 0;
});

const isFavorite = computed(() => {
  if (!room.value || typeof room.value.getTags !== 'function') return false;
  const tags = room.value.getTags();
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
    store.markAsRead(roomId.value);
  } else {
    store.markAsUnread(roomId.value);
  }
};

const markSpaceAsRead = () => roomId.value && store.markSpaceAsRead(roomId.value);

const toggleFavorite = () => {
  if (!roomId.value) return;
  store.setRoomTag(roomId.value, 'm.favourite', isFavorite.value ? null : { order: 0.5 });
};

const openInvite = () => {
  if (!roomId.value) return;
  store.setInviteRoomId(roomId.value);
  store.openGlobalSearchModal();
};

const copyLink = () => {
  if (!room.value || !roomId.value || !room.value.currentState) return;
  const via = room.value.currentState.getStateEvents('m.room.member')
    .map(ev => ev.getSender().split(':').pop())
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .slice(0, 3);
  if (via.length === 0 && store.client?.getUserId()) {
    via.push(store.client.getUserId().split(':').pop()!);
  }
  const viaParams = via.map(v => `via=${v}`).join('&');
  const link = `https://matrix.to/#/${roomId.value}${viaParams ? '?' + viaParams : ''}`;
  navigator.clipboard.writeText(link);
  toast.success('Link copied to clipboard');
};

const confirmLeave = () => {
  if (!roomId.value) return;
  const id = roomId.value;
  store.openConfirmationDialog({
    title: 'Are you sure?',
    description: isSpace.value ? 'You are about to leave this space. You will no longer see its rooms unless you are still a member of them individually.' : 
                 (isDM.value ? 'This will close the DM and remove it from your list. You can restart it later by searching for the user.' : 
                 'You are about to leave this room. You will need an invite to rejoin if it is private.'),
    confirmLabel: isSpace.value ? 'Leave Space' : (isDM.value ? 'Close DM' : 'Leave Room'),
    onConfirm: () => store.leaveRoom(id)
  });
};

// --- Message Context Logic ---
const activeMessage = computed(() => store.ui.contextMenu.type === 'message' ? store.ui.contextMenu.data?.msg : null);

const quickReact = (key: string) => {
  if (activeMessage.value) {
    store.handleReaction(activeMessage.value, key);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }
};

const onEmojiSelect = (emoji: any) => {
  if (emoji && emoji.i && activeMessage.value) {
    store.handleReaction(activeMessage.value, emoji.i);
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
  store.openConfirmationDialog({
    title: 'Delete Message?',
    description: 'Are you sure you want to delete this message? This action cannot be undone.',
    confirmLabel: 'Delete',
    onConfirm: () => store.redactEvent(msg.roomId, msg.eventId)
  });
};
</script>
