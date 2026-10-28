<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSubscribable } from "../subscribable.ts";
import type { ChatClient } from "@tumult/core";

const props = defineProps<{
    client: ChatClient;
    active: boolean;
}>();

const emit = defineEmits<{
    /** Return to the landing chooser. */
    back: [];
    /** The flow is finished; the host decides what that closes. */
    done: [];
}>();

// The "enter backup" path sub-branches on whether a backup exists yet:
// a fresh account has none, so it can only *create* one; an existing account
// has one, so it can only *enter* it.
const security = useSubscribable(props.client.security);
const creating = computed(() => !security.value.backupEnabled);

// --- Enter-recovery-key sub-flow (restore). ---
const pasted = ref("");
const restoring = ref(false);
const restored = ref(false);
const restoreVerified = ref(false);
const restoreError = ref("");

// --- Create-recovery sub-flow (setup). ---
const setupKey = ref("");
const copied = ref(false);
const setupStage = ref<"working" | "ready" | "already" | "error">("working");

watch(
    () => props.active,
    (isActive) => {
        if (!isActive) {
            pasted.value = "";
            restoring.value = false;
            restored.value = false;
            restoreVerified.value = false;
            restoreError.value = "";
            setupKey.value = "";
            copied.value = false;
            setupStage.value = "working";
            return;
        }
        if (creating.value) void runSetup();
    },
    { immediate: true },
);

// Enter-key flow.
async function restore(): Promise<void> {
    const key = pasted.value.trim();
    if (!key || restoring.value) return;
    restoring.value = true;
    try {
        restoreVerified.value = await props.client.restoreBackup(key);
        restored.value = true;
    } catch (cause) {
        restoreError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
        restoring.value = false;
    }
}

// Create-key flow.
async function runSetup(): Promise<void> {
    setupStage.value = "working";
    try {
        const key = await props.client.setupRecovery();
        if (key === "") {
            setupStage.value = "already";
        } else {
            setupKey.value = key;
            setupStage.value = "ready";
        }
    } catch (cause) {
        restoreError.value = cause instanceof Error ? cause.message : String(cause);
        setupStage.value = "error";
    }
}

async function copyKey(): Promise<void> {
    try {
        await navigator.clipboard.writeText(setupKey.value);
        copied.value = true;
    } catch {
        // Clipboard API unavailable (permissions, insecure context): the key is
        // selectable text below, so copying can still be done by hand.
        copied.value = false;
    }
}
</script>

<template>
    <!-- Enter a recovery key that exists on the server. -->
    <template v-if="!creating">
        <h3 class="tumult-backup-title">Enter recovery key</h3>
        <p class="tumult-dialog-desc">
            Paste the recovery key you saved on another device. Encrypted history it
            unlocks will appear as keys arrive.
        </p>

        <form
            v-if="!restored"
            class="tumult-backup-form"
            @submit.prevent="restore"
        >
            <label class="tumult-field-label" for="tumult-recovery-input">Recovery key</label>
            <input
                id="tumult-recovery-input"
                v-model="pasted"
                class="tumult-field-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                :disabled="restoring"
            />
            <p v-if="restoreError" class="tumult-dialog-error" role="alert">{{ restoreError }}</p>
            <button
                type="submit"
                class="tumult-dialog-button tumult-dialog-primary"
                :disabled="restoring || pasted.trim().length === 0"
            >
                {{ restoring ? "Unlocking…" : "Unlock backup" }}
            </button>
        </form>

        <template v-else>
            <p class="tumult-dialog-status" role="status">
                <template v-if="restoreVerified">
                    Backup unlocked and this device is now verified — encrypted history
                    will decrypt as keys arrive.
                </template>
                <template v-else>
                    Backup unlocked — encrypted history will decrypt as keys arrive.
                </template>
            </p>
        </template>
    </template>

    <!-- No backup on the server yet: create one and hand the key out. -->
    <template v-else>
        <h3 class="tumult-backup-title">Set up recovery</h3>
        <p class="tumult-dialog-desc">
            Your recovery key unlocks encrypted history on new devices. Save it
            somewhere safe — it is shown exactly once.
        </p>

        <p v-if="setupStage === 'working'" class="tumult-dialog-status" role="status">
            Generating your recovery key…
        </p>
        <p v-if="setupStage === 'error'" class="tumult-dialog-error" role="alert">
            {{ restoreError }}
        </p>
        <p v-if="setupStage === 'already'" class="tumult-dialog-status" role="status">
            Recovery is already set up on this account — nothing new to save.
        </p>

        <template v-if="setupStage === 'ready'">
            <code class="tumult-recovery-key">{{ setupKey }}</code>
            <div class="tumult-backup-rows">
                <button type="button" class="tumult-dialog-button" @click="copyKey">
                    {{ copied ? "Copied" : "Copy" }}
                </button>
            </div>
        </template>
    </template>

    <div class="tumult-dialog-actions">
        <button type="button" class="tumult-dialog-button" @click="emit('back')">Back</button>
        <template v-if="!creating && restored">
            <button type="button" class="tumult-dialog-button tumult-dialog-primary" @click="emit('done')">Done</button>
        </template>
        <template v-else-if="creating && setupStage === 'ready'">
            <button type="button" class="tumult-dialog-button tumult-dialog-primary" @click="emit('done')">I've saved it</button>
        </template>
        <template v-else-if="creating && setupStage === 'already'">
            <button type="button" class="tumult-dialog-button tumult-dialog-primary" @click="emit('done')">Done</button>
        </template>
        <template v-else>
            <button
                type="button"
                class="tumult-dialog-button tumult-dialog-primary"
                :disabled="creating && (setupStage === 'working' || setupStage === 'error')"
                @click="emit('done')"
            >
                Close
            </button>
        </template>
    </div>
</template>

<style scoped>
.tumult-backup-title {
    margin: 0 0 var(--space-1);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    text-align: center;
}
.tumult-dialog-desc {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: center;
}
.tumult-field-label {
    position: absolute;
    width: var(--hairline);
    height: var(--hairline);
    overflow: hidden;
    clip: rect(0 0 0 0);
}
.tumult-field-input {
    display: block;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
}
.tumult-field-input:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: calc(var(--hairline) * -1);
}
.tumult-dialog-error {
    color: var(--danger);
    text-align: center;
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
}
.tumult-dialog-status {
    color: var(--text-muted);
    text-align: center;
    margin: var(--space-2) 0;
    font-size: var(--text-sm);
}
.tumult-recovery-key {
    display: block;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
    user-select: all;
}
.tumult-backup-rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
}
.tumult-dialog-button {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
}
.tumult-dialog-button:hover:not(:disabled) {
    background: var(--button-secondary-bg-hover);
}
.tumult-dialog-primary {
    border: none;
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: var(--weight-semibold);
}
.tumult-dialog-primary:hover:not(:disabled) {
    background: var(--button-primary-bg-hover);
}
.tumult-dialog-button:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: not-allowed;
}
.tumult-dialog-primary:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: not-allowed;
}
</style>