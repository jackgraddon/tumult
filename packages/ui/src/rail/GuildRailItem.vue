<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from "reka-ui";

import { useSelection } from "../selection.ts";
import Avatar from "../primitives/Avatar.vue";
import UnreadBadge from "../primitives/UnreadBadge.vue";

defineProps<{
    guildId: string;
    name: string;
    avatarUrl?: string | null;
    unread: number;
    highlight: number;
}>();

const selection = useSelection();
</script>

<template>
    <!-- At 72px the tooltip IS the accessible name. -->
    <TooltipProvider :delay-duration="200">
        <TooltipRoot>
            <TooltipTrigger as-child>
                <li>
                    <a
                        class="tumult-guild-item"
                        :href="selection.hrefFor({ view: 'guild', guildId })"
                        :aria-current="
                            selection.current.view === 'guild' && selection.current.guildId === guildId
                                ? 'page'
                                : undefined
                        "
                        :aria-label="`${name}${unread > 0 ? `, ${unread} unread` : ''}`"
                        @click.prevent="selection.select({ view: 'guild', guildId })"
                    >
                        <span
                            class="tumult-guild-pill"
                            :data-active="
                                selection.current.view === 'guild' && selection.current.guildId === guildId
                            "
                        />
                        <Avatar :label="name" :src="avatarUrl ?? undefined" size="lg" />
                        <UnreadBadge class="tumult-guild-badge" :count="unread" :highlight="highlight > 0" />
                    </a>
                </li>
            </TooltipTrigger>
            <TooltipPortal>
                <TooltipContent class="tumult-tooltip" side="right">{{ name }}</TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>

<style scoped>
.tumult-guild-item {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 4px 0;
    border-radius: var(--control-radius);
}
.tumult-guild-item:hover {
    background: var(--rail-item-bg-hover);
}
.tumult-guild-pill {
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 4px;
    border-radius: 0 4px 4px 0;
    background: transparent;
}
.tumult-guild-pill[data-active="true"] {
    background: var(--rail-indicator);
}
.tumult-guild-badge {
    position: absolute;
    right: 6px;
    bottom: 2px;
}
</style>

<style>
.tumult-tooltip {
    padding: 4px 8px;
    border-radius: var(--control-radius);
    background: var(--surface-active);
    color: var(--text-primary);
    font-size: var(--text-sm);
}
</style>
