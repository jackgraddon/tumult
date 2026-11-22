<script setup lang="ts">
import { computed } from "vue";
import {
    DropdownMenuContent,
    DropdownMenuPortal,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuRoot,
    DropdownMenuTrigger,
} from "reka-ui";
import type { OrphanSort } from "@tumult/core/selectors";

import Icon from "../icons/Icon.vue";

/**
 * Sort control for the DM list. Presentational: the shell owns the chosen order
 * and passes it into `selectSpaceTree`, so the list, the default room and any
 * other consumer of the tree all agree on what "first" means.
 */
const props = defineProps<{
    modelValue: OrphanSort;
}>();

const emit = defineEmits<{
    "update:modelValue": [sort: OrphanSort];
}>();

const OPTIONS: ReadonlyArray<{ value: OrphanSort; label: string; short: string }> = [
    { value: "recency", label: "Most recent", short: "Recent" },
    { value: "name", label: "Name (A–Z)", short: "Name" },
    { value: "unread", label: "Unread first", short: "Unread" },
];

const current = computed(() => OPTIONS.find((option) => option.value === props.modelValue) ?? OPTIONS[0]);

function choose(value: unknown): void {
    const option = OPTIONS.find((entry) => entry.value === value);
    if (option) emit("update:modelValue", option.value);
}
</script>

<template>
    <DropdownMenuRoot>
        <DropdownMenuTrigger as-child>
            <button
                type="button"
                class="tumult-dm-sort"
                :aria-label="`Sort direct messages: ${current?.label ?? 'Most recent'}`"
                :title="`Sort direct messages: ${current?.label ?? 'Most recent'}`"
            >
                <span>{{ current?.short ?? "Recent" }}</span>
                <Icon name="chevron-down" />
            </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
            <DropdownMenuContent class="tumult-menu" side="bottom" align="end">
                <DropdownMenuRadioGroup :model-value="modelValue" @update:model-value="choose">
                    <DropdownMenuRadioItem
                        v-for="option in OPTIONS"
                        :key="option.value"
                        class="tumult-menu-item"
                        :value="option.value"
                    >
                        {{ option.label }}
                    </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>

<style scoped>
.tumult-dm-sort {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-px) var(--space-1);
    border: var(--border-width) solid transparent;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
}
.tumult-dm-sort:hover {
    border-color: var(--border-default);
    color: var(--text-primary);
}
.tumult-dm-sort:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
.tumult-menu-item[data-state="checked"] {
    color: var(--accent);
    font-weight: var(--weight-semibold);
}
</style>
