<script setup lang="ts">
import { computed } from "vue";
import type { ChatClient } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import VoiceTile from "./VoiceTile.vue";

// The room's live video, above the timeline. Renders nothing unless this room
// is the voice session AND someone is showing video, so a voice-only call costs
// the room no space at all.
const props = defineProps<{ client: ChatClient; roomId: string }>();

const voice = useSubscribable(props.client.voice);

interface Tile {
    key: string;
    userId: string;
    deviceId: string;
    source: "camera" | "screen";
    speaking: boolean;
}

const tiles = computed<Tile[]>(() => {
    const view = voice.value;
    if (!view || view.roomId !== props.roomId) return [];
    const out: Tile[] = [];
    for (const p of view.participants) {
        for (const source of ["screen", "camera"] as const) {
            if (p[source]) out.push({ key: `${p.userId}:${p.deviceId}:${source}`, userId: p.userId, deviceId: p.deviceId, source, speaking: p.speaking });
        }
    }
    // Screens first, so the spotlight row leads.
    return out.sort((a, b) => Number(b.source === "screen") - Number(a.source === "screen"));
});

function label(tile: Tile): string {
    const name = tile.userId.replace(/^@/, "").split(":")[0] ?? tile.userId;
    return tile.source === "screen" ? `${name}'s screen` : name;
}
</script>

<template>
    <section v-if="tiles.length > 0" class="tumult-voice-stage" aria-label="Video">
        <VoiceTile
            v-for="tile in tiles"
            :key="tile.key"
            :client="client"
            :user-id="tile.userId"
            :device-id="tile.deviceId"
            :source="tile.source"
            :label="label(tile)"
            :speaking="tile.speaking"
        />
    </section>
</template>

<style scoped>
.tumult-voice-stage {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--layout-voice-tile-min-width), 1fr));
    gap: var(--space-2);
    max-height: var(--layout-voice-stage-max-height);
    padding: var(--space-2);
    overflow-y: auto;
    background: var(--surface-raised);
    border-bottom: var(--border-width) solid var(--border-default);
}
</style>
