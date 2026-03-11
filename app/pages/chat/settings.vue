<template>
  <div class="overflow-y-scroll h-full w-full py-6 space-y-8">
    <div class="m-auto max-w-2xl">
      <h1 class="text-3xl font-bold tracking-tight">Settings</h1>
      <hr class="my-2">
      <NuxtPage />
    </div>
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
    middleware: "auth",
});
</script>

<style scoped>

</style>