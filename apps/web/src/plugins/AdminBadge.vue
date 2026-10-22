<script setup lang="ts">
import { Icon } from "@tumult/ui";
import type { MemberView } from "@tumult/core";

/**
 * Reference member decoration: a crown next to room admins (power level ≥ 100).
 * Demonstrates the shape a badge plugin takes — the registry decides whether it
 * applies via `match`, the component only renders.
 */
defineProps<{
    member: MemberView;
    /** The row's room. Unused here, but part of every decoration's props. */
    roomId: string;
}>();
</script>

<template>
    <span
        class="tumult-admin-badge"
        role="img"
        :aria-label="`${member.displayName} is an admin`"
        :title="`${member.displayName} is an admin in this room`"
    >
        <Icon name="crown" />
    </span>
</template>

<style scoped>
.tumult-admin-badge {
    flex-shrink: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-none);
}
</style>
