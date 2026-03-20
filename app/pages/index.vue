<template>
  <div class="flex flex-col items-center justify-center min-h-screen px-4 py-12 bg-background text-foreground overflow-hidden">
    <!-- Animated Background Elements -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden">
      <div class="absolute -top-24 -left-24 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse"></div>
      <div class="absolute top-1/2 -right-24 w-64 h-64 bg-accent/10 rounded-full blur-3xl animate-pulse delay-700"></div>
    </div>

    <div class="relative z-10 w-full max-w-4xl flex flex-col items-center text-center space-y-12">
      <!-- Logo/Brand -->
      <div class="flex flex-col items-center space-y-4">
        <div class="size-20 bg-primary flex items-center justify-center rounded-2xl shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500 group">
          <span class="text-5xl font-black text-primary-foreground group-hover:scale-110 transition-transform">T</span>
        </div>
        <h1 class="text-6xl font-black tracking-tighter">Tumult</h1>
      </div>

      <!-- Narrative -->
      <div class="space-y-6 max-w-2xl">
        <h2 class="text-3xl font-bold text-balance italic">
          Finding peace in the chaos.
        </h2>
        <p class="text-xl text-muted-foreground leading-relaxed">
          The "uproar" is out there. The noise, the ads, the privacy concerns. Tumult is your organized movement away from it.
        </p>
      </div>

      <!-- Slogans/Campaign -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left">
        <div class="p-6 rounded-2xl bg-card border hover:border-primary/50 transition-colors space-y-3">
          <div class="size-10 bg-primary/20 rounded-lg flex items-center justify-center">
            <Icon name="solar:shield-check-linear" class="size-6 text-primary" />
          </div>
          <h3 class="font-bold">Own your noise.</h3>
          <p class="text-sm text-muted-foreground">Your data belongs to you, not a boardroom. Decentralized by default, private by design.</p>
        </div>
        <div class="p-6 rounded-2xl bg-card border hover:border-primary/50 transition-colors space-y-3">
          <div class="size-10 bg-primary/20 rounded-lg flex items-center justify-center">
            <Icon name="solar:users-group-two-rounded-linear" class="size-6 text-primary" />
          </div>
          <h3 class="font-bold">No User Left Behind.</h3>
          <p class="text-sm text-muted-foreground">Bridge the gap. Keep your friends on other platforms while you enjoy a better view.</p>
        </div>
        <div class="p-6 rounded-2xl bg-card border hover:border-primary/50 transition-colors space-y-3">
          <div class="size-10 bg-primary/20 rounded-lg flex items-center justify-center">
            <Icon name="solar:leaf-linear" class="size-6 text-primary" />
          </div>
          <h3 class="font-bold">The New Standard.</h3>
          <p class="text-sm text-muted-foreground">Built on Matrix—solid, unshakeable, and owned by no one. A foundation for together.</p>
        </div>
      </div>

      <!-- CTA -->
      <div class="flex flex-col items-center gap-6">
        <div v-if="isRestoringSession" class="flex flex-col items-center gap-4 py-4">
           <UiSpinner class="size-8 text-primary" />
           <p class="text-sm text-muted-foreground">Restoring your session...</p>
        </div>
        <div v-else-if="!isAuthenticated" class="flex flex-col items-center gap-4">
          <UiButton size="lg" class="px-12 py-6 text-xl font-bold rounded-2xl shadow-xl hover:scale-105 transition-transform" as-child>
            <NuxtLink to="/login">
              Reclaim your conversations
            </NuxtLink>
          </UiButton>
          <p class="text-sm text-muted-foreground italic">"A better place for the uproar."</p>
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
    </div>
  </div>
</template>

<script lang="ts" setup>
const matrixStore = useMatrixStore();
const { isAuthenticated, isRestoringSession } = storeToRefs(matrixStore);
const { logout } = matrixStore; // Actions can be destructured directly

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
});
</script>

<style scoped>

</style>