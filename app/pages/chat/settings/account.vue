<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">Account</h2>
    </div>

    <div>  
      <UiCard>
        <UiCardHeader>
          <UserProfile
            :user="store.user"
          />
        </UiCardHeader>
        <UiCardContent class="space-y-4">
          <div class="flex gap-2">
            <UiInput 
              v-model="manualStatusInput" 
              placeholder="What's on your mind?" 
              @keyup.enter="updateStatus"
            />
            <UiButton v-if="store.customStatus" variant="ghost" size="sm" @click="clearStatus">
              Clear
            </UiButton>
            <UiButton size="sm" @click="updateStatus">Set Status</UiButton>
          </div>
            <div class="space-y-4">
              <div class="flex gap-2 items-end">
                <div class="flex-1">
                  <UiInput
                    v-model="updatedUserInfo.displayName"
                    label="Display Name"
                    :placeholder="updatedUserInfo.displayName"
                    @keyup.enter="updateProfile"
                    @update:model-value="updatedUserInfo.isUpdating = true"
                  />
                </div>
                <UiButton 
                  :variant="updatedUserInfo.avatarFile.size > 0 ? 'default' : 'outline'"
                  @click="uploadAvatar"
                >
                  <Icon :name="updatedUserInfo.avatarFile.size > 0 ? 'solar:check-circle-outline' : 'solar:upload-outline'" />
                  <p v-if="updatedUserInfo.avatarFile.size > 0">Uploaded</p>
                  <p v-else>Update Avatar</p>
                </UiButton>
              </div>

              <div class="space-y-2">
                <UiLabel for="bio">Biography</UiLabel>
                <UiTextarea
                  id="bio"
                  v-model="updatedUserInfo.description"
                  placeholder="Tell us about yourself..."
                  class="min-h-[100px]"
                  @update:model-value="updatedUserInfo.isUpdating = true"
                />
              </div>

              <UiButton 
                aria-label="Save"
                title="Save"
                class="w-full"
                :variant="updatedUserInfo.isUpdating ? 'default' : 'outline'"
                :disabled="!updatedUserInfo.isUpdating"
                @click="updateProfile"
              >
                Save Changes
              </UiButton>
            </div>
        </UiCardContent>
      </UiCard>
    </div>

    <div>
      <h2 class="text-lg font-semibold tracking-tight">Account Linking</h2>
      <p class="text-sm text-muted-foreground mb-4">Link your account to other services.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 w-full ">
        <div class="flex items-center gap-4 p-4 rounded-md border">
          <div class="h-10 w-10 flex items-center justify-center rounded-full bg-[#AA5CC3] shrink-0">
            <Icon name="simple-icons:jellyfin" class="text-white h-6 w-6" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold truncate">Jellyfin</p>
            <p class="text-xs text-muted-foreground truncate">{{ jellyfinStore.serverUrl }}</p>
          </div>
          <UiButton
            v-if="jellyfinStore.isAuthenticated"
            variant="destructive"
            size="sm"
            @click="jellyfinStore.logout"
          >
            Unlink
          </UiButton>
          <UiButton
            v-else
            variant="default"
            size="sm"
            @click="isJellyfinModalOpen = true"
          >
            Link
          </UiButton>
        </div>
      </div>
    </div>

    <JellyfinLoginModal :open="isJellyfinModalOpen" @update:open="(val) => isJellyfinModalOpen = val" />

    <div>
      <h2 class="text-lg font-semibold tracking-tight">Bridging</h2>
      <p class="text-sm text-muted-foreground">Connect your off-platform chats to Matrix. Your homeserver must support the bridges to connect them.</p>
      <UiButton
        class="bg-[#5865F2] text-white hover:bg-[#5865F2]/90"
        @click="bridge('discord')"
      >
        <Icon name="simple-icons:discord" />
        Discord
    </UiButton>
    </div>

    <div class="flex gap-3">
      <UiButton variant="default" @click="manageDevices">
        <Icon name="solar:user-outline" />
        Manage Account
      </UiButton>
      <UiButton variant="destructive" @click="logout">
        <Icon name="solar:logout-outline" />
        Logout
      </UiButton>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { toast } from 'vue-sonner';
import { Preset, EventType } from 'matrix-js-sdk';
import { useJellyfinStore } from '~/stores/jellyfin';
import JellyfinLoginModal from '~/components/JellyfinLoginModal.vue';

definePageMeta({
  icon: 'solar:user-bold',
  category: 'user',
  title: 'Account',
  place: 1
})

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();
const jellyfinStore = useJellyfinStore();

