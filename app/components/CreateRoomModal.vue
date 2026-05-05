<template>
  <UiDialog :open="uiStore.createRoomModalOpen" @update:open="(val: boolean) => { if(!val) uiStore.closeCreateRoomModal() }">
    <UiDialogContent class="sm:max-w-[425px] bg-background border-border">
      <UiDialogHeader>
        <UiDialogTitle class="text-2xl font-bold">Create a room</UiDialogTitle>
      </UiDialogHeader>
      
      <div class="grid gap-4 py-4">
        <div class="grid gap-2">
          <UiLabel for="name">Name</UiLabel>
          <UiInput id="name" v-model="name" placeholder="e.g. My Awesome Room" />
        </div>
        <div class="grid gap-2">
          <UiLabel for="topic">Topic (optional)</UiLabel>
          <UiTextarea id="topic" v-model="topic" placeholder="What's this room about?" rows="3" />
        </div>
        
        <div class="grid gap-2">
          <UiLabel>Privacy</UiLabel>
          <UiDropdownMenu>
            <UiDropdownMenuTrigger as-child>
              <UiButton variant="outline" class="w-full justify-start">
                <Icon :name="isPublic ? 'solar:globus-bold' : 'solar:lock-bold'" class="mr-2 h-4 w-4" />
                {{ isPublic ? 'Public room (anyone can find)' : 'Private room (invite only)' }}
                <Icon name="solar:alt-arrow-down-bold" class="ml-auto h-4 w-4 opacity-50" />
              </UiButton>
            </UiDropdownMenuTrigger>
            <UiDropdownMenuContent class="w-[375px]">
              <UiDropdownMenuItem @select="isPublic = false">
                <Icon name="solar:lock-bold" class="mr-2 h-4 w-4" />
                <div>
                  <div class="font-medium">Private room (invite only)</div>
                  <div class="text-xs text-muted-foreground">Only people invited will be able to find and join this room.</div>
                </div>
              </UiDropdownMenuItem>
              <UiDropdownMenuItem @select="isPublic = true">
                <Icon name="solar:globus-bold" class="mr-2 h-4 w-4" />
                <div>
                  <div class="font-medium">Public room (anyone can find)</div>
                  <div class="text-xs text-muted-foreground">Anyone can find and join this room.</div>
                </div>
              </UiDropdownMenuItem>
            </UiDropdownMenuContent>
          </UiDropdownMenu>
          <p class="text-[13px] text-muted-foreground mt-1">
            {{ isPublic ? 'Anyone on Matrix will be able to find and join this room.' : 'Only people invited will be able to find and join this room. You can change this at any time from room settings.' }}
          </p>
        </div>

        <div class="flex items-center justify-between space-x-2 pt-2">
          <div class="flex flex-col space-y-1">
            <UiLabel class="text-base">Enable end-to-end encryption</UiLabel>
            <p class="text-[13px] text-muted-foreground">
              You can't disable this later. Bridges & most bots won't work yet.
            </p>
          </div>
          <UiSwitch v-model:checked="enableEncryption" />
        </div>
        
        <div class="pt-2">
           <button 
            class="text-sm text-sky-500 font-semibold hover:underline bg-transparent border-none p-0 cursor-pointer"
            @click="showAdvanced = !showAdvanced"
           >
            {{ showAdvanced ? 'Hide advanced' : 'Show advanced' }}
           </button>
        </div>

        <div v-if="showAdvanced" class="grid gap-4 pt-2 border-t mt-2 animate-in fade-in slide-in-from-top-2">
          <div class="grid gap-2">
            <UiLabel for="alias">Room Alias (optional)</UiLabel>
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground">#</span>
              <UiInput id="alias" v-model="roomAlias" placeholder="my-awesome-room" />
              <span class="text-muted-foreground">:{{ homeserverDomain }}</span>
            </div>
            <p class="text-[11px] text-muted-foreground">
              A permanent link for your room.
            </p>
          </div>

          <div v-if="availableSpaces.length > 0" class="grid gap-2">
            <UiLabel>Add to Space</UiLabel>
            <UiDropdownMenu>
              <UiDropdownMenuTrigger as-child>
                <UiButton variant="outline" class="w-full justify-start">
                  <Icon name="solar:globus-bold" class="mr-2 h-4 w-4" />
                  {{ selectedSpace ? selectedSpace.name : 'No Space' }}
                  <Icon name="solar:alt-arrow-down-bold" class="ml-auto h-4 w-4 opacity-50" />
                </UiButton>
              </UiDropdownMenuTrigger>
              <UiDropdownMenuContent class="w-[375px]">
                <UiDropdownMenuItem @select="selectedSpace = null">
                   None
                </UiDropdownMenuItem>
                <UiDropdownMenuItem v-for="space in availableSpaces" :key="space.roomId" @select="selectedSpace = space">
                  <MatrixAvatar :mxc-url="space.getMxcAvatarUrl()" :name="space.name" class="h-4 w-4 mr-2" />
                  {{ space.name }}
                </UiDropdownMenuItem>
              </UiDropdownMenuContent>
            </UiDropdownMenu>
          </div>
        </div>
      </div>
      
      <UiDialogFooter class="gap-2 sm:gap-0">
        <UiButton variant="ghost" :disabled="isSubmitting" @click="uiStore.closeCreateRoomModal">Cancel</UiButton>
        <UiButton :disabled="!name.trim() || isSubmitting" @click="handleCreate">
          <UiSpinner v-if="isSubmitting" class="mr-2 h-4 w-4" />
          Create room
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { toast } from 'vue-sonner';

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();
const route = useRoute();
const name = ref('');
const topic = ref('');
const isPublic = ref(false);
const enableEncryption = ref(true);
const isSubmitting = ref(false);
const showAdvanced = ref(false);
const roomAlias = ref('');
const selectedSpace = ref<any>(null);

