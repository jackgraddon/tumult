<template>
  <div class="flex flex-col min-h-screen items-center justify-center p-4 bg-background">
    <div class="w-full max-w-lg space-y-8">
      <div class="text-center space-y-2">
        <h1 class="text-4xl font-black tracking-tight">Choose your foundation</h1>
        <p class="text-muted-foreground">
          Tumult is the house, and Matrix is the ground it's built on—solid, unshakeable, and owned by no one.
        </p>
      </div>

      <UiCard class="border-2 shadow-xl overflow-hidden">
        <UiCardContent class="p-6 space-y-6">
          <div v-if="!matrixStore.isLoggingIn" class="space-y-6">
            <div class="grid grid-cols-2 gap-3">
              <button
                v-for="hs in recommendedHomeservers"
                :key="hs"
                @click="homeserver = hs; handleLogin()"
                class="flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left hover:border-primary/50 group"
                :class="homeserver === hs ? 'border-primary bg-primary/5' : 'bg-card border-transparent'"
              >
                <span class="font-bold group-hover:text-primary transition-colors">{{ hs }}</span>
                <span class="text-xs text-muted-foreground">{{ hs === 'matrix.org' ? 'The giant' : hs === 'mozilla.org' ? 'The non-profit' : hs === 'gnome.org' ? 'The community' : 'Solid foundation' }}</span>
              </button>
            </div>

            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <span class="w-full border-t" />
              </div>
              <div class="relative flex justify-center text-xs uppercase">
                <span class="bg-card px-2 text-muted-foreground">Or build on your own</span>
              </div>
            </div>

            <form @submit.prevent="handleLogin" class="space-y-4">
              <UiInputGroup>
                <UiInputGroupAddon>
                  <UiInputGroupText>https://</UiInputGroupText>
                </UiInputGroupAddon>
                <UiInputGroupInput
                  id="homeserverURL"
                  type="text"
                  v-model="homeserver"
                  placeholder="custom.homeserver.com"
                  class="!pl-2"
                />
                <UiInputGroupAddon align="inline-end">
                  <UiInputGroupButton
                    variant="default"
                    class="rounded-full"
                    @click="handleLogin"
                    size="icon-xs"
                    type="submit"
                  >
                    <Icon name="solar:alt-arrow-right-linear" class="size-4" />
                  </UiInputGroupButton>
                </UiInputGroupAddon>
              </UiInputGroup>
            </form>
          </div>

          <UiAlert v-if="error" variant="destructive" class="rounded-xl border-2 animate-in fade-in slide-in-from-top-2">
            <Icon name="solar:danger-triangle-linear" class="size-4" />
            <UiAlertTitle>Revolution speed bump</UiAlertTitle>
            <UiAlertDescription>{{ error }}</UiAlertDescription>
          </UiAlert>

          <div v-if="matrixStore.isLoggingIn" class="flex flex-col items-center gap-6 py-12 animate-in zoom-in-95 duration-300">
            <div class="relative flex items-center justify-center">
              <UiSpinner class="size-16 text-primary" />
              <div class="absolute text-xl font-bold text-primary animate-pulse">T</div>
            </div>
            <div class="text-center space-y-2">
              <p class="text-lg font-bold">Securing your foundation...</p>
              <p class="text-sm text-muted-foreground animate-pulse">
                Establishing encrypted connection to {{ homeserver }}
              </p>
            </div>
          </div>
        </UiCardContent>
      </UiCard>

      <p class="text-center text-xs text-muted-foreground/60 italic">
        "Smart, rebellious, and entirely yours."
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const matrixStore = useMatrixStore();
const config = useRuntimeConfig();
const recommendedHomeservers = config.public.matrix.recommendedHomeservers || ['matrix.org'];
const homeserver = ref<string>((config.public.matrix.baseUrl as string) || 'matrix.org');
const error = ref<string | null>(null);

const handleLogin = async () => {
  error.value = null;

  try {
    // If it's a known recommended server, we might want to ensure it has https:// but matrixStore.startLogin handles that
    await matrixStore.startLogin(homeserver.value);
  } catch (err: any) {
    console.error("Login initialization failed:", err);
    error.value = err.message || "Something broke. Even revolutions have speed bumps. We're on it.";
    matrixStore.isLoggingIn = false;
  }
};

onMounted(() => {
  console.log(homeserver.value, config.public.matrix.baseUrl);
});
</script>