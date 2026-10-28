<script setup lang="ts">
// A row of mutually exclusive options drawn as one segmented control. Native
// radios underneath, so arrow keys, form semantics and screen readers behave
// like any radio group; only the visual is custom.
defineProps<{
    /** Radio group name — also the hook tests and labels address it by. */
    name: string;
    /** Group label, read before the options. */
    label: string;
    options: { value: string; label: string }[];
    modelValue: string;
}>();

const emit = defineEmits<{
    "update:modelValue": [value: string];
}>();
</script>

<template>
    <div class="tumult-segmented" role="radiogroup" :aria-label="label">
        <label v-for="option in options" :key="option.value" class="tumult-segment">
            <input
                class="tumult-segment-input"
                type="radio"
                :name="name"
                :value="option.value"
                :checked="option.value === modelValue"
                @change="emit('update:modelValue', option.value)"
            />
            <span class="tumult-segment-label">{{ option.label }}</span>
        </label>
    </div>
</template>

<style scoped>
.tumult-segmented {
    display: inline-flex;
    align-self: flex-start;
    flex-wrap: wrap;
    gap: var(--hairline);
    padding: var(--hairline);
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
}
.tumult-segment {
    position: relative;
    border-radius: var(--control-radius);
    cursor: pointer;
}
/* Visually hidden but focusable: the label is the control you see. */
.tumult-segment-input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
}
.tumult-segment-label {
    display: block;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--control-radius);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-transform: capitalize;
    transition:
        background-color var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease);
}
.tumult-segment:hover .tumult-segment-label {
    color: var(--text-primary);
}
.tumult-segment-input:checked + .tumult-segment-label {
    background: var(--settings-nav-item-bg-active);
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
}
.tumult-segment-input:focus-visible + .tumult-segment-label {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
</style>
