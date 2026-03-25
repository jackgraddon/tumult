<template>
  <div class="space-y-4">
    <h2 class="text-2xl font-semibold tracking-tight">General</h2>
    <div v-if="$isTauri" class="space-y-4">
      <h3 class="text-xl font-semibold tracking-tight">Backend</h3>

      <div class="flex items-center justify-between rounded-lg border p-4">
        <div class="flex items-center gap-3">
          <Icon name="solar:power-bold" class="h-5 w-5 text-muted-foreground" />
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Run at Startup</p>
            <p class="text-xs text-muted-foreground">
              Automatically start Tumult when you log in
            </p>
          </div>
        </div>
        <UiSwitch v-model="runAtStartup" />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-4">
        <div class="flex items-center gap-3">
          <Icon name="solar:minus-square-bold" class="h-5 w-5 text-muted-foreground" />
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Open Minimized</p>
            <p class="text-xs text-muted-foreground">
              Start the app hidden in the system tray
            </p>
          </div>
        </div>
        <UiSwitch v-model="startMinimized" />
      </div>

      <div class="flex items-center justify-between rounded-lg border p-4">
        <div class="flex items-center gap-3">
          <Icon name="solar:upload-minimalistic-bold" class="h-5 w-5 text-muted-foreground" />
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Updates</p>
            <p class="text-xs text-muted-foreground">
              Check for new versions of the application shell
            </p>
          </div>
        </div>
        <UiButton variant="outline" size="sm" @click="checkForUpdates" :disabled="isChecking">
          <Icon v-if="isChecking" name="svg-spinners:ring-resize" class="mr-2 h-4 w-4" />
          {{ isChecking ? 'Checking...' : 'Check for Updates' }}
        </UiButton>
      </div>

      <div v-if="updateInfo" class="rounded-lg border bg-accent/50 p-4 space-y-3">
          <div class="flex items-start justify-between">
              <div class="space-y-1">
                  <p class="text-sm font-semibold text-primary">New update available: v{{ updateInfo.version }}</p>
                  <p class="text-xs text-muted-foreground line-clamp-3">{{ updateInfo.body }}</p>
              </div>
          </div>
          <div class="flex gap-2">
            <UiButton size="sm" @click="installUpdate" :disabled="isInstalling">
                <Icon v-if="isInstalling" name="svg-spinners:ring-resize" class="mr-2 h-4 w-4" />
                {{ isInstalling ? 'Installing...' : 'Install & Restart' }}
            </UiButton>
            <UiButton variant="ghost" size="sm" @click="updateInfo = null" :disabled="isInstalling">
                Dismiss
            </UiButton>
          </div>
      </div>
      
      <div v-if="showUpToDateBanner" class="rounded-lg border bg-green-500/10 border-green-500/20 p-4">
        <p class="text-sm font-medium text-green-600 dark:text-green-400 flex items-center gap-2">
            <Icon name="solar:check-circle-bold" class="h-4 w-4" />
            You're on the latest version!
        </p>
      </div>
    </div>


    <!-- Activity Status (Desktop Only) -->
    <div class="space-y-4">
      <h3 class="text-xl font-semibold tracking-tight">Status</h3>

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
    </div>


    <div class="space-y-4">
      <h3 class="text-xl font-semibold tracking-tight">Rooms</h3>

      <div class="flex items-center justify-between rounded-lg border p-4">
        <div class="flex items-center gap-3">
          <Icon name="solar:ghost-bold" class="h-5 w-5 text-muted-foreground" />
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show Empty Rooms</p>
            <p class="text-xs text-muted-foreground">
              Display rooms where all other members have left
            </p>
          </div>
        </div>
        <UiSwitch v-model="showEmptyRoomsToggle" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  icon: 'solar:settings-bold',
  category: 'app',
  title: 'General',
  place: 1
})

const store = useMatrixStore();
const gameActivity = useGameActivity();

const gameDetectionLevel = computed({
  get: () => store.gameDetectionLevel,
  set: (val: any) => store.setGameDetectionLevel(val),
});

const showEmptyRoomsToggle = computed({
  get: () => store.ui.showEmptyRooms,
  set: () => store.toggleShowEmptyRooms(),
});

const runAtStartup = computed({
  get: () => store.runAtStartup,
  set: (val: boolean) => store.setRunAtStartup(val),
});

const startMinimized = computed({
  get: () => store.startMinimized,
  set: (val: boolean) => store.setStartMinimized(val),
});

const isChecking = ref(false);
const isInstalling = ref(false);
const updateInfo = shallowRef<any>(null);
const showUpToDateBanner = ref(false);

const checkForUpdates = async () => {
    if (isChecking.value) return;
    
    isChecking.value = true;
    updateInfo.value = null;
    showUpToDateBanner.value = false;

    try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        
        if (update?.available) {
            updateInfo.value = markRaw(update);
        } else {
            showUpToDateBanner.value = true;
            setTimeout(() => {
                showUpToDateBanner.value = false;
            }, 5000);
        }
    } catch (e) {
        console.error("Failed to check for updates:", e);
        // You could add a toast notification here if available
    } finally {
        isChecking.value = false;
    }
};

const installUpdate = async () => {
    if (!updateInfo.value || isInstalling.value) return;

    isInstalling.value = true;
    try {
        await updateInfo.value.downloadAndInstall();
        // The app will restart automatically if configured, 
        // or you might need to trigger it. Tauri 2 usually handles it.
    } catch (e) {
        console.error("Failed to install update:", e);
        isInstalling.value = false;
    }
};

onMounted(() => {
    window.addEventListener('tumult-check-updates', checkForUpdates);
});

onUnmounted(() => {
    window.removeEventListener('tumult-check-updates', checkForUpdates);
});

</script>

<style>

</style>