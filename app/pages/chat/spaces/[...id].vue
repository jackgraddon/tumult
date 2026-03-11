<template>
  <SpaceLobby v-if="isSpaceRoot" :space-id="activeSpaceId" />
  <Chat v-else :is-dm="false" />
</template>

<script setup lang="ts">
import Chat from '~/components/Chat.vue';
import SpaceLobby from '~/components/SpaceLobby.vue';

const route = useRoute();
const store = useMatrixStore();

const activeSpaceId = computed(() => {
  const params = route.params.id;
  if (Array.isArray(params) && params.length > 0) {
    return params[0];
  }
  return '';
});

const isSpaceRoot = computed(() => {
  const params = route.params.id;
  return Array.isArray(params) && params.length === 1;
});

// We still want to handle auto-redirection to the last visited room if the user
// navigates to the space root directly, but ONLY if we haven't already decided
// to show the lobby.
// Actually, let's DISABLE auto-redirection for now so users can see the lobby.
/*
onMounted(() => {
  const params = route.params.id;
  if (Array.isArray(params) && params.length === 1) {
    const spaceId = params[0];
    const lastRoomId = store.lastVisitedRooms.spaces[spaceId];
    if (lastRoomId) {
      navigateTo(`/chat/spaces/${spaceId}/${lastRoomId}`, { replace: true });
    }
  }
});
*/
</script>
