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

type Phase = "input" | "working" | "done" | "error";
const phase = ref<Phase>("input");
const pasted = ref("");
const error = ref("");
const verified = ref(false);

function onOpenChange(next: boolean): void {
    if (!next) emit("close");
}

watch(
    () => props.open,
    (isOpen) => {
        if (!isOpen) {
            phase.value = "input";
            pasted.value = "";
            error.value = "";
        }
    },
);

async function submit(): Promise<void> {
    const key = pasted.value.trim();
    if (!key || phase.value === "working") return;
    phase.value = "working";
    try {
        verified.value = await props.client.restoreBackup(key);
        phase.value = "done";
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        phase.value = "error";
    }
}
</script>

<template>
    <DialogRoot :open="open" @update:open="onOpenChange">
        <DialogPortal>
            <DialogOverlay class="tumult-dialog-overlay" />
            <DialogContent class="tumult-dialog" aria-describedby="recovery-restore-desc">
                <DialogTitle class="tumult-dialog-title">Enter recovery key</DialogTitle>
                <DialogDescription id="recovery-restore-desc" class="tumult-dialog-desc">
                    Paste the recovery key you saved on another device. Encrypted
                    history it unlocks will appear as keys arrive.
                </DialogDescription>

                <form v-if="phase === 'input' || phase === 'working' || phase === 'error'" @submit.prevent="submit">
                    <label class="tumult-field-label" for="tumult-recovery-input">Recovery key</label>
                    <input
                        id="tumult-recovery-input"
                        v-model="pasted"
                        class="tumult-field-input"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        :disabled="phase === 'working'"
                    />
                    <p v-if="phase === 'error'" class="tumult-dialog-error" role="alert">{{ error }}</p>
                    <div class="tumult-dialog-actions">
                        <button
                            type="submit"
                            class="tumult-dialog-button tumult-dialog-primary"
                            :disabled="phase === 'working' || pasted.trim().length === 0"
                        >
                            {{ phase === "working" ? "Unlocking…" : "Unlock backup" }}
                        </button>
                    </div>
                </form>

                <template v-if="phase === 'done'">
                    <p class="tumult-dialog-status" role="status">
                        <template v-if="verified">
                            Backup unlocked and this device is now verified — encrypted
                            history will decrypt as keys arrive.
                        </template>
                        <template v-else>
                            Backup unlocked — encrypted history will decrypt as keys arrive.
                        </template>
                    </p>
                    <div class="tumult-dialog-actions">
                        <DialogClose as-child>
                            <button type="button" class="tumult-dialog-button tumult-dialog-primary">Done</button>
                        </DialogClose>
                    </div>
                </template>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
.tumult-field-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
}
.tumult-field-input {
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
}
.tumult-field-input:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: -1px;
}
.tumult-dialog-status {
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-dialog-error {
    color: var(--danger);
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
.tumult-dialog-primary:hover:not(:disabled) {
    background: var(--button-primary-bg-hover);
}
.tumult-dialog-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
