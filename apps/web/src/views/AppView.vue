<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TumultShell, type RoomSelection, type TimelineRegistry } from "@tumult/ui";

import { chat } from "../chat.ts";
import { decodeGuildId, decodeRoomId } from "../routing.ts";
import DemoPoll from "../renderers/DemoPoll.vue";

const route = useRoute();
const router = useRouter();
const shell = ref<{ registry: TimelineRegistry; hrefFor: (next: RoomSelection) => string } | null>(null);
const showMembers = ref(true);
const showRoomList = ref(true);
const startError = ref<string | null>(null);

onMounted(async () => {
    try {
        await chat.start();
    } catch (cause) {
        startError.value = cause instanceof Error ? cause.message : String(cause);
    }
    // Register the demo poll renderer from the app, proving the extension seam
    // lives outside packages/ui.
    shell.value?.registry.register("cc.jackg.tumult.demo.poll", {
        component: DemoPoll,
        priority: 10,
    });
});

const selection = computed<RoomSelection>(() => {
    if (route.name === "dms") {
        const roomId = typeof route.params["roomId"] === "string" ? decodeRoomId(route.params["roomId"]) : undefined;
        return { view: "dms", roomId };
    }
    const guildId =
        typeof route.params["guildId"] === "string" ? decodeGuildId(route.params["guildId"]) : undefined;
    const roomId =
        typeof route.params["roomId"] === "string" ? decodeRoomId(route.params["roomId"]) : undefined;
    return { view: "guild", guildId, roomId };
});

function onSelect(next: RoomSelection): void {
    if (!shell.value) return;
    void router.push(shell.value.hrefFor(next));
}

async function signOut(): Promise<void> {
    await chat.logout();
    await router.replace({ name: "login" });
}
</script>

<template>
    <TumultShell
        ref="shell"
        :client="chat"
        :selection="selection"
        :show-members="showMembers"
        :show-room-list="showRoomList"
        @select="onSelect"
        @toggle-members="showMembers = !showMembers"
        @toggle-room-list="showRoomList = !showRoomList"
        @sign-out="signOut"
    />
    <p v-if="startError" role="alert" class="tumult-start-error">{{ startError }}</p>
</template>

<style scoped>
.tumult-start-error {
    position: fixed;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 12px;
    border-radius: 6px;
    background: var(--banner-error-bg);
    color: #fff;
    font-size: 13px;
}
</style>
