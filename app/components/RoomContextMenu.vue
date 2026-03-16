<template>
  <UiContextMenu @update:open="onOpenChange">
    <UiContextMenuTrigger as-child>
      <slot />
    </UiContextMenuTrigger>
    <UiContextMenuContent class="w-64">
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
          <UiContextMenuItem @click="openInvite" class="cursor-pointer">
            <Icon name="solar:user-plus-bold-duotone" class="mr-2 h-4 w-4" />
            Invite
          </UiContextMenuItem>
          <UiContextMenuItem @click="copyLink" class="cursor-pointer">
            <Icon name="solar:link-bold-duotone" class="mr-2 h-4 w-4" />
            Copy Room Link
          </UiContextMenuItem>
          <UiContextMenuSeparator />
          <UiContextMenuItem @click="confirmLeave = true" class="cursor-pointer text-destructive focus:text-destructive">
            <Icon name="solar:logout-bold-duotone" class="mr-2 h-4 w-4" />
            {{ isDM ? 'Close DM' : 'Leave Room' }}
          </UiContextMenuItem>
        </template>

        <!-- Space Options -->
        <template v-else>
          <UiContextMenuItem @click="markSpaceAsRead" class="cursor-pointer">
            <Icon name="solar:letter-opened-bold-duotone" class="mr-2 h-4 w-4" />
            Mark Space as Read
          </UiContextMenuItem>
          <UiContextMenuItem @click="openInvite" class="cursor-pointer">
            <Icon name="solar:user-plus-bold-duotone" class="mr-2 h-4 w-4" />
            Invite
          </UiContextMenuItem>
          <UiContextMenuItem @click="copyLink" class="cursor-pointer">
            <Icon name="solar:link-bold-duotone" class="mr-2 h-4 w-4" />
            Copy Space Link
          </UiContextMenuItem>
          <UiContextMenuSeparator />
          <UiContextMenuItem @click="confirmLeave = true" class="cursor-pointer text-destructive focus:text-destructive">
            <Icon name="solar:logout-bold-duotone" class="mr-2 h-4 w-4" />
            Leave Space
          </UiContextMenuItem>
        </template>
      </template>
      <template v-else>
        <UiContextMenuItem disabled>Loading room...</UiContextMenuItem>
      </template>
    </UiContextMenuContent>
  </UiContextMenu>

  <!-- Leave Confirmation Dialog -->
  <UiAlertDialog :open="confirmLeave" @update:open="confirmLeave = $event">
    <UiAlertDialogContent>
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>Are you sure?</UiAlertDialogTitle>
        <UiAlertDialogDescription>
          {{ isSpace ? 'You are about to leave this space. You will no longer see its rooms unless you are still a member of them individually.' :
             (isDM ? 'This will close the DM and remove it from your list. You can restart it later by searching for the user.' :
             'You are about to leave this room. You will need an invite to rejoin if it is private.') }}
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
        <UiAlertDialogAction @click="leaveRoom" class="bg-destructive text-destructive-foreground hover:bg-destructive/90">
          {{ isSpace ? 'Leave Space' : (isDM ? 'Close DM' : 'Leave Room') }}
        </UiAlertDialogAction>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import { toast } from 'vue-sonner';
import { EventType } from 'matrix-js-sdk';

const props = defineProps<{
  roomId: string;
}>();

const store = useMatrixStore();
const confirmLeave = ref(false);

const room = computed(() => store.client?.getRoom(props.roomId));
const isSpace = computed(() => room.value?.isSpaceRoom());
const isDM = computed(() => {
  if (!room.value || !store.client) return false;
  const directEvent = store.client.getAccountData(EventType.Direct);
  const directContent = directEvent ? directEvent.getContent() as Record<string, string[]> : {};
  return Object.values(directContent).some(roomIds => roomIds.includes(props.roomId));
});

const isUnread = computed(() => {
  const count = room.value?.getUnreadNotificationCount(store.unreadCountType) ?? 0;
  const manual = store.manualUnread[props.roomId] ? 1 : 0;
  return Math.max(count, manual) > 0;
});

const isFavorite = computed(() => {
  if (!room.value) return false;
  const tags = room.value.getTags();
  return 'm.favourite' in tags;
});

const onOpenChange = (open: boolean) => {
  // If needed, refresh room data here
};

const toggleRead = () => {
  if (isUnread.value) {
    store.markAsRead(props.roomId);
  } else {
    store.markAsUnread(props.roomId);
  }
};

const markSpaceAsRead = () => {
  store.markSpaceAsRead(props.roomId);
};

const toggleFavorite = () => {
  store.setRoomTag(props.roomId, 'm.favourite', isFavorite.value ? null : { order: 0.5 });
};

const openInvite = () => {
  store.setInviteRoomId(props.roomId);
  store.openGlobalSearchModal();
};

const copyLink = () => {
  if (!room.value) return;

  const via = room.value.currentState.getStateEvents('m.room.member')
    .map(ev => ev.getSender().split(':').pop())
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .slice(0, 3);

  if (via.length === 0 && store.client?.getUserId()) {
      via.push(store.client.getUserId().split(':').pop()!);
  }

  const viaParams = via.map(v => `via=${v}`).join('&');
  const link = `https://matrix.to/#/${props.roomId}${viaParams ? '?' + viaParams : ''}`;

  navigator.clipboard.writeText(link);
  toast.success('Link copied to clipboard');
};

const leaveRoom = () => {
  store.leaveRoom(props.roomId);
  confirmLeave.value = false;
};
</script>
