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
        all prompt for setup. Nothing either, until the status is known: the
        placeholder before crypto starts reads as "no backup".
    -->
    <div
        v-if="status.checked && (!status.backupEnabled || !status.backupTrusted)"
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
    color: var(--text-on-warning);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
}
.tumult-security-action {
    padding: var(--space-0-5) var(--space-2);
    border: var(--border-width) solid currentColor;
    border-radius: var(--control-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
}
.tumult-security-action:hover {
    background: var(--banner-action-hover);
}
.tumult-security-action:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
</style>
