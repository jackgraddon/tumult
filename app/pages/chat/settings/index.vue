<template>
  <div class="space-y-4">
    <h2 class="text-2xl font-semibold tracking-tight">General</h2>

    <div class="flex items-center gap-2">
      <ColorModeToggle />
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

const showEmptyRoomsToggle = computed({
  get: () => store.ui.showEmptyRooms,
  set: () => store.toggleShowEmptyRooms(),
});

</script>

<style>

</style>