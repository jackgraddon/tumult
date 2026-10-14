<script setup lang="ts">
import { ref } from "vue";
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from "reka-ui";
import type { SpaceNode } from "@tumult/core";

import type { RoomSelection } from "../selection.ts";
import RoomListItem from "./RoomListItem.vue";
import UnreadBadge from "../primitives/UnreadBadge.vue";
import Avatar from "../primitives/Avatar.vue";

defineProps<{
    node: SpaceNode;
    selection: RoomSelection;
}>();

const open = ref(true);
</script>

<template>
    <!--
        The one recursive component. Reka Collapsible gives correct disclosure
        semantics, and its default unmountOnHide is a free memory win for large
        guilds. Re-entry nodes (node.truncated) render as a dead-end label.
    -->
    <li v-if="node.truncated" class="tumult-truncated" aria-label="Truncated">
        <span>⋯ {{ node.room.name }} (truncated)</span>
    </li>
    <CollapsibleRoot v-else v-model:open="open" class="tumult-category">
        <CollapsibleTrigger class="tumult-category-trigger">
            <span class="tumult-category-caret" :data-open="open ? 'true' : 'false'" aria-hidden="true">▸</span>
            <!-- Only when the space has an icon: an initials tile on every
                 category would be noise next to the caret. -->
            <Avatar v-if="node.room.avatarUrl" :src="node.room.avatarUrl" :label="node.room.name" size="xs" aria-hidden="true" />
            <span class="tumult-category-name">{{ node.room.name.toUpperCase() }}</span>
            <UnreadBadge :count="node.aggregateUnread" :highlight="node.aggregateHighlight > 0" />
        </CollapsibleTrigger>
        <CollapsibleContent class="tumult-category-content">
            <ul class="tumult-category-list">
                <RoomListItem v-for="room in node.rooms" :key="room.id" :room="room" :selection="selection" />
                <SpaceCategory
                    v-for="child in node.spaces"
                    :key="child.path.join('/')"
                    :node="child"
                    :selection="selection"
                />
            </ul>
        </CollapsibleContent>
    </CollapsibleRoot>
</template>

<style scoped>
.tumult-category {
    min-width: 0;
}
.tumult-category-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-1) var(--space-1);
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wide);
    cursor: pointer;
    min-width: 0;
}
.tumult-category-trigger:hover {
    color: var(--text-primary);
}
.tumult-category-trigger:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    border-radius: var(--radius-sm);
}
.tumult-category-caret {
    display: inline-block;
    transition: transform var(--motion-fast) var(--motion-ease);
    flex-shrink: 0;
}
.tumult-category-caret[data-open="true"] {
    transform: rotate(90deg);
}
.tumult-category-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
}
.tumult-category-content {
    overflow: hidden;
}
.tumult-category-content[data-state="closed"] {
    display: none;
}
.tumult-category-list {
    margin: 0;
    padding: 0 0 0 var(--space-2);
    list-style: none;
}
.tumult-truncated {
    padding: var(--space-0-5) var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-style: italic;
}
</style>
