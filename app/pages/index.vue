<template>
  <div class="relative max-w-4xl m-auto px-4 py-12 h-screen overflow-y-scroll flex flex-col justify-center items-center text-center space-y-12">
    <div class="flex items-end">
      <img src="~/assets/Flame.svg" class="size-18" alt="Tumult Logo" >
      <h1 class="text-6xl font-black">Tumult</h1>
    </div>

    <!-- Slogans/Campaign -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left">
      <div class="p-6 rounded-2xl bg-card border hover:border-primary/50 transition-colors space-y-3 hover:-translate-y-2 transition-transform duration-300">
        <div class="size-10 bg-primary/20 rounded-lg flex items-center justify-center">
          <Icon name="solar:shield-check-linear" class="size-6 text-primary" />
        </div>
        <h3 class="font-bold">Own Your Noise</h3>
        <p class="text-sm text-muted-foreground">Your data belongs to you, not a boardroom. We checked; it's not in our pockets.</p>
      </div>
      <div class="p-6 rounded-2xl bg-card border hover:border-primary/50 transition-colors space-y-3 hover:-translate-y-2 transition-transform duration-300">
        <div class="size-10 bg-primary/20 rounded-lg flex items-center justify-center">
          <Icon name="solar:users-group-two-rounded-linear" class="size-6 text-primary" />
        </div>
        <h3 class="font-bold">No Person Left Behind</h3>
        <p class="text-sm text-muted-foreground">Keep in touch with your friends on other platforms while you enjoy a better view.</p>
      </div>
      <div class="p-6 rounded-2xl bg-card border hover:border-primary/50 transition-colors space-y-3 hover:-translate-y-2 transition-transform duration-300">
        <div class="size-10 bg-primary/20 rounded-lg flex items-center justify-center">
          <Icon name="solar:leaf-linear" class="size-6 text-primary" />
        </div>
        <h3 class="font-bold">The New Standard</h3>
        <p class="text-sm text-muted-foreground">Built on Matrix. Solid, unshakeable, and owned by no one. A foundation for together.</p>
      </div>
    </div>

    <!-- CTA -->
    <div class="flex flex-col items-center gap-6">
      <div v-if="!isAuthenticated" class="flex flex-col items-center gap-4">
        <UiButton size="lg" class="text-xl p-6 shadow-xl" as-child>
          <NuxtLink to="/login">
            Reclaim your conversations
          </NuxtLink>
        </UiButton>
      </div>
      <div v-else class="flex flex-col items-center gap-6">
        <div class="p-4 rounded-xl bg-primary/10 border border-primary/20">
          <p class="font-medium">Welcome back, <span class="text-primary">{{ matrixStore.user?.userId }}</span></p>
        </div>
        <div class="flex flex-row gap-3">
          <UiButton variant="default" size="lg" class="rounded-xl px-8" as-child>
            <NuxtLink to="/chat">
              Go to Chat
            </NuxtLink>
          </UiButton>
          <UiButton variant="outline" size="lg" class="rounded-xl px-8" @click="logout">Logout</UiButton>
        </div>
      </div>
    </div>

    <!-- PWA Install Prompt -->
    <div v-if="showInstallButton || showIOSTip" class="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <div v-if="showInstallButton" class="group relative">
        <div class="absolute -inset-0.5 bg-gradient-to-r from-primary to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"/>
        <UiButton variant="secondary" size="lg" class="relative rounded-xl px-12 flex items-center gap-2" @click="installPWA">
          <Icon name="solar:download-square-linear" class="size-5" />
          Install Tumult App
        </UiButton>
      </div>

      <div v-if="showIOSTip" class="p-6 rounded-2xl bg-card border border-primary/20 shadow-lg max-w-xs text-center space-y-3">
        <div class="size-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
          <Icon name="solar:share-linear" class="size-6 text-primary" />
        </div>
        <h3 class="font-bold">Install on iOS</h3>
        <p class="text-sm text-muted-foreground leading-relaxed">
          Tap the <span class="text-foreground font-semibold">Share</span> icon in Safari and select <span class="text-foreground font-semibold">"Add to Home Screen"</span> to enjoy Tumult as a full app.
        </p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useUIStore } from "~/stores/ui";
import { useMatrixService, useAudioService, useJellyfinService, usePresenceService } from "~/composables/useServices";
const matrixStore = useMatrixStore();
const { isAuthenticated, isRestoringSession } = storeToRefs(matrixStore);
const { matrixService } = useServices();

function logout() {
  matrixService.logout();
}

const deferredPrompt = ref<any>(null);
const showInstallButton = ref(false);
const showIOSTip = ref(false);

const installPWA = async () => {
  if (!deferredPrompt.value) return;
  
  deferredPrompt.value.prompt();
  const { outcome } = await deferredPrompt.value.userChoice;
  console.log(`User response to the install prompt: ${outcome}`);
  
  deferredPrompt.value = null;
  showInstallButton.value = false;
};

// Auto navigate to chat if already logged in
watch(isAuthenticated, (val) => {
  if (val) {
    navigateTo('/chat');
  }
}, { immediate: true });

onMounted(() => {
  if (isAuthenticated.value) {
    navigateTo('/chat');
  }

  // PWA Install Logic
  const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

  if (isIOSDevice && !isStandalone) {
    showIOSTip.value = true;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt.value = e;
    // Update UI notify the user they can install the PWA
    showInstallButton.value = true;
  });

  window.addEventListener('appinstalled', () => {
    showInstallButton.value = false;
    showIOSTip.value = false;
    deferredPrompt.value = null;
    console.log('PWA was installed');
  });
});
</script>

<style scoped>

</style>