const manualStatusInput = ref(store.customStatus || '');
const isJellyfinModalOpen = ref(false);

function updateStatus() {
  store.setCustomStatus(manualStatusInput.value);
}

function clearStatus() {
  manualStatusInput.value = '';
  store.setCustomStatus(null);
}

// Account Settings
const updatedUserInfo = ref(
  {
    isUpdating: false,
    displayName: store.user?.displayName,
    description: store.user?.description || '',
    avatarFile: new File([], ""),
  }
);

watchEffect(() => {
  if (store.user && !updatedUserInfo.value.isUpdating) {
    console.log('[AccountSettings] Syncing user data:', store.user);
    updatedUserInfo.value.displayName = store.user.displayName || '';
    updatedUserInfo.value.description = store.user.description || '';
  }
});

function uploadAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.click();
  input.onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      updatedUserInfo.value.avatarFile = file;
      updatedUserInfo.value.isUpdating = true;
    }
  };
}

async function updateProfile() {
  console.log('[AccountSettings] Saving profile changes:', updatedUserInfo.value);
  if (updatedUserInfo.value.displayName && updatedUserInfo.value.displayName !== store.user?.displayName) {
    console.log('[AccountSettings] Updating display name...');
    await matrixService.setProfileDisplayName(updatedUserInfo.value.displayName);
  }
  if (updatedUserInfo.value.avatarFile.size > 0) {
    console.log('[AccountSettings] Updating avatar...');
    await matrixService.uploadAndSetProfileAvatar(updatedUserInfo.value.avatarFile);
  }
  if (updatedUserInfo.value.description !== store.user?.description) {
    console.log('[AccountSettings] Updating bio...');
    await matrixService.setProfileDescription(updatedUserInfo.value.description);
  }
  updatedUserInfo.value.isUpdating = false;

  navigateTo('/chat/settings/account');
}

async function link(account: string) {
  
}

async function unlink(account: string) {
  
}

async function bridge(account: string) {
  const bridgeBotId = `@${account}bot:jackg.cc`;
  const roomId = findExistingDM(bridgeBotId);
  
  // If we already have a room, just go there
  if (roomId) {
    return await navigateTo(`/chat/rooms/${roomId}`);
  }

  try {    
    // Create the room
    const response = await store.client?.createRoom({
      is_direct: true,
      invite: [bridgeBotId],
      preset: Preset.TrustedPrivateChat, 
    });

    const newRoomId = response?.room_id;

    if (newRoomId) {
      // Update m.direct so the next check finds it
      await updateDirectMessagingData(bridgeBotId, newRoomId);
      
      toast.success(`Started ${account} bridge setup.`);
      await navigateTo(`/chat/rooms/${newRoomId}`);
    }
  } catch (err) {
    console.error(`Failed to create DM:`, err);
    toast.error(`Failed to start ${account} linking flow.`);
  }
}

async function updateDirectMessagingData(userId: string, roomId: string) {
  if (!store.client) return;

  // Get current m.direct content or start with an empty object
  const dmEvent = store.client.getAccountData(EventType.Direct);
  const content = dmEvent ? { ...dmEvent.getContent() } : {};

  // Ensure the user entry is an array and add the new room ID
  if (!content[userId]) {
    content[userId] = [];
  }
  
  if (!content[userId].includes(roomId)) {
    content[userId].push(roomId);
    
    // Save back to the server
    await store.client.setAccountData(EventType.Direct, content);
  }
}

function findExistingDM(userId: string): string | null {
  if (!store.client) return null;
  
  const dmEvent = store.client.getAccountData(EventType.Direct);
  if (!dmEvent) return null;
  
  const content = dmEvent.getContent();
  const rooms = content[userId];
  
  // Check if rooms is an array and has at least one ID
  return (Array.isArray(rooms) && rooms.length > 0) ? rooms[0] : null;
}

async function manageDevices() {
  const oidcConfigStr = localStorage.getItem('matrix_oidc_config');
  if (oidcConfigStr) {
    try {
      const oidcConfig = JSON.parse(oidcConfigStr);
      if (oidcConfig.issuer) {
        const accountUrl = new URL('/account', oidcConfig.issuer).toString();
        const { $isTauri: isTauri } = useNuxtApp();
        if (isTauri) {
          const { open } = await import('@tauri-apps/plugin-shell');
          await open(accountUrl);
        } else {
          window.open(accountUrl, '_blank');
        }
        return;
      }
    } catch(e) {
      console.error('Failed to parse OIDC config', e);
    }
  }
  toast.error("Could not determine account management URL");
}

function logout () {
    matrixService.logout();
}
</script>

<style>

</style>