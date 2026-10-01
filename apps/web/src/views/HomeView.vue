<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { chat } from "../chat.ts";
import { useSubscribable } from "../composables/useSubscribable.ts";

const router = useRouter();
const session = useSubscribable(chat.session);
const connection = useSubscribable(chat.connection);
const error = ref<string | null>(null);

onMounted(async () => {
    try {
        await chat.start();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
    }
});

async function signOut(): Promise<void> {
    await chat.logout();
    await router.replace({ name: "login" });
}
</script>

<template>
    <main class="centered">
        <h1>Tumult</h1>

        <!--
            Placeholder for the 3-pane shell (slice 2). What it proves today:
            login round-trips, the session survives a reload, and the sync
            lifecycle actually reaches the UI — including PREPARED served from
            the IndexedDB cache on a warm start.
        -->
        <dl v-if="session">
            <dt>Signed in as</dt>
            <dd>{{ session.userId }}</dd>
            <dt>Device</dt>
            <dd>{{ session.deviceId }}</dd>
            <dt>Homeserver</dt>
            <dd>{{ session.homeserverUrl }}</dd>
            <dt>Connection</dt>
            <dd>{{ connection }}</dd>
        </dl>

        <p v-if="error" role="alert" class="error">{{ error }}</p>

        <button type="button" @click="signOut">Sign out</button>
    </main>
</template>
