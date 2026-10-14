<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TumultShell, type Plugin, type PluginRegistry, type RoomSelection } from "@tumult/ui";
import type { ChatClient } from "@tumult/core";

import { decodeGuildId, decodeRoomId } from "../routing.ts";
import DemoPoll from "../renderers/DemoPoll.vue";

/**
 * The reference plugin: registers the demo-poll timeline renderer through the
 * plugin API (manifest + permission + context) instead of poking the registry
 * directly. A game renderer follows this exact shape.
 */
const demoPoll: Plugin = {
    manifest: {
        id: "cc.jackg.tumult.demo-poll",
        name: "Demo Poll",
        version: "1.0.0",
        author: "Tumult",
        description: "Renders cc.jackg.tumult.demo.poll events as a poll.",
        permissions: ["timeline-renderers"],
    },
    install(ctx) {
        ctx.addRenderer("cc.jackg.tumult.demo.poll", { component: DemoPoll, priority: 10 });
    },
};

const route = useRoute();
const router = useRouter();

/**
 * The concrete client is a dynamic import on purpose: importing it pulls in
 * matrix-js-sdk (about 1 MB). Holding it in a ref lets this view paint a boot
 * state first, then swap in the real shell once the SDK chunk arrives. The
 * router guard already confirmed a session is *persisted*; rehydrating the
 * client — which does need the SDK — is this view's job now.
 */
const chat = shallowRef<ChatClient | null>(null);
const shell = ref<{ plugins: PluginRegistry; hrefFor: (next: RoomSelection) => string } | null>(null);
const showMembers = ref(true);
const showRoomList = ref(true);
const startError = ref<string | null>(null);

onMounted(async () => {
    try {
        const { chat: client } = await import("../chat.ts");
        // Restore before start: `start()` needs a session, and the guard only
        // checked that one is stored, not that it is still loadable.
        if (!(await client.restoreSession())) {
            await router.replace({ name: "login" });
            return;
        }
        chat.value = client;
        await client.start();
    } catch (cause) {
        startError.value = cause instanceof Error ? cause.message : String(cause);
    }
    // Install the reference plugin from the app, proving the extension seam
    // lives outside packages/ui and flows through the manifest/permission path.
    shell.value?.plugins.install(demoPoll);
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
    if (!chat.value) return;
    await chat.value.logout();
    await router.replace({ name: "login" });
}
</script>

<template>
    <TumultShell
        v-if="chat"
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
    <main v-else class="centered" role="status">
        <h1>Tumult</h1>
        <p class="muted">Loading…</p>
    </main>
    <p v-if="startError" role="alert" class="tumult-start-error">{{ startError }}</p>
</template>

<style scoped>
.tumult-start-error {
    position: fixed;
    bottom: var(--space-2);
    left: 50%;
    transform: translateX(-50%);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--banner-error-bg);
    color: var(--banner-error-text);
    font-size: var(--text-sm);
}
</style>
