<script setup lang="ts">
import type { SecurityStatus } from "@tumult/core";

defineProps<{ status: SecurityStatus }>();

defineEmits<{
    setup: [];
    restore: [];
}>();
</script>

<template>
    <!--
        Healthy devices render nothing. Fresh devices (backup this device
        can't open) prompt for the recovery key; accounts with no backup at
        all prompt for setup.
    -->
    <div
        v-if="!status.backupEnabled || !status.backupTrusted"
        class="tumult-security-banner"
        role="status"
    >
        <template v-if="!status.backupEnabled">
            <span>Message backup is off — set up recovery so a new device can read encrypted history.</span>
            <button type="button" class="tumult-security-action" @click="$emit('setup')">
                Set up recovery
            </button>
        </template>
        <template v-else>
            <span>This device can't open your message backup — encrypted history stays unreadable until then.</span>
            <button type="button" class="tumult-security-action" @click="$emit('restore')">
                Enter recovery key
            </button>
        </template>
    </div>
</template>

<style scoped>
.tumult-security-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--banner-reconnect-bg);
    color: #111214;
    font-size: var(--text-sm);
    font-weight: 600;
}
.tumult-security-action {
    padding: 2px var(--space-2);
    border: 1px solid currentColor;
    border-radius: var(--control-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
}
.tumult-security-action:hover {
    background: rgba(0, 0, 0, 0.08);
}
.tumult-security-action:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 1px;
}
</style>
