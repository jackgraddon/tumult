<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { ChatClient } from "@tumult/core";

import Icon from "../icons/Icon.vue";
import { useSubscribable } from "../subscribable.ts";
import { bestGrid, isSpotlit, partition, pruneOverrides } from "./stageLayout.ts";
import VoiceTile from "./VoiceTile.vue";

// The room's live video, above the timeline. Renders nothing unless this room
// is the voice session AND someone is showing video, so a voice-only call costs
// the room no space at all.
//
// It never scrolls and never grows: the stage has a fixed height (or, expanded,
// covers the timeline pane), and `bestGrid` picks the arrangement that makes
// every participant as large as that box allows. Clicking a tile moves it into
// or out of the spotlight; a shared screen starts in it.
const props = defineProps<{ client: ChatClient; roomId: string }>();

const voice = useSubscribable(props.client.voice);

interface Tile {
    key: string;
    userId: string;
    deviceId: string;
    source: "camera" | "screen";
    speaking: boolean;
    /** For a screen: whether it carries audio. */
    audio: boolean;
}

const tiles = computed<Tile[]>(() => {
    const view = voice.value;
    if (!view || view.roomId !== props.roomId) return [];
    const out: Tile[] = [];
    for (const p of view.participants) {
        for (const source of ["screen", "camera"] as const) {
            if (p[source]) out.push({ key: `${p.userId}:${p.deviceId}:${source}`, userId: p.userId, deviceId: p.deviceId, source, speaking: p.speaking, audio: p.screenAudio });
        }
    }
    return out;
});

// The user's clicks; absent means "the default for that kind of tile".
const overrides = ref<Record<string, boolean>>({});
const expanded = ref(false);

const split = computed(() => partition(tiles.value, overrides.value));

// A tile is spotlit by the user's click or, failing that, its default. In the
// even grid (nothing spotlit) no tile is, so a click brings it to the front.
function isInSpotlight(tile: Tile): boolean {
    return isSpotlit(tile, overrides.value);
}

function toggle(tile: Tile): void {
    overrides.value = { ...overrides.value, [tile.key]: !isInSpotlight(tile) };
}

watch(
    () => tiles.value.map((t) => t.key).join("\n"),
    () => {
        overrides.value = pruneOverrides(overrides.value, tiles.value.map((t) => t.key));
        if (tiles.value.length === 0) expanded.value = false;
    },
);

// --- fitting -------------------------------------------------------------

const primary = ref<HTMLElement | null>(null);
const size = ref({ width: 0, height: 0, gap: 0 });
let observer: ResizeObserver | null = null;

function measure(): void {
    const el = primary.value;
    if (!el) return;
    const gap = Number.parseFloat(getComputedStyle(el).columnGap);
    size.value = { width: el.clientWidth, height: el.clientHeight, gap: Number.isFinite(gap) ? gap : 0 };
}

// The primary region exists whenever the stage does, but the stage itself is a
// `v-if`, so the observer follows the element rather than the component.
watch(
    primary,
    (el) => {
        observer?.disconnect();
        observer = null;
        if (!el) return;
        measure();
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(measure);
            observer.observe(el);
        }
    },
    { flush: "post" },
);

const grid = computed(() => bestGrid(split.value.main.length, size.value.width, size.value.height, size.value.gap));

function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && expanded.value) expanded.value = false;
}
watch(expanded, (open) => {
    if (open) window.addEventListener("keydown", onKey);
    else window.removeEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
    observer?.disconnect();
    window.removeEventListener("keydown", onKey);
});

function label(tile: Tile): string {
    const name = tile.userId.replace(/^@/, "").split(":")[0] ?? tile.userId;
    return tile.source === "screen" ? `${name}'s screen` : name;
}
</script>

<template>
    <section v-if="tiles.length > 0" class="tumult-voice-stage" :data-expanded="expanded ? 'true' : 'false'" aria-label="Video">
        <div class="tumult-voice-stage-actions">
            <button
                type="button"
                class="tumult-voice-stage-action"
                :aria-pressed="expanded"
                :aria-label="expanded ? 'Shrink video' : 'Expand video'"
                :title="expanded ? 'Shrink video (Esc)' : 'Expand video over the chat'"
                @click="expanded = !expanded"
            >
                <Icon :name="expanded ? 'arrow-collapse-all' : 'arrow-expand-all'" />
            </button>
        </div>
        <div ref="primary" class="tumult-voice-main" :style="{ '--cols': grid.cols, '--rows': grid.rows }">
            <VoiceTile
                v-for="tile in split.main"
                :key="tile.key"
                :client="client"
                :user-id="tile.userId"
                :device-id="tile.deviceId"
                :source="tile.source"
                :label="label(tile)"
                :speaking="tile.speaking"
                :audio="tile.audio"
                :spotlit="isInSpotlight(tile)"
                @toggle="toggle(tile)"
            />
        </div>
        <div v-if="split.strip.length > 0" class="tumult-voice-strip" :style="{ '--cols': split.strip.length }">
            <VoiceTile
                v-for="tile in split.strip"
                :key="tile.key"
                :client="client"
                :user-id="tile.userId"
                :device-id="tile.deviceId"
                :source="tile.source"
                :label="label(tile)"
                :speaking="tile.speaking"
                :audio="tile.audio"
                :spotlit="false"
                @toggle="toggle(tile)"
            />
        </div>
    </section>
</template>

<style scoped>
.tumult-voice-stage {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-2);
    height: var(--layout-voice-stage-height);
    /* Never let the video take the chat's room on a short window. */
    max-height: 50%;
    padding: var(--space-2);
    overflow: hidden;
    background: var(--surface-raised);
    border-bottom: var(--border-width) solid var(--border-default);
}
/* Expanded: cover the whole timeline pane (its header included), whose box is
   the positioned ancestor. The video gets all of it; nothing else moves. */
.tumult-voice-stage[data-expanded="true"] {
    position: absolute;
    inset: 0;
    z-index: 1;
    height: auto;
    max-height: none;
    border-bottom: none;
    background: var(--surface-base);
}
.tumult-voice-main,
.tumult-voice-strip {
    /* Set inline from the measured box (bestGrid); these are the first-paint values. */
    --cols: 1;
    --rows: 1;
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    min-height: 0;
}
.tumult-voice-main {
    flex: 1 1 0;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
}
/* A fixed-height row of 16:9 thumbnails that shrinks, never scrolls, when there
   are more of them than the width holds. */
.tumult-voice-strip {
    flex: none;
    height: var(--layout-voice-strip-height);
    grid-template-columns: repeat(var(--cols), minmax(0, calc(var(--layout-voice-strip-height) * 16 / 9)));
    justify-content: center;
}
.tumult-voice-stage-actions {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    z-index: 1;
    display: flex;
    border-radius: var(--control-radius);
    background: var(--surface-overlay);
}
.tumult-voice-stage-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-md);
    height: var(--control-md);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--icon-md);
    cursor: pointer;
}
.tumult-voice-stage-action:hover {
    background: var(--surface-hover);
}
.tumult-voice-stage-action:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
</style>
