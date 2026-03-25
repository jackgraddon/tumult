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


    <!-- Notifications (2026 Standards) -->
    <div class="space-y-4">
      <h3 class="text-xl font-semibold tracking-tight">Notifications</h3>

      <!-- EU/DMA Fallback Notice -->
      <div v-if="region.isEU.value && !isTauri" class="rounded-lg border bg-amber-500/10 border-amber-500/20 p-4 space-y-2">
        <div class="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <Icon name="solar:shield-warning-bold" class="h-5 w-5" />
            <p class="text-sm font-medium">Limited Support in your Region</p>
        </div>
        <p class="text-xs text-muted-foreground leading-relaxed">
            Due to regional regulations (DMA), standard push notifications may be restricted on this platform.
            Consider using a <strong>custom notification server</strong> (like ntfy) to maintain background alerts.
        </p>
      </div>

      <div class="flex items-center justify-between rounded-lg border p-4">
        <div class="flex items-center gap-3">
          <Icon name="solar:bell-bold" class="h-5 w-5 text-muted-foreground" />
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Push Notifications</p>
            <p class="text-xs text-muted-foreground">
              Enable background alerts when the app is closed
            </p>
          </div>
        </div>
        <UiSwitch v-model="pushEnabled" />
      </div>

      <div v-if="pushEnabled" class="space-y-4">
        <div class="rounded-lg border p-4 space-y-4">
            <div class="flex items-center gap-3">
                <Icon name="solar:server-bold" class="h-5 w-5 text-muted-foreground" />
                <div class="space-y-0.5">
                    <p class="text-sm font-medium">Custom Notification Server</p>
                    <p class="text-xs text-muted-foreground">
                        Use a private relay (e.g. ntfy) instead of the default Tumult relay
                    </p>
                </div>
            </div>
            <UiInput
                v-model="customPushEndpoint"
                placeholder="https://ntfy.sh/your-topic"
                class="text-xs"
            />
        </div>

        <div class="rounded-lg border p-4 space-y-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <Icon name="solar:moon-bold" class="h-5 w-5 text-muted-foreground" />
                    <div class="space-y-0.5">
                        <p class="text-sm font-medium">Quiet Hours / Pause</p>
                        <p class="text-xs text-muted-foreground">
                            Temporarily silence all background notifications
                        </p>
                    </div>
                </div>
            </div>
            <div class="flex gap-2">
                <UiButton
                    v-for="time in pauseOptions"
                    :key="time.label"
                    variant="outline"
                    size="sm"
                    class="text-[10px] h-7"
                    @click="pauseNotifications(time.value)"
                >
                    {{ time.label }}
                </UiButton>
            </div>
        </div>
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
const region = useRegionDetection();

const pushEnabled = computed({
    get: () => store.pushNotificationsEnabled,
    set: (val: boolean) => store.setPushNotificationsEnabled(val),
});

const customPushEndpoint = computed({
    get: () => store.customPushEndpoint || '',
    set: (val: string) => store.setCustomPushEndpoint(val || null),
});

const pauseOptions = [
    { label: '1 Hour', value: 60 },
    { label: '8 Hours', value: 480 },
    { label: 'Until Tomorrow', value: 1440 },
];

const pauseNotifications = (minutes: number) => {
    const until = Date.now() + (minutes * 60 * 1000);
    store.setNotificationsQuietUntil(until);
    toast.info(`Notifications paused until ${new Date(until).toLocaleTimeString()}`);
};

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