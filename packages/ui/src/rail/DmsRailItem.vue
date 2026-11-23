<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from "reka-ui";
import RailTile from "./RailTile.vue";

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
                    <RailTile
                        class="tumult-dms-item"
                        label="Direct messages"
                        :href="selection.hrefFor({ view: 'dms' })"
                        :active="selection.current.view === 'dms'"
                        @click.prevent="selection.select({ view: 'dms' })"
                    >
                        <Icon name="message-text" />
                        <UnreadBadge class="tumult-dms-badge" :count="unread" />
                    </RailTile>
                </li>
            </TooltipTrigger>
            <TooltipPortal>
                <TooltipContent class="tumult-tooltip" side="right">Direct messages</TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>

<style scoped>
.tumult-dms-badge {
    position: absolute;
    right: var(--space-0-5);
    bottom: 0;
}
</style>
