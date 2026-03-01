<template>
  <div class="container overflow-y-scroll h-full m-auto py-6 space-y-8 max-w-2xl">
    <h1 class="text-3xl font-bold tracking-tight">Settings</h1>

    <NuxtPage />
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
    middleware: "auth",
});
</script>

<style scoped>

</style>