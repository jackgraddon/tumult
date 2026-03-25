<template>
  <div class="space-y-4">
    <h2 class="text-2xl font-semibold tracking-tight">Notifications</h2>

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
          <p class="text-sm font-medium">Enable Notifications</p>
          <p class="text-xs text-muted-foreground">
            Show desktop and background alerts for new messages
          </p>
        </div>
      </div>
      <UiSwitch v-model="pushEnabled" />
    </div>

    <div v-if="pushEnabled" class="space-y-4">
      <div v-if="!isTauri" class="rounded-lg border p-4 space-y-4">
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
</template>

<script lang="ts" setup>
import { toast } from 'vue-sonner';

definePageMeta({
  icon: 'solar:bell-bold',
  category: 'app',
  title: 'Notifications',
  place: 1.5
})

const { $isTauri: isTauri } = useNuxtApp();
const store = useMatrixStore();
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
</script>
