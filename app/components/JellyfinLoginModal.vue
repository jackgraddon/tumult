<template>
  <UiDialog :open="open" @update:open="(val: boolean) => $emit('update:open', val)">
    <UiDialogContent class="sm:max-w-[425px]" @interact-outside="(e: any) => e.preventDefault()">
      <UiDialogHeader>
        <UiDialogTitle>Link Jellyfin Account</UiDialogTitle>
        <UiDialogDescription>
          Enter your Jellyfin server details to link your account.
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="loginError" class="py-2">
        <UiAlert variant="destructive">
          <Icon name="solar:danger-bold" class="h-4 w-4" />
          <UiAlertTitle>Connection Error</UiAlertTitle>
          <UiAlertDescription>
            {{ loginError }}
          </UiAlertDescription>
        </UiAlert>
      </div>

      <div class="grid gap-4 py-4">
        <div class="grid gap-2">
          <UiLabel for="serverUrl">Server URL</UiLabel>
          <UiInput id="serverUrl" v-model="serverUrl" placeholder="https://jellyfin.example.com" />
        </div>
        <div class="grid gap-2">
          <UiLabel for="username">Username</UiLabel>
          <UiInput id="username" v-model="username" placeholder="Username" />
        </div>
        <div class="grid gap-2">
          <UiLabel for="password">Password</UiLabel>
          <UiInput id="password" v-model="password" type="password" placeholder="Password" />
        </div>
      </div>
      <UiDialogFooter>
        <UiButton :disabled="loading" @click="login">
          <Icon v-if="loading" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
          {{ loading ? 'Connecting...' : 'Link Account' }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner';
import { useJellyfinStore } from '~/stores/jellyfin';
import { useJellyfin } from '~/composables/useJellyfin';
import { useMatrixStore } from '~/stores/matrix';
import { useUIStore } from "~/stores/ui";
import { useMatrixService, useAudioService, useJellyfinService, usePresenceService } from "~/composables/useServices";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'success'): void;
}>();

const serverUrl = ref('');
const username = ref('');
const password = ref('');
const loading = ref(false);
const loginError = ref<string | null>(null);

const jellyfinStore = useJellyfinStore();
const { fetcher } = useJellyfin();

async function login() {
  loginError.value = null;
  if (!serverUrl.value || !username.value || !password.value) {
    loginError.value = 'Please fill in all fields';
    return;
  }

  loading.value = true;
  try {
    // 1. First, set the server URL in the store so the fetcher can use it
    jellyfinStore.serverUrl = serverUrl.value.replace(/\/$/, '');

    // 2. Authenticate
    const authData = await fetcher('/Users/AuthenticateByName', {
      method: 'POST',
      body: {
        Username: username.value,
        Pw: password.value,
      }
    }) as any;

    if (authData && typeof authData === 'object' && 'AccessToken' in authData) {
      const config = {
        serverUrl: jellyfinStore.serverUrl,
        accessToken: authData.AccessToken,
        userId: authData.User.Id
      };

      await jellyfinStore.setCredentials(
        config.serverUrl,
        config.accessToken,
        config.userId
      );

      // 3. Store in Matrix Account Data (Encrypted via SSSS)
      const matrixStore = useMatrixStore();
      if (matrixStore.client) {
        try {
          const crypto = matrixStore.client.getCrypto();
          if (crypto && matrixStore.isSecretStorageReady) {
            console.log('[Jellyfin] Storing credentials in Matrix Secret Storage');
            await (crypto as any).storeSecret('cc.tumult.jellyfin.config', JSON.stringify(config));
          } else {
            console.warn('[Jellyfin] Secret storage not ready, falling back to account data (less secure)');
            await matrixStore.client.setAccountData('cc.tumult.jellyfin.config' as any, config as any);
          }
        } catch (e) {
          console.error('[Jellyfin] Failed to store encrypted credentials:', e);
          // Fallback to plain account data if SSSS fails
          await matrixStore.client.setAccountData('cc.tumult.jellyfin.config' as any, config as any);
        }
      }

      toast.success('Jellyfin account linked successfully');
      emit('success');
      emit('update:open', false);
    } else {
      console.warn('[Jellyfin] Auth response missing expected tokens:', authData);
      loginError.value = 'Authentication response was invalid. Please check your credentials and server URL.';
    }
  } catch (e: any) {
    console.error('Jellyfin login failed:', e);
    loginError.value = e.message || 'An unexpected error occurred during login.';
  } finally {
    loading.value = false;
  }
}

</script>
