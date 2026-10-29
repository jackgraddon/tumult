<script setup lang="ts">
import { computed } from "vue";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from "reka-ui";

import Icon from "../icons/Icon.vue";
import IconButton from "../primitives/IconButton.vue";

/**
 * The room header's one call control: a phone button that does the default
 * thing, and an arrow that chooses between voice and video. Native voice is the
 * only thing it offers when the host enabled it; the embedded call app is the
 * fallback for a deployment without it, offered under the same two names so the
 * menu never lists two ways of doing the same thing. Presentational: the shell
 * decides what each choice does.
 */
const props = defineProps<{
    /** Native voice and video are available (`supportsVoice()`). */
    voice: boolean;
    /** The embedded call app is available AND no call is running in this room. */
    calls: boolean;
    /** This window is in this room's native voice session. */
    active: boolean;
}>();

const emit = defineEmits<{
    join: [video: boolean];
    leave: [];
}>();

/** Native when we have it; otherwise the embed, which is only the fallback. */
const available = computed(() => props.voice || props.calls);

const label = computed(() => (props.active ? "Leave call" : "Start voice call"));

function primary(): void {
    if (props.active) emit("leave");
    else emit("join", false);
}
</script>

<template>
    <div v-if="available" class="tumult-callmenu">
        <button
            type="button"
            class="tumult-callmenu-main"
            :aria-label="label"
            :title="label"
            :aria-pressed="voice ? active : undefined"
            :data-active="active ? 'true' : undefined"
            @click="primary"
        >
            <Icon :name="active ? 'phone-hangup' : 'phone'" />
        </button>
        <DropdownMenuRoot>
            <DropdownMenuTrigger as-child>
                <IconButton label="Choose call type"><Icon name="chevron-down" /></IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
                <DropdownMenuContent class="tumult-menu" side="bottom" align="end">
                    <DropdownMenuItem v-if="active" class="tumult-menu-item" text-value="leave" @select="emit('leave')">
                        Leave call
                    </DropdownMenuItem>
                    <template v-else>
                        <DropdownMenuItem class="tumult-menu-item" text-value="voice" @select="emit('join', false)">
                            Voice
                        </DropdownMenuItem>
                        <DropdownMenuItem class="tumult-menu-item" text-value="video" @select="emit('join', true)">
                            Video
                        </DropdownMenuItem>
                    </template>
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenuRoot>
    </div>
</template>

<style scoped>
.tumult-callmenu {
    display: inline-flex;
    align-items: center;
}
/* Same box and hover as IconButton, so the pair reads as one control. */
.tumult-callmenu-main {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-md);
    height: var(--control-md);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--icon-md);
    cursor: pointer;
}
.tumult-callmenu-main:hover {
    background: var(--roomlist-item-bg-hover);
    color: var(--text-primary);
}
.tumult-callmenu-main[data-active="true"] {
    color: var(--accent);
}
.tumult-callmenu-main:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
</style>
