<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { computed } from "vue";
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from "reka-ui";

import { useSelection } from "../selection.ts";
import type { WorkspacePane } from "../panes/registry.ts";

const props = defineProps<{
    pane: WorkspacePane;
}>();

const selection = useSelection();

const isCurrent = computed(
    () => selection.current.view === "pane" && selection.current.paneId === props.pane.id,
);

// A pane names its icon; without one (or when the name resolves to nothing),
// the label's first letter is the honest fallback.
const initial = computed(() => props.pane.label.trim().charAt(0) || "?");
</script>

<template>
    <TooltipProvider :delay-duration="200">
        <TooltipRoot>
            <TooltipTrigger as-child>
                <li>
                    <a
                        class="tumult-pane-item"
                        :href="selection.hrefFor({ view: 'pane', paneId: pane.id })"
                        :aria-current="isCurrent ? 'page' : undefined"
                        :aria-label="pane.label"
                        @click.prevent="selection.select({ view: 'pane', paneId: pane.id })"
                    >
                        <span class="tumult-pane-glyph" aria-hidden="true">
                            <Icon v-if="pane.icon" :name="pane.icon" :fallback="initial" />
                            <template v-else>{{ initial }}</template>
                        </span>
                    </a>
                </li>
            </TooltipTrigger>
            <TooltipPortal>
                <TooltipContent class="tumult-tooltip" side="right">{{ pane.label }}</TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>

<style scoped>
.tumult-pane-item {
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
    line-height: var(--leading-none);
    text-decoration: none;
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-pane-item[aria-current="page"] {
    background: var(--rail-item-bg-active);
}
.tumult-pane-item:hover {
    background: var(--rail-item-bg-hover);
}
.tumult-pane-glyph {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-weight: var(--weight-semibold);
}
</style>
