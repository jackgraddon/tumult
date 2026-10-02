<script setup lang="ts">
import { ref, watch } from "vue";
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

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
}>();

type Phase = "idle" | "working" | "ready" | "already" | "error";
const phase = ref<Phase>("idle");
const recoveryKey = ref("");
const error = ref("");
const copied = ref(false);

function onOpenChange(next: boolean): void {
    if (!next) emit("close");
}

watch(
    () => props.open,
    (isOpen) => {
        if (!isOpen) {
            // Never retain the key: it is shown once, then dropped.
            phase.value = "idle";
            recoveryKey.value = "";
            error.value = "";
            copied.value = false;
            return;
        }
        void runSetup();
    },
);

async function runSetup(): Promise<void> {
    phase.value = "working";
    try {
        const key = await props.client.setupRecovery();
        if (key === "") {
            phase.value = "already";
        } else {
            recoveryKey.value = key;
            phase.value = "ready";
        }
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        phase.value = "error";
    }
}

async function copyKey(): Promise<void> {
    try {
        await navigator.clipboard.writeText(recoveryKey.value);
        copied.value = true;
    } catch {
        // Clipboard API unavailable (permissions, insecure context): the key
        // is selectable text below, so copying can still be done by hand.
        copied.value = false;
    }
}
</script>

<template>
    <DialogRoot :open="open" @update:open="onOpenChange">
        <DialogPortal>
            <DialogOverlay class="tumult-dialog-overlay" />
            <DialogContent class="tumult-dialog" aria-describedby="recovery-setup-desc">
                <DialogTitle class="tumult-dialog-title">Set up recovery</DialogTitle>
                <DialogDescription id="recovery-setup-desc" class="tumult-dialog-desc">
                    Your recovery key unlocks encrypted history on new devices. Save it
                    somewhere safe — it is shown exactly once.
                </DialogDescription>

                <p v-if="phase === 'working' || phase === 'idle'" class="tumult-dialog-status" role="status">
                    Generating your recovery key…
                </p>
                <p v-if="phase === 'error'" class="tumult-dialog-error" role="alert">{{ error }}</p>
                <p v-if="phase === 'already'" class="tumult-dialog-status" role="status">
                    Recovery is already set up on this account — nothing new to save.
                </p>

                <template v-if="phase === 'ready'">
                    <code class="tumult-recovery-key">{{ recoveryKey }}</code>
                    <div class="tumult-dialog-actions">
                        <button type="button" class="tumult-dialog-button" @click="copyKey">
                            {{ copied ? "Copied" : "Copy" }}
                        </button>
                        <DialogClose as-child>
                            <button type="button" class="tumult-dialog-button tumult-dialog-primary">
                                I've saved it
                            </button>
                        </DialogClose>
                    </div>
                </template>

                <div v-if="phase === 'error' || phase === 'already'" class="tumult-dialog-actions">
                    <DialogClose as-child>
                        <button type="button" class="tumult-dialog-button tumult-dialog-primary">Close</button>
                    </DialogClose>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
.tumult-dialog-status {
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-dialog-error {
    color: var(--danger);
    font-size: var(--text-sm);
}
.tumult-recovery-key {
    display: block;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
    user-select: all;
}
.tumult-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
}
.tumult-dialog-button {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
}
.tumult-dialog-primary {
    border: none;
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: 600;
}
.tumult-dialog-primary:hover {
    background: var(--button-primary-bg-hover);
}
</style>

<style>
.tumult-dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
}
.tumult-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(28rem, calc(100vw - 2rem));
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    color: var(--text-primary);
}
.tumult-dialog:focus-visible {
    outline: 2px solid var(--focus-ring-color);
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
</style>
