<script setup lang="ts">
import { computed, ref } from "vue";

import Icon from "../icons/Icon.vue";
import BackupRecovery from "../security/BackupRecovery.vue";
import SasVerify from "../security/SasVerify.vue";
import { useSubscribable } from "../subscribable.ts";
import type { SettingsTabProps } from "./tabs.ts";

const props = defineProps<SettingsTabProps>();

// The same two flows the security modal offers, run in the page: `done` and
// `back` return here instead of closing anything. The modal stays for the
// urgent entries (the banner, an incoming request), which must not make the
// user dig through settings.
type Step = "overview" | "sas" | "backup";
const step = ref<Step>("overview");

const security = useSubscribable(props.client.security);
const creating = computed(() => security.value != null && !security.value.backupEnabled);

interface StatusRow {
    label: string;
    ok: boolean;
    detail: string;
}

// `null` is "not known yet" — rendered as such, never as a red "off".
const rows = computed<StatusRow[] | null>(() => {
    const status = security.value;
    if (!status?.checked) return null;
    return [
        {
            label: "Cross-signing",
            ok: status.crossSigningReady,
            detail: status.crossSigningReady
                ? "This device is part of your verified identity."
                : "This device is not verified yet.",
        },
        {
            label: "Key backup",
            ok: status.backupEnabled && status.backupTrusted,
            detail: !status.backupEnabled
                ? "No backup exists — encrypted history lives only on your devices."
                : status.backupTrusted
                  ? "This device can read and write your backup."
                  : "A backup exists, but this device cannot open it yet.",
        },
        {
            label: "Secret storage",
            ok: status.secretStorageReady,
            detail: status.secretStorageReady
                ? "Your recovery key unlocks your keys on a new device."
                : "Not set up.",
        },
    ];
});
</script>

<template>
    <template v-if="step === 'overview'">
        <section class="tumult-settings-section">
            <h3 class="tumult-settings-heading">Encryption</h3>
            <p v-if="rows === null" class="tumult-dialog-status" role="status">Checking…</p>
            <ul v-else class="tumult-security-rows">
                <li
                    v-for="row in rows"
                    :key="row.label"
                    class="tumult-security-row"
                    :data-ok="row.ok ? 'true' : undefined"
                >
                    <Icon :name="row.ok ? 'shield-check' : 'alert'" />
                    <span class="tumult-security-text">
                        <span class="tumult-security-label">{{ row.label }}</span>
                        <span class="tumult-security-detail">{{ row.detail }}</span>
                    </span>
                </li>
            </ul>
        </section>

        <section class="tumult-settings-section">
            <h3 class="tumult-settings-heading">Unlock this device</h3>
            <p class="tumult-settings-note">
                Prove this device is yours so it can read encrypted history.
            </p>
            <div class="tumult-security-options">
                <button type="button" class="tumult-security-option" @click="step = 'sas'">
                    <span class="tumult-security-label">Use another device</span>
                    <span class="tumult-security-detail">
                        Verify against a device you already trust by comparing emojis.
                    </span>
                </button>
                <button type="button" class="tumult-security-option" @click="step = 'backup'">
                    <span class="tumult-security-label">{{ creating ? "Set up backup" : "Enter recovery key" }}</span>
                    <span class="tumult-security-detail">
                        {{
                            creating
                                ? "Create a recovery key this account can restore from on a new device."
                                : "Unlock your backup with the recovery key you saved."
                        }}
                    </span>
                </button>
            </div>
        </section>
    </template>

    <section v-else-if="step === 'sas'" class="tumult-settings-section">
        <SasVerify :client="client" :active="true" @back="step = 'overview'" @done="step = 'overview'" />
    </section>

    <section v-else class="tumult-settings-section">
        <BackupRecovery :client="client" :active="true" @back="step = 'overview'" @done="step = 'overview'" />
    </section>
</template>

<style scoped>
.tumult-security-rows,
.tumult-security-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-security-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    color: var(--danger);
    font-size: var(--icon-md);
}
.tumult-security-row[data-ok] {
    color: var(--accent);
}
.tumult-security-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.tumult-security-label {
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
}
.tumult-security-detail {
    color: var(--text-secondary);
    font-size: var(--text-xs);
}
.tumult-security-option {
    display: flex;
    flex-direction: column;
    gap: var(--hairline);
    padding: var(--space-3);
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.tumult-security-option:hover {
    background: var(--button-secondary-bg-hover);
}
.tumult-security-option:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
</style>
