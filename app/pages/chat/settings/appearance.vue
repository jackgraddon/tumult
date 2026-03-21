<template>
  <div class="space-y-8">
    <div class="space-y-2">
      <h2 class="text-2xl font-bold tracking-tight text-primary">Appearance</h2>
      <p class="text-muted-foreground">Customize how Tumult looks and feels. Make yourself at home.</p>
    </div>

    <!-- Theme Modes -->
    <div class="space-y-4">
      <h3 class="text-lg font-semibold flex items-center gap-2">
        <Icon name="solar:sun-2-bold" class="size-5" />
        Interface Mode
      </h3>
      <div class="grid grid-cols-3 gap-4">
        <button 
          v-for="mode in modes" 
          :key="mode.id"
          @click="colorMode.preference = mode.id"
          class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all hover:border-primary/50 group"
          :class="colorMode.preference === mode.id ? 'border-primary bg-primary/5' : 'bg-card border-transparent hover:bg-muted/50'"
        >
          <div class="size-10 rounded-lg bg-muted flex items-center justify-center group-hover:scale-110 transition-transform">
            <Icon :name="mode.icon" class="size-6 text-muted-foreground" :class="{ 'text-primary': colorMode.preference === mode.id }" />
          </div>
          <span class="text-sm font-medium">{{ mode.label }}</span>
          <div v-if="mode.id === 'system'" class="text-[10px] text-muted-foreground mt-[-4px]">
             (currently {{ colorMode.value }})
          </div>
        </button>
      </div>
    </div>

    <!-- Theme Presets -->
    <div class="space-y-4 pt-4 border-t">
      <h3 class="text-lg font-semibold flex items-center gap-2">
        <Icon name="solar:palette-bold" class="size-5" />
        Color Palette
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
        <button 
          v-for="preset in presets" 
          :key="preset.id"
          @click="setTheme(preset.id)"
          class="flex items-center gap-3 p-3 rounded-xl border-2 transition-all hover:border-primary/50 group text-left"
          :class="store.ui.themePreset === preset.id ? 'border-primary bg-primary/5' : 'bg-card border-transparent hover:bg-muted/50'"
        >
          <div 
            class="size-8 rounded-full border-2 border-white/20 shadow-sm shrink-0"
            :style="{ backgroundColor: preset.color }"
          ></div>
          <span class="text-sm font-medium truncate">{{ preset.label }}</span>
        </button>
      </div>
    </div>

    <!-- Custom CSS -->
    <div class="space-y-4 pt-4 border-t">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold flex items-center gap-2">
          <Icon name="solar:code-bold" class="size-5" />
          Custom CSS
        </h3>
        <UiButton v-if="hasUnsavedCss" variant="ghost" size="sm" @click="resetCss" class="text-xs">
          Reset
        </UiButton>
      </div>
      <p class="text-sm text-muted-foreground italic">Advanced: Inject your own styles. Be careful, this can break things.</p>
      <div class="relative group">
        <UiTextarea 
          v-model="customCss"
          placeholder="/* example: .bg-primary { border: 2px solid gold !important; } */"
          rows="8"
          class="font-mono text-xs bg-muted/30 border-2 focus-visible:ring-primary/20"
          spellcheck="false"
        />
        <div class="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
           <UiButton size="sm" @click="saveCss" :disabled="!hasUnsavedCss">
             Apply
           </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  icon: 'solar:palette-bold',
  category: 'app',
  title: 'Appearance',
  place: 2
})

const store = useMatrixStore();
const colorMode = useColorMode();

const modes = [
  { id: 'system', label: 'System', icon: 'solar:monitor-bold' },
  { id: 'light', label: 'Light', icon: 'solar:sun-bold' },
  { id: 'dark', label: 'Dark', icon: 'solar:moon-bold' },
]

const presets = [
  { id: 'default', label: 'Tumult Teal', color: 'oklch(0.407 0.068 206.13)' },
  { id: 'forest', label: 'Deep Forest', color: 'oklch(0.6 0.15 145)' },
  { id: 'sunset', label: 'Solar Sunset', color: 'oklch(0.65 0.22 35)' },
  { id: 'midnight', label: 'Purple Midnight', color: 'oklch(0.5 0.12 250)' },
  { id: 'lava', label: 'Volcanic Lava', color: 'oklch(0.55 0.25 25)' },
  { id: 'crimson', label: 'Rebel Crimson', color: 'oklch(0.55 0.2 25)' },
]

const customCss = ref(store.ui.customCss || '');

const hasUnsavedCss = computed(() => customCss.value !== (store.ui.customCss || ''));

function setTheme(id: string) {
  store.setThemePreset(id);
}

async function saveCss() {
  await store.setCustomCss(customCss.value);
  toast.success('Custom CSS applied');
}

function resetCss() {
  customCss.value = store.ui.customCss || '';
}

onMounted(() => {
  // Sync state if it changed externally
  watch(() => store.ui.customCss, (val) => {
    if (val !== undefined) customCss.value = val;
  });
});
</script>
