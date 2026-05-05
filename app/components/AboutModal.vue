<template>
  <UiDialog v-model:open="uiStore.aboutModalOpen">
    <UiDialogContent class="sm:max-w-[425px]">
      <UiDialogHeader>
        <div class="flex flex-col items-center gap-4 py-4">
          <div class="relative group">
            <div class="absolute -inset-1 bg-gradient-to-r from-primary to-accent rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"/>
            <img src="~/assets/Flame.svg" class="relative size-20" alt="Tumult Logo" >
          </div>
          <div class="text-center space-y-1">
            <UiDialogTitle class="text-3xl font-black tracking-tighter">Tumult</UiDialogTitle>
            <UiDialogDescription class="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
              Version {{ version }} • Built {{ buildDate }}
            </UiDialogDescription>
          </div>
        </div>
      </UiDialogHeader>

      <div class="space-y-6">
        <p class="text-sm leading-relaxed text-center px-2">
          Tumult was born out of a desire for a better chat experience. Discord's recent direction has left many of us looking for an alternative that respects its users. Tumult is that alternative—built on the open Matrix protocol.
        </p>

        <div class="grid grid-cols-2 gap-3">
          <UiButton
            variant="outline"
            class="w-full gap-2 h-11"
            @click="openUrl('https://jackgraddon.com')"
          >
            <Icon name="solar:global-line-duotone" class="size-5 text-primary" />
            <div class="flex flex-col items-start leading-none gap-1">
              <span class="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Creator</span>
              <span class="text-sm font-semibold">Jack Graddon</span>
            </div>
          </UiButton>

          <UiButton
            variant="outline"
            class="w-full gap-2 h-11"
            @click="openUrl('https://github.com/jackgraddon/tumult')"
          >
            <Icon name="solar:code-2-bold-duotone" class="size-5 text-accent" />
            <div class="flex flex-col items-start leading-none gap-1">
              <span class="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Source</span>
              <span class="text-sm font-semibold">GitHub</span>
            </div>
          </UiButton>
        </div>

        <div class="flex flex-col gap-2">
          <UiButton variant="ghost" size="sm" class="w-full text-muted-foreground hover:text-foreground" @click="openLicenses">
            Licenses
          </UiButton>
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { useMatrixStore } from '~/stores/matrix';

const uiStore = useUIStore();
const config = useRuntimeConfig();
const buildDate = config.public.buildDate;

const version = ref('');
onMounted(async () => {
  if (import.meta.client && (window as any).__TAURI_INTERNALS__) {
    const { getVersion } = await import('@tauri-apps/api/app');
    version.value = await getVersion();
  } else {
    version.value = '999.999.999';
  }
});

const openUrl = async (url: string) => {
  if (import.meta.client && (window as any).__TAURI_INTERNALS__) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else {
    window.open(url, '_blank');
  }
};

const openLicenses = () => {
  openUrl('https://github.com/jackgraddon/tumult/blob/main/LICENSE');
};
</script>
