<script setup lang="ts">
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuTrigger,
} from "reka-ui";
import type { SessionView } from "@tumult/core";

import Avatar from "../primitives/Avatar.vue";

defineProps<{
    session: SessionView | null;
}>();

const emit = defineEmits<{
    signOut: [];
}>();
</script>

<template>
    <DropdownMenuRoot>
        <DropdownMenuTrigger as-child>
            <button type="button" class="tumult-account" :aria-label="session ? `Account: ${session.userId}` : 'Account'">
                <Avatar :label="session?.userId ?? '?'" size="sm" />
            </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
            <DropdownMenuContent class="tumult-menu" side="top" align="start">
                <DropdownMenuItem class="tumult-menu-id" disabled :text-value="session?.userId ?? ''">
                    {{ session?.userId ?? "Signed out" }}
                </DropdownMenuItem>
                <DropdownMenuItem class="tumult-menu-item" text-value="sign out" @select="emit('signOut')">
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>

<style scoped>
.tumult-account {
    display: flex;
    padding: 4px;
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    cursor: pointer;
}
.tumult-account:hover {
    background: var(--rail-item-bg-hover);
}
.tumult-account:focus-visible {
    outline: 2px solid var(--focus-ring-color);
}
</style>

<style>
.tumult-menu {
    min-width: 200px;
    padding: 4px;
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    color: var(--text-primary);
}
.tumult-menu-id {
    padding: 6px 8px;
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
}
.tumult-menu-item {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    cursor: pointer;
    outline: none;
}
.tumult-menu-item[data-highlighted] {
    background: var(--roomlist-item-bg-hover);
}
</style>
