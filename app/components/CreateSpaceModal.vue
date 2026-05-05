<template>
  <UiDialog :open="uiStore.createSpaceModalOpen" @update:open="(val: boolean) => { if(!val) uiStore.closeCreateSpaceModal() }">
    <UiDialogContent class="sm:max-w-[425px] bg-background border-border">
      <UiDialogHeader>
        <UiDialogTitle class="text-2xl font-bold">Create a space</UiDialogTitle>
        <UiDialogDescription>
          Spaces are groups of rooms. They help you organize your conversations.
        </UiDialogDescription>
      </UiDialogHeader>
      
      <div class="grid gap-4 py-4">
        <div class="grid gap-2">
          <UiLabel for="space-name">Name</UiLabel>
          <UiInput id="space-name" v-model="name" placeholder="e.g. My Awesome Community" />
        </div>
        <div class="grid gap-2">
          <UiLabel for="space-topic">Topic (optional)</UiLabel>
          <UiTextarea id="space-topic" v-model="topic" placeholder="What's this space about?" rows="3" />
        </div>
        
        <div class="grid gap-2">
          <UiLabel>Privacy</UiLabel>
          <UiDropdownMenu>
            <UiDropdownMenuTrigger as-child>
              <UiButton variant="outline" class="w-full justify-start">
                <Icon :name="isPublic ? 'solar:globus-bold' : 'solar:lock-bold'" class="mr-2 h-4 w-4" />
                {{ isPublic ? 'Public space (anyone can find)' : 'Private space (invite only)' }}
                <Icon name="solar:alt-arrow-down-bold" class="ml-auto h-4 w-4 opacity-50" />
              </UiButton>
            </UiDropdownMenuTrigger>
            <UiDropdownMenuContent class="w-[375px]">
              <UiDropdownMenuItem @select="isPublic = false">
                <Icon name="solar:lock-bold" class="mr-2 h-4 w-4" />
                <div>
                  <div class="font-medium">Private space (invite only)</div>
                  <div class="text-xs text-muted-foreground">Only people invited will be able to find and join this space.</div>
                </div>
              </UiDropdownMenuItem>
              <UiDropdownMenuItem @select="isPublic = true">
                <Icon name="solar:globus-bold" class="mr-2 h-4 w-4" />
                <div>
                  <div class="font-medium">Public space (anyone can find)</div>
                  <div class="text-xs text-muted-foreground">Anyone can find and join this space.</div>
                </div>
              </UiDropdownMenuItem>
            </UiDropdownMenuContent>
          </UiDropdownMenu>
        </div>

        <div class="grid gap-2 pt-2">
          <UiLabel for="space-alias">Space Alias (optional)</UiLabel>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">#</span>
            <UiInput id="space-alias" v-model="roomAlias" placeholder="my-awesome-community" />
            <span class="text-muted-foreground">:{{ homeserverDomain }}</span>
          </div>
        </div>
      </div>
      
      <UiDialogFooter class="gap-2 sm:gap-0">
        <UiButton variant="ghost" :disabled="isSubmitting" @click="uiStore.closeCreateSpaceModal">Cancel</UiButton>
        <UiButton :disabled="!name.trim() || isSubmitting" @click="handleCreate">
          <UiSpinner v-if="isSubmitting" class="mr-2 h-4 w-4" />
          Create space
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
const name = ref('');
const topic = ref('');
const isPublic = ref(false);
const isSubmitting = ref(false);
const roomAlias = ref('');

const homeserverDomain = computed(() => store.client?.getDomain() || 'matrix.org');

watch(() => uiStore.createSpaceModalOpen, (open) => {
  if (!open) {
    name.value = '';
    topic.value = '';
    isPublic.value = false;
    roomAlias.value = '';
  }
});

const handleCreate = async () => {
  if (!name.value.trim() || isSubmitting.value) return;
  
  isSubmitting.value = true;
  try {
    const roomId = await matrixService.createSpace({
      name: name.value.trim(),
      topic: topic.value.trim() || undefined,
      isPublic: isPublic.value,
      roomAliasName: roomAlias.value.trim() || undefined
    });
    
    if (roomId) {
      uiStore.closeCreateSpaceModal();
      toast.success('Space created successfully');
      await navigateTo(`/chat/spaces/${roomId}`);
    }
  } catch (err: any) {
    console.error('Failed to create space:', err);
    toast.error('Failed to create space', { description: err.message });
  } finally {
    isSubmitting.value = false;
  }
};
</script>
