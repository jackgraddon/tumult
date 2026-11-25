<script setup lang="ts">
/**
 * The one rail tile. Spaces, pinned rooms, DMs, panes and "add a server" all
 * render this element so a tile's box, states and focus ring have a single
 * owner. Content is a slot: an Avatar for identities, an Icon for chrome.
 */
import { useRailAnimations } from "./railAnimation.ts";

const animating = useRailAnimations();

defineProps<{
    /** Accessible name (also the tooltip's text in each caller). */
    label: string;
    /** Anchors get an href; the add button omits it and renders a <button>. */
    href?: string;
    active?: boolean;
}>();
</script>

<template>
    <component
        :is="href === undefined ? 'button' : 'a'"
        class="tumult-rail-tile"
        v-bind="href === undefined ? { type: 'button' } : { href }"
        :aria-label="label"
        :aria-current="active ? 'page' : undefined"
        :data-animate="animating === true ? 'true' : undefined"
    >
        <slot />
    </component>
</template>

<style scoped>
.tumult-rail-tile {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--rail-item-size);
    height: var(--rail-item-size);
    margin: 0 auto;
    padding: 0;
    border: none;
    border-radius: var(--rail-tile-radius);
    background: var(--surface-pane);
    color: var(--text-primary);
    font-size: var(--icon-md);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-none);
    text-decoration: none;
    cursor: pointer;
    transition:
        background-color var(--rail-tile-motion-duration) var(--rail-tile-motion-ease),
        border-radius var(--rail-tile-motion-duration) var(--rail-tile-motion-ease);
}
/* Cold boot resolves the route before the room list, so the active tile can
   flip after mount. That is not a user action and must not animate. */
.tumult-rail-tile:not([data-animate="true"]) {
    transition: none;
}
.tumult-rail-tile:hover {
    background: var(--rail-item-bg-hover);
}
/* Selected is the one state where the circle opens up into a squircle; the
   radii are theme tokens so a theme decides both shapes. The idle radius is a
   percentage on purpose: a fixed oversized radius interpolates as a length and
   makes this morph snap at the very end instead of easing throughout. */
.tumult-rail-tile[aria-current="page"] {
    background: var(--rail-item-bg-active);
    border-radius: var(--rail-tile-radius-active);
}
.tumult-rail-tile:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
</style>

<!-- Shared by every rail tile's tooltip; the trigger lives in each caller so
     Reka can wrap the tile in its own context/dropdown trigger. -->
<style>
.tumult-tooltip {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--control-radius);
    /* `--surface-active` is a translucent hover tint, not a surface: the
       rail showing through it left the label hard to read. Tooltips are
       popovers, so use the same solid surface as the other ones. */
    background: var(--popover-bg);
    color: var(--text-primary);
    font-size: var(--text-sm);
}
</style>
