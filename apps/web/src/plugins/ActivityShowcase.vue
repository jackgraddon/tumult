<script setup lang="ts">
import type { ActivityVariant } from "@tumult/ui";

/**
 * Reference activity renderer: one line of text from a `{ name }` field. The
 * registry already ran `match`, so `value` has the shape the plugin accepts.
 */
defineProps<{
    userId: string;
    value: unknown;
    variant: ActivityVariant;
}>();
</script>

<template>
    <span class="tumult-activity-showcase">{{ (value as { name: string }).name }}</span>
</template>
