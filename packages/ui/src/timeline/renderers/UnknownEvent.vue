<script setup lang="ts">
import type { MessageView } from "@tumult/core";

defineProps<{ message: MessageView }>();
</script>

<template>
    <p class="tumult-unknown">
        Unsupported event <code>{{ message.type }}</code>
    </p>
</template>

<style scoped>
.tumult-unknown {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-style: italic;
}
.tumult-unknown code {
    font-family: var(--font-mono);
}
</style>
