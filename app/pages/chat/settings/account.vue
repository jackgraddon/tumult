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
          <div class="space-y-2">
            <h4 class="text-md font-semibold tracking-tight">Edit Profile</h4>
            <div class="flex gap-2">
              <UiButton 
                :variant="updatedUserInfo.avatarFile.size > 0 ? 'default' : 'outline'"
                @click="uploadAvatar"
              >
                <Icon :name="updatedUserInfo.avatarFile.size > 0 ? 'solar:check-circle-outline' : 'solar:upload-outline'" />
                <p v-if="updatedUserInfo.avatarFile.size > 0">Uploaded</p>
                <p v-else>Upload Avatar</p>
              </UiButton>
              <UiInput
                label="Display Name"
                :placeholder="updatedUserInfo.displayName"
                v-model="updatedUserInfo.displayName"
                @keyup.enter="updateProfile"
                @update:model-value="updatedUserInfo.isUpdating = true"
              />
              <UiButton 
                aria-label="Save"
                title="Save"
                :variant="updatedUserInfo.isUpdating ? 'default' : 'outline'"
                :disabled="!updatedUserInfo.isUpdating"
                @click="updateProfile"
              >
                Save Changes
              </UiButton>
            </div>
          </div>
        </UiCardContent>
      </UiCard>
    </div>
    <!-- Activity Status (Desktop Only) -->
    <div class="space-y-4">
      <h3 class="text-xl font-semibold tracking-tight">Status</h3>
    </div>

    <div v-if="gameActivity.isSupported.value" class="space-y-4">
      <div class="flex items-start justify-between rounded-lg border p-4">
        <div class="flex items-start gap-3">
          <Icon name="solar:gamepad-bold" class="h-5 w-5 text-muted-foreground mt-0.5" />
          <div class="space-y-1">
            <p class="text-sm font-medium">Game Detection</p>
            <p class="text-xs text-muted-foreground max-w-md">
              Automatically detect running games and show them as your Matrix status.
            </p>
            <div class="pt-2">
              <UiDropdownMenu>
                <UiDropdownMenuTrigger as-child>
                  <UiButton variant="outline" size="sm" class="capitalize">
                    {{ store.gameDetectionLevel }}
                    <Icon name="solar:alt-arrow-down-outline" class="ml-2 h-4 w-4" />
                  </UiButton>
                </UiDropdownMenuTrigger>
                <UiDropdownMenuContent align="start" class="w-80">
                  <UiDropdownMenuRadioGroup v-model="gameDetectionLevel">
                    <UiDropdownMenuRadioItem value="off" class="flex flex-col items-start py-2 gap-0 cursor-pointer">
                      <span class="font-medium">Off</span>
                      <span class="text-[10px] text-muted-foreground line-clamp-2">Disable all game detection and activity status.</span>
                    </UiDropdownMenuRadioItem>
                    <UiDropdownMenuRadioItem value="basic" class="flex flex-col items-start py-2 gap-0 cursor-pointer">
                      <span class="font-medium">Basic</span>
                      <span class="text-[10px] text-muted-foreground">Scans for running processes and matches them with known games. Less acurate, but more compatible.</span>
                    </UiDropdownMenuRadioItem>
                    <UiDropdownMenuRadioItem value="advanced" class="flex flex-col items-start py-2 gap-0 cursor-pointer">
                      <span class="font-medium">Advanced</span>
                      <span class="text-[10px] text-muted-foreground">Hooks into games that supports Discord RPC (Cannot be running with Discord open). More acurate, but less compatible.</span>
                    </UiDropdownMenuRadioItem>
                  </UiDropdownMenuRadioGroup>
                </UiDropdownMenuContent>
              </UiDropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div>
      <h2 class="text-lg font-semibold tracking-tight">Account Linking</h2>
      <p class="text-sm text-muted-foreground">Link your account to other services.</p>
      <UiButton
        @click="link('jellyfin')"
        class="bg-[#AA5CC3] text-white hover:bg-[#AA5CC3]/90"
      >
        <Icon name="simple-icons:jellyfin" />
        Jellyfin
      </UiButton>
    </div>

    <div>
      <h2 class="text-lg font-semibold tracking-tight">Bridging</h2>
      <p class="text-sm text-muted-foreground">Connect your off-platform chats to Matrix. Your homeserver must support the bridges to connect them.</p>
      <UiButton
        @click="bridge('discord')"
        class="bg-[#5865F2] text-white hover:bg-[#5865F2]/90"
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
definePageMeta({
  icon: 'solar:user-bold',
  category: 'user',
  title: 'Account',
  place: 1
})

import { toast } from 'vue-sonner';

const store = useMatrixStore();
const gameActivity = useGameActivity();

const gameDetectionLevel = computed({
  get: () => store.gameDetectionLevel,
  set: (val: any) => store.setGameDetectionLevel(val),
});

const manualStatusInput = ref(store.customStatus || '');

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
    avatarFile: new File([], ""),

  }
);

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
  if (updatedUserInfo.value.displayName) {
    await store.setProfileDisplayName(updatedUserInfo.value.displayName);
  }
  if (updatedUserInfo.value.avatarFile.size > 0) {
    await store.uploadAndSetProfileAvatar(updatedUserInfo.value.avatarFile);
  }
  updatedUserInfo.value.isUpdating = false;

  navigateTo('/chat/settings/account');
}

async function link(account: string) {
  
}

async function unlink(account: string) {
  
}

async function bridge(account: string) {
  let bridgeAccount = `@${account}bot:jackg.cc`; // e.g. "discordbot"
  
  // Check if the user already has a DM with this bridge bot
  const existingDmRoom = store.directMessageMap[bridgeAccount];
  
  if (existingDmRoom) {
    toast.error(`It looks like you already have a ${account} bridge connected. Please unlink it from your account management page before linking a new one.`);
    console.log(`Existing bridge account: ${bridgeAccount}`);
    return;
  }
  
  // Otherwise, open a new DM with the bot to trigger the bridge linking flow
  try {    
    await store.client?.createRoom({
      is_direct: true,
      invite: [bridgeAccount],
    });
    toast.success(`Successfully started ${account} bridge setup. Check your DMs with ${bridgeAccount}`);
  } catch (err) {
    console.error(`Failed to create DM with ${bridgeAccount}:`, err);
    toast.error(`Failed to start ${account} linking flow. Please try again.`);
  }
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
    store.logout();
}
</script>

<style>

</style>