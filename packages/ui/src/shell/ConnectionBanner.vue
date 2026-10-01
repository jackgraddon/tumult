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
    font-weight: 600;
    text-align: center;
    color: #111214;
}
.tumult-banner[data-kind="error"] {
    background: var(--banner-error-bg);
    color: #fff;
}
.tumult-banner[data-kind="reconnect"] {
    background: var(--banner-reconnect-bg);
}
</style>
