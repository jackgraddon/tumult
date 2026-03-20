<template>
  <div 
    v-if="isVisible"
    class="px-4 py-2 border-b flex items-center justify-between gap-4 transition-all"
    :class="bannerStyles"
  >
    <div class="flex items-center gap-3 overflow-hidden">
      <div class="shrink-0 w-7 flex items-center justify-center aspect-square rounded-full" :class="iconBgStyles">
        <Icon :name="iconName" />
      </div>
      <div class="flex flex-col min-w-0">
        <span class="text-sm font-semibold truncate">{{ title }}</span>
        <span class="text-xs opacity-80 truncate">{{ description }}</span>
      </div>
    </div>
    
    <div class="flex items-center gap-2 shrink-0">
      <UiButton 
        v-if="showClose"
        variant="ghost" 
        size="sm" 
        class="h-8 px-2 opacity-70 hover:opacity-100"
        @click="dismiss"
      >
        <Icon name="solar:close-circle-linear" class="size-4" />
      </UiButton>
      <UiButton 
        size="sm" 
        class="h-8 text-xs font-bold"
        @click="handleAction"
      >
        {{ actionLabel }}
      </UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMatrixStore } from '~/stores/matrix';

const store = useMatrixStore();

const isDismissed = ref(false);

const isVisible = computed(() => {
  if (isDismissed.value) return false;
  // Show as long as we are authenticated, even if sync hasn't fully "Prepared" 
  // This ensures users see the rehydration "Soft Trigger" immediately.
  return store.isAuthenticated && (store.isCryptoDegraded || store.isWaitingForRecoveryKey || store.needsRecoveryKeySetup);
});

const type = computed(() => {
  if (store.isCryptoDegraded) return 'degraded';
  if (store.isWaitingForRecoveryKey) return 'soft-trigger';
  if (store.needsRecoveryKeySetup) return 'security-warning';
  return null;
});

const bannerStyles = computed(() => {
  if (type.value === 'degraded') return 'bg-destructive/10 border-destructive/20 text-destructive dark:bg-destructive/20 dark:border-destructive/30 dark:text-red-300';
  if (type.value === 'soft-trigger') return 'bg-blue-50 border-blue-100 text-blue-900 dark:bg-blue-950/30 dark:border-blue-900/50 dark:text-blue-200';
  return 'bg-amber-50 border-amber-100 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/50 dark:text-amber-200';
});

const iconBgStyles = computed(() => {
  if (type.value === 'degraded') return 'bg-destructive/20 dark:bg-destructive/40';
  if (type.value === 'soft-trigger') return 'bg-blue-100 dark:bg-blue-900';
  return 'bg-amber-100 dark:bg-amber-900';
});

const iconName = computed(() => {
  if (type.value === 'degraded') return 'solar:shield-warning-bold';
  if (type.value === 'soft-trigger') return 'solar:shield-keyhole-bold';
  return 'solar:shield-warning-bold';
});

const title = computed(() => {
  if (type.value === 'degraded') return 'Revolution speed bump';
  if (type.value === 'soft-trigger') return 'Solidify the foundation';
  return 'Own your noise';
});

const description = computed(() => {
  if (type.value === 'degraded') return store.cryptoStatusMessage || "Something's not right in the foundation.";
  if (type.value === 'soft-trigger') return 'Reclaim your conversations from the ether.';
  return 'Your data belongs to you, not a boardroom. Secure it with a key.';
});

const actionLabel = computed(() => {
  if (type.value === 'degraded') return 'Repair';
  if (type.value === 'soft-trigger') return 'Verify';
  return 'Secure';
});

const showClose = computed(() => type.value === 'soft-trigger');

function handleAction() {
  if (type.value === 'degraded') {
    store.openVerificationModal();
  } else if (type.value === 'soft-trigger') {
    // Start verification request directly so other devices get notified
    store.requestVerification();
  } else {
    // Open bootstrap or a dedicated setup flow
    store.bootstrapVerification();
  }
}

function dismiss() {
  isDismissed.value = true;
}

// Reset dismissal if state changes
watch([() => store.isWaitingForRecoveryKey, () => store.needsRecoveryKeySetup], () => {
  isDismissed.value = false;
});
</script>
