<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { computed } from "vue";
import RailTile from "./RailTile.vue";
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
                    <RailTile
                        class="tumult-pane-item"
                        :label="pane.label"
                        :href="selection.hrefFor({ view: 'pane', paneId: pane.id })"
                        :active="isCurrent"
                        @click.prevent="selection.select({ view: 'pane', paneId: pane.id })"
                    >
                        <Icon v-if="pane.icon" :name="pane.icon" :fallback="initial" />
                        <template v-else>{{ initial }}</template>
                    </RailTile>
                </li>
            </TooltipTrigger>
            <TooltipPortal>
                <TooltipContent class="tumult-tooltip" side="right">{{ pane.label }}</TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
