<script setup lang="ts">
import {
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
} from "reka-ui";

const props = defineProps<{
    open: boolean;
    title: string;
    description: string;
    error?: string | undefined;
    busy?: boolean | undefined;
    submitLabel: string;
    submitDisabled?: boolean | undefined;
    danger?: boolean | undefined;
}>();

const emit = defineEmits<{
    close: [];
    submit: [];
}>();

function onOpenChange(next: boolean): void {
    if (!next) emit("close");
}
</script>

<template>
    <DialogRoot :open="props.open" @update:open="onOpenChange">
        <DialogPortal>
            <DialogOverlay class="tumult-dialog-overlay" />
            <DialogContent class="tumult-dialog">
                <DialogTitle class="tumult-dialog-title">{{ props.title }}</DialogTitle>
                <DialogDescription class="tumult-dialog-desc">
                    {{ props.description }}
                </DialogDescription>
                <form class="tumult-dialog-form" novalidate @submit.prevent="emit('submit')">
                    <slot />
                    <p v-if="props.error" class="tumult-dialog-error" role="alert">{{ props.error }}</p>
                    <p v-else-if="props.busy" class="tumult-dialog-status" role="status">Working…</p>
                    <div class="tumult-dialog-actions">
                        <button
                            type="button"
                            class="tumult-dialog-button"
                            :disabled="props.busy"
                            @click="emit('close')"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            class="tumult-dialog-button"
                            :class="props.danger ? 'tumult-dialog-danger' : 'tumult-dialog-primary'"
                            :disabled="props.busy || props.submitDisabled"
                        >
                            {{ props.submitLabel }}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style>
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
    width: min(var(--dialog-width), calc(100vw - var(--dialog-gutter)));
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
.tumult-dialog-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.tumult-dialog-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    border: none;
}
.tumult-dialog-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--text-secondary);
}
.tumult-dialog-input,
.tumult-dialog-textarea {
    width: 100%;
    padding: var(--space-2);
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-dialog-textarea {
    min-height: var(--input-textarea-min-height);
    resize: vertical;
}
.tumult-dialog-input:focus-visible,
.tumult-dialog-textarea:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
.tumult-dialog-input::placeholder,
.tumult-dialog-textarea::placeholder {
    color: var(--input-placeholder);
}
/* Native checkbox / radio: `accent-color` hands their fill to the theme instead
   of the UA's own blue, while keeping native hit-testing, focus and keyboard
   behaviour — unlike a hand-rolled control. */
input[type="checkbox"],
input[type="radio"] {
    accent-color: var(--accent);
}
.tumult-dialog-group {
    display: block;
    margin: 0;
    padding: 0;
    border: none;
}
.tumult-dialog-group .tumult-dialog-label {
    display: block;
    margin-bottom: var(--space-1);
}
.tumult-dialog-group .tumult-dialog-radio + .tumult-dialog-radio {
    margin-top: var(--space-1);
}
.tumult-dialog-check,
.tumult-dialog-radio {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-primary);
    cursor: pointer;
}
.tumult-dialog-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}
.tumult-dialog-actions {
    display: flex;
    /* Whole controls flow to the next line rather than a label breaking mid-word
       (the file picker is wide enough to squeeze the buttons beside it). */
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
}
.tumult-dialog-button {
    flex-shrink: 0;
    white-space: nowrap;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
        background-color var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease);
}
.tumult-dialog-button:disabled {
    opacity: var(--state-disabled-opacity);
    cursor: default;
}
.tumult-dialog-primary {
    border: none;
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: var(--weight-semibold);
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-dialog-primary:hover:not(:disabled) {
    background: var(--button-primary-bg-hover);
}
.tumult-dialog-danger {
    border: none;
    background: var(--button-danger-bg);
    color: var(--button-danger-text);
    font-weight: var(--weight-semibold);
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-dialog-danger:hover:not(:disabled) {
    background: var(--button-danger-bg-hover);
}
.tumult-dialog-error {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
}
.tumult-dialog-status {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
