<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import RoomDialog from "../rooms/RoomDialog.vue";
import type { MemberModeration } from "../actions.ts";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
    /** The set-power request being edited; null when closed. */
    action: MemberModeration | null;
}>();

const emit = defineEmits<{
    close: [];
}>();

const busy = ref(false);
const error = ref("");
const level = ref(0);

// Seed from the member's current level on every open (Reka unmounts the
// content, this script survives) and reset any stale busy/error state.
watch(
    [() => props.open, () => props.action?.member.userId] as const,
    () => {
        if (!props.open) {
            busy.value = false;
            error.value = "";
            return;
        }
        level.value = props.action?.member.powerLevel ?? 0;
    },
    { immediate: true },
);

const description = computed(
    () => `Set the power level for ${props.action?.member.displayName ?? "this member"}.`,
);

const valid = computed(() => Number.isInteger(level.value) && level.value >= 0 && level.value <= 100);

/** Clamp/patch the free-text number field so `valid` only ever sees integers. */
function clampInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    level.value = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function submit(): void {
    const action = props.action;
    if (busy.value || !action || !valid.value) return;
    busy.value = true;
    error.value = "";
    void props.client
        .setPowerLevel(action.roomId, action.member.userId, level.value)
        .then(() => emit("close"))
        .catch((cause: unknown) => {
            error.value = cause instanceof Error ? cause.message : String(cause);
        })
        .finally(() => {
            busy.value = false;
        });
}
</script>

<template>
    <RoomDialog
        :open="props.open"
        title="Change permissions"
        :description="description"
        submit-label="Save"
        :busy="busy"
        :error="error"
        :submit-disabled="!valid"
        @close="emit('close')"
        @submit="submit"
    >
        <div class="tumult-dialog-field">
            <span class="tumult-dialog-label">Preset</span>
            <div class="tumult-power-presets">
                <button
                    type="button"
                    class="tumult-dialog-button"
                    :aria-pressed="level === 0"
                    @click="level = 0"
                >
                    Member (0)
                </button>
                <button
                    type="button"
                    class="tumult-dialog-button"
                    :aria-pressed="level === 50"
                    @click="level = 50"
                >
                    Moderator (50)
                </button>
                <button
                    type="button"
                    class="tumult-dialog-button"
                    :aria-pressed="level === 100"
                    @click="level = 100"
                >
                    Admin (100)
                </button>
            </div>
        </div>
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-power-level">Power level (0–100)</label>
            <input
                id="tumult-power-level"
                class="tumult-dialog-input"
                type="number"
                min="0"
                max="100"
                step="1"
                :value="level"
                :disabled="busy"
                @input="clampInput"
            />
            <p class="tumult-dialog-hint">
                Presets are just shortcuts; any whole number from 0 to 100 works. 50 can moderate,
                100 can change this dialog's defaults.
            </p>
        </div>
    </RoomDialog>
</template>

<style scoped>
.tumult-power-presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.tumult-power-presets .tumult-dialog-button[aria-pressed="true"] {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
}
</style>
