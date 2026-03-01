<template>
  <div class="flex items-center justify-between py-0.5">
    <span class="text-sm text-muted-foreground">{{ label }}</span>
    <div class="flex items-center gap-1.5">
      <template v-if="status === 'pending'">
        <div class="h-2 w-2 rounded-full bg-muted animate-pulse" />
        <span class="text-xs text-muted-foreground">—</span>
      </template>
      <template v-else-if="status === 'pass'">
        <Icon name="solar:check-circle-bold" class="h-4 w-4 text-green-500" />
        <span class="text-xs text-green-500">Pass</span>
      </template>
      <template v-else>
        <Icon name="solar:close-circle-bold" class="h-4 w-4 text-destructive" />
        <span class="text-xs text-destructive">Fail</span>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps<{
  label: string;
  status: 'pending' | 'pass' | 'fail';
}>();
</script>
