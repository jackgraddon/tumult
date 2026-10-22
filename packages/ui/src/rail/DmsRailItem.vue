<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from "reka-ui";

import { useSelection } from "../selection.ts";
import UnreadBadge from "../primitives/UnreadBadge.vue";

defineProps<{ unread: number }>();

const selection = useSelection();
</script>

<template>
    <TooltipProvider :delay-duration="200">
        <TooltipRoot>
            <TooltipTrigger as-child>
                <li>
                    <a
                        class="tumult-dms-item"
                        :href="selection.hrefFor({ view: 'dms' })"
                        :aria-current="selection.current.view === 'dms' ? 'page' : undefined"
                        aria-label="Direct messages"
                        @click.prevent="selection.select({ view: 'dms' })"
                    >
                        <Icon name="message-text" />
                        <UnreadBadge class="tumult-dms-badge" :count="unread" />
                    </a>
                </li>
            </TooltipTrigger>
            <TooltipPortal>
                <TooltipContent class="tumult-tooltip" side="right">Direct messages</TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>

<style scoped>
.tumult-dms-item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--rail-item-size);
    height: var(--rail-item-size);
    margin: 0 auto;
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    color: var(--text-primary);
    font-size: var(--icon-md);
    text-decoration: none;
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-dms-item[aria-current="page"] {
    background: var(--rail-item-bg-active);
}
.tumult-dms-item:hover {
    background: var(--rail-item-bg-hover);
}
.tumult-dms-badge {
    position: absolute;
    right: var(--space-0-5);
    bottom: 0;
}
</style>
