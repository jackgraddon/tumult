<script setup lang="ts">
import type { ConnectionState } from "@tumult/core";

defineProps<{ connection: ConnectionState }>();
</script>

<template>
    <div
        v-if="connection === 'reconnecting' || connection === 'error'"
        class="tumult-banner"
        :data-kind="connection === 'error' ? 'error' : 'reconnect'"
        role="status"
    >
        {{ connection === "error" ? "Connection error — retrying…" : "Reconnecting…" }}
    </div>
</template>

<style scoped>
.tumult-banner {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    text-align: center;
    color: var(--banner-reconnect-text);
}
.tumult-banner[data-kind="error"] {
    background: var(--banner-error-bg);
    color: var(--banner-error-text);
}
.tumult-banner[data-kind="reconnect"] {
    background: var(--banner-reconnect-bg);
}
</style>