const homeserverDomain = computed(() => store.client?.getDomain() || 'matrix.org');

const availableSpaces = computed(() => {
  if (!store.client) return [];
  return store.client.getVisibleRooms().filter(r => r.isSpaceRoom() && r.getMyMembership() === 'join');
});

// Auto-select space from route if applicable
watch(() => uiStore.createRoomModalOpen, (open) => {
  if (open) {
    const spaceId = route.params.id;
    if (spaceId && !Array.isArray(spaceId)) {
      const space = store.client?.getRoom(spaceId);
      if (space && space.isSpaceRoom()) {
        selectedSpace.value = space;
      }
    } else if (Array.isArray(spaceId) && spaceId.length > 0) {
      const space = store.client?.getRoom(spaceId[0]);
      if (space && space.isSpaceRoom()) {
        selectedSpace.value = space;
      }
    }
  } else {
    // Reset on close
    name.value = '';
    topic.value = '';
    isPublic.value = false;
    enableEncryption.value = true;
    showAdvanced.value = false;
    roomAlias.value = '';
    selectedSpace.value = null;
  }
}, { immediate: true });

const handleCreate = async () => {
  if (!name.value.trim() || isSubmitting.value) return;
  
  isSubmitting.value = true;
  try {
    const roomId = await matrixService.createRoom({
      name: name.value.trim(),
      topic: topic.value.trim() || undefined,
      isPublic: isPublic.value,
      enableEncryption: enableEncryption.value,
      roomAliasName: roomAlias.value.trim() || undefined,
      spaceId: selectedSpace.value?.roomId
    });
    
    if (roomId) {
      uiStore.closeCreateRoomModal();
      uiStore.closeGlobalSearchModal();
      
      toast.success('Room created successfully');
      
      // Navigate to the room. If it's in a space, navigate to the space path
      if (selectedSpace.value) {
        await navigateTo(`/chat/spaces/${selectedSpace.value.roomId}/${roomId}`);
      } else {
        await navigateTo(`/chat/rooms/${roomId}`);
      }
    }
  } catch (err: any) {
    console.error('Failed to create room:', err);
    toast.error('Failed to create room', { description: err.message });
  } finally {
    isSubmitting.value = false;
  }
};
</script>
