<template>
  <div class="flex items-center justify-center h-screen">
    <UiCard v-if="error" class="w-full sm:max-w-md">
      <UiCardHeader>
        <UiCardTitle>Login Failed</UiCardTitle>
        <UiCardDescription>
          An error occurred during authentication.
        </UiCardDescription>
      </UiCardHeader>
      <UiCardContent>
        <UiAlert variant="destructive" class="mb-4">
          <UiAlertTitle>{{ error.title }}</UiAlertTitle>
          <UiAlertDescription>
            <p>{{ error.description }}</p>
          </UiAlertDescription>
        </UiAlert>
        <UiButton class="w-full" @click="backOut">
          Return to Home
        </UiButton>
      </UiCardContent>
    </UiCard>

    <div v-else class="flex flex-col items-center gap-4">
      <UiSpinner class="h-10 w-10 text-primary" />
      <p class="text-muted-foreground">Verifying with Matrix Homeserver...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMatrixStore } from "~/stores/matrix";
import { useServices } from "~/composables/useServices";

interface ErrorState {
  title: string;
  description: string;
}

const route = useRoute();
const matrixStore = useMatrixStore();
const { matrixService } = useServices();
const error = ref<ErrorState | null>(null);

const backOut = () => {
  navigateTo('/');
};

onMounted(async () => {
  try {
    // 1. Check for errors returned by the OIDC provider
    const errorParam = route.query.error as string;
    const errorDesc = route.query.error_description as string;

    if (errorParam) {
      throw new Error(errorDesc || errorParam);
    }

    // 2. Get authorization code and state
    const code = route.query.code as string;
    const state = route.query.state as string;

    if (!code || !state) {
      throw new Error("Missing authorization parameters from callback URL.");
    }

    // 3. Hand off to the Service to perform the SDK exchange
    await matrixService.handleCallback(code, state);

    // 4. (Optional) Set a cookie for Nuxt Middleware
    const authCookie = useCookie('auth_token');
    if (matrixStore.client?.getAccessToken()) {
       authCookie.value = matrixStore.client.getAccessToken();
    }

    // 5. Redirect to dashboard
    await navigateTo('/chat', { replace: true });

  } catch (err: any) {
    console.error('Authentication callback error:', err);

    error.value = {
      title: 'Authentication Error',
      description: err.message || 'Failed to complete authentication.',
    };
  }
});
</script>
