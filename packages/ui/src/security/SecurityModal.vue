<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
} from "reka-ui";
import type { ChatClient } from "@tumult/core";
import { useSubscribable } from "../subscribable.ts";
import SasVerify from "./SasVerify.vue";
import BackupRecovery from "./BackupRecovery.vue";

type Step = "landing" | "sas" | "backup";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
    /**
     * Where to open: a caller that already knows its intent can skip the
     * chooser (e.g. an incoming request jumps straight to the SAS flow).
     */
    initial?: Step;
}>();

const emit = defineEmits<{
    close: [];
}>();

// The active step of the one flow. On the way IN, the chosen `initial` seeds it;
// on the way OUT it resets so the next open is a fresh chooser.
const step = ref<Step>(props.initial ?? "landing");

const security = useSubscribable(props.client.security);
const creating = computed(() => security.value != null && !security.value.backupEnabled);

function onOpenChange(next: boolean): void {
    if (!next) emit("close");
}

watch(
    () => props.open,
    (isOpen) => {
        // Content unmounts on close, so every sub-flow ref is reset on the way
        // in — a fresh chooser each time.
        if (isOpen) {
            step.value = props.initial ?? "landing";
        } else {
            step.value = "landing";
        }
    },
    { immediate: true },
);

function chooseSas(): void {
    step.value = "sas";
}

function chooseBackup(): void {
    step.value = "backup";
}

function backToLanding(): void {
    step.value = "landing";
}
</script>

<template>
    <DialogRoot :open="open" @update:open="onOpenChange">
        <DialogPortal>
            <DialogOverlay class="tumult-dialog-overlay" />
            <DialogContent class="tumult-dialog tumult-security-modal" :class="step">
                <!-- Landing: the single entry that branches. -->
                <template v-if="step === 'landing'">
                    <DialogTitle class="tumult-dialog-title">How do you want to unlock this device?</DialogTitle>
                    <DialogDescription class="tumult-dialog-desc">
                        Pick how this device proves it's yours and reads encrypted history.
                    </DialogDescription>
                    <div class="tumult-landing-options">
                        <button type="button" class="tumult-landing-option" @click="chooseSas">
                            <span class="tumult-landing-title">Use another device</span>
                            <span class="tumult-landing-sub">
                                Verify against a device you already trust by comparing emojis.
                            </span>
                        </button>
                        <button type="button" class="tumult-landing-option" @click="chooseBackup">
                            <span class="tumult-landing-title">Enter backup</span>
                            <span class="tumult-landing-sub">
                                {{
                                    creating
                                        ? "Create a recovery key this account can restore from on a new device."
                                        : "Unlock your backup with the recovery key you saved."
                                }}
                            </span>
                        </button>
                    </div>
                    <div class="tumult-dialog-actions">
                        <DialogClose as-child>
                            <button type="button" class="tumult-dialog-button">Cancel</button>
                        </DialogClose>
                    </div>
                </template>

                <!-- "Use another device": the SAS sub-flow drives its own actions. -->
                <template v-else-if="step === 'sas'">
                    <SasVerify :client="client" :active="true" @back="backToLanding" @done="emit('close')" />
                </template>

                <!-- "Enter backup": create a key or enter one, picked by status. -->
                <template v-else>
                    <BackupRecovery :client="client" :active="true" @back="backToLanding" @done="emit('close')" />
                </template>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
.tumult-security-modal {
    --width: min(var(--dialog-width), calc(100vw - var(--dialog-gutter)));
}
.tumult-landing-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-3) 0;
}
.tumult-landing-option {
    display: flex;
    flex-direction: column;
    gap: calc(var(--space-1) * 0.5);
    padding: var(--space-3);
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    text-align: left;
    font: inherit;
    cursor: pointer;
}
.tumult-landing-option:hover {
    background: var(--button-secondary-bg-hover);
}
.tumult-landing-title {
    font-weight: var(--weight-semibold);
    font-size: var(--text-sm);
}
.tumult-landing-sub {
    color: var(--text-secondary);
    font-size: var(--text-xs, var(--text-sm));
}
.tumult-dialog-overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay-bg);
}
.tumult-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: var(--width);
    padding: var(--space-4);
    border: var(--border-width) solid var(--dialog-border);
    border-radius: var(--control-radius);
    background: var(--dialog-bg);
    color: var(--text-primary);
}
.tumult-dialog:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
.tumult-dialog-title {
    margin: 0 0 var(--space-1);
    font-size: var(--text-md);
}
.tumult-dialog-desc {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-dialog-actions {
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
</style>