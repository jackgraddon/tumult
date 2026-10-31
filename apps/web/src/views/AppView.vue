<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
import { computed, onMounted, provide, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
    PluginInstallKey,
    ThemeKey,
    TumultShell,
    type Plugin,
    type PluginRegistry,
    type RoomSelection,
} from "@tumult/ui";
import type { ChatClient } from "@tumult/core";

import { decodeGuildId, decodeRoomId } from "../routing.ts";
import DemoPoll from "../renderers/DemoPoll.vue";
import { activityShowcase, adminBadge, reactLastAction, settingsShowcase, shrugCommand, workspaceShowcase } from "../plugins/showcase.ts";
import { pluginInstallController } from "../plugins/controller.ts";
import { themeController } from "../theme/controller.ts";

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

// The theme seam: the app owns storage and the DOM, the UI renders the editor.
// Provided above the shell, so `TumultShell` registers its Appearance tab only
// when a controller exists.
provide(ThemeKey, themeController);

// The plugin-install seam: the app owns GitHub, IndexedDB and the bundle
// imports; the UI renders the Plugins tab's install UI and the consent dialog.
// The controller's registry is attached after `TumultShell` mounts (below),
// because the registry is shell-owned.
provide(PluginInstallKey, pluginInstallController);

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
        startError.value = reportError(cause, "Couldn't connect to your homeserver");
    }
    // Install the reference plugins from the app, proving the extension seam
    // lives outside packages/ui and flows through the manifest/permission path.
    shell.value?.plugins.install(demoPoll);
    shell.value?.plugins.install(shrugCommand);
    shell.value?.plugins.install(reactLastAction);
    shell.value?.plugins.install(adminBadge);
    if (import.meta.env.MODE === "fake") shell.value?.plugins.install(activityShowcase);
    shell.value?.plugins.install(settingsShowcase);
    shell.value?.plugins.install(workspaceShowcase);

    // Third-party installs: hand the controller the shell's registry, then
    // re-hash and load every enabled stored plugin. Failures are reported per
    // plugin (the controller disables a bundle that no longer matches its hash).
    if (shell.value) {
        pluginInstallController.attach(shell.value.plugins);
        const failures = await pluginInstallController.restore();
        for (const failure of failures) {
            console.error("[tumult] plugin restore failed:", failure.error);
        }
    }
});

const selection = computed<RoomSelection>(() => {
    if (route.name === "pane") {
        const paneId = typeof route.params["paneId"] === "string" ? route.params["paneId"] : undefined;
        return { view: "pane", paneId };
    }
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
    <main v-else class="tumult-page" role="status">
        <section class="tumult-page-card">
            <h1 class="tumult-page-title">Tumult</h1>
            <p class="tumult-page-muted">Loading…</p>
        </section>
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
