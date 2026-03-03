<template>
  <div class="flex min-h-screen items-center justify-center bg-background">
    <UiCard class="w-full max-w-md">
      <UiCardHeader class="text-center">
        <UiCardTitle>Let's get you logged in.</UiCardTitle>
        <UiCardDescription>
          Enter your homeserver URL to connect.
        </UiCardDescription>
      </UiCardHeader>
      
      <UiCardContent class="flex flex-col gap-6">
        <form v-if="!matrixStore.isLoggingIn" @submit.prevent="handleLogin">
          <UiInputGroup>
            <UiInputGroupInput id="homeserverURL" type="url" v-model="homeserver" :placeholder="homeserver" class="!pl-1" />
            <UiInputGroupAddon>
              <UiInputGroupText>https://</UiInputGroupText>
            </UiInputGroupAddon>
            <UiInputGroupAddon align="inline-end">
              <UiInputGroupButton
                variant="default"
                class="rounded-full"
                @click="handleLogin" 
                size="icon-xs"
              >
                <Icon name="solar:alt-arrow-right-linear" class="size-4" />
              </UiInputGroupButton>
            </UiInputGroupAddon>
          </UiInputGroup>
        </form>
        <UiAlert v-if="error" variant="destructive">
          <UiAlertTitle>Connection Error</UiAlertTitle>
          <UiAlertDescription>{{ error }}</UiAlertDescription>
        </UiAlert>

        <div v-if="matrixStore.isLoggingIn" class="flex flex-col items-center gap-4 py-4">
          <UiSpinner class="size-8" />
          <p class="text-sm text-muted-foreground">
            Redirecting to secure login...
          </p>
        </div>
      </UiCardContent>
    </UiCard>
  </div>
</template>

<script setup lang="ts">
const matrixStore = useMatrixStore();
const config = useRuntimeConfig();
const homeserver = ref<string>((config.public.matrix.baseUrl as string) || 'matrix.org');
const error = ref<string | null>(null);

const handleLogin = async () => {
  error.value = null;

  try {
    await matrixStore.startLogin(homeserver.value);
  } catch (err: any) {
    console.error("Login initialization failed:", err);
    error.value = err.message || "Failed to connect to the authentication server.";
    matrixStore.isLoggingIn = false;
  }
};

onMounted(() => {
  console.log(homeserver.value, config.public.matrix.baseUrl);
});
</script>