<template>
  <div class="flex flex-col w-[400px] p-4 rounded-lg bg-background border-1 border-border">
    <div class="mt-[-50px] mb-2">
      <UserProfile
        :user="user"
        size="full"
      />
    </div>
    <div class="text-sm text-muted-foreground mb-4">
      Example description
    </div>

    <!-- Game Activity -->
    <div class="mb-4">
      <GameCard :userId="userid" />
    </div>

    <div class="flex items-center gap-2 mt-auto">
      <UiButton
        @click="sendMessage"
      >Message</UiButton>
      <UiButton>Copy ID</UiButton>
    </div>
  </div>
</template>

<script lang="ts" setup>

const props = defineProps<{
  userid: string;
}>();

const store = useMatrixStore();

const user = computed(() => store.client?.getUser(props.userid));

console.log(user);

async function sendMessage() {
  if (!store.client) return;

  // 1. Check if we already have a known DM room with this user
  let roomId = store.directMessageMap?.[props.userid];

  // 2. Fallback: search joined rooms for a 1:1 DM
  if (!roomId) {
    const myUserId = store.client.getUserId();
    const rooms = store.client.getRooms();
    const existingRoom = rooms.find(r => {
      const members = r.getJoinedMembers();
      return members.length === 2 &&
             members.some(m => m.userId === props.userid) &&
             members.some(m => m.userId === myUserId);
    });
    if (existingRoom) {
      roomId = existingRoom.roomId;
    }
  }

  // 3. If room exists, navigate to it
  if (roomId) {
    store.setUISelectedUser(null);
    await navigateTo(`/chat/dms/${roomId}`);
    return;
  }

  // 4. Create a new DM
  try {
    const response = await store.client.createRoom({
      invite: [props.userid],
      is_direct: true,
      preset: 'trusted_private_chat' as any,
      visibility: 'private' as any,
    });
    store.setUISelectedUser(null);
    await navigateTo(`/chat/dms/${response.room_id}`);
  } catch (err) {
    console.error('Failed to create DM:', err);
  }
}
</script>

<style>

</style>