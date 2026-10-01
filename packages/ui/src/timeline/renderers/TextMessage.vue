<script setup lang="ts">
import type { MessageView } from "@tumult/core";

defineProps<{ message: MessageView }>();
</script>

<template>
    <!-- body renders as interpolated text, never v-html: security boundary. -->
    <p class="tumult-text-message">{{ message.body }}</p>
</template>

<style scoped>
.tumult-text-message {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
</style>
