<script setup lang="ts">
import type { MessageView } from "@tumult/core";

defineProps<{ message: MessageView }>();
</script>

<template>
    <p v-if="message.decryption === 'pending'" class="tumult-decrypt tumult-decrypt-pending">
        Waiting for keys — this message will appear when they arrive…
    </p>
    <p v-else class="tumult-decrypt tumult-decrypt-failed" role="alert">
        Unable to decrypt this message.
    </p>
</template>

<style scoped>
.tumult-decrypt {
    margin: 0;
    font-size: var(--text-sm);
    font-style: italic;
}
.tumult-decrypt-pending {
    color: var(--warning);
}
.tumult-decrypt-failed {
    color: var(--danger);
}
</style>
