<script setup lang="ts">
import { ref } from "vue";

import { chat } from "../chat.ts";

const homeserverUrl = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function submit(): Promise<void> {
    error.value = null;
    busy.value = true;
    try {
        // On success this navigates to the identity provider and never returns,
        // so `busy` is only ever cleared on the failure path.
        await chat.login({ homeserverUrl: homeserverUrl.value });
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        busy.value = false;
    }
}
</script>

<template>
    <main class="centered">
        <h1>Tumult</h1>
        <p class="muted">Sign in with your homeserver.</p>

        <form @submit.prevent="submit">
            <label for="homeserver">Homeserver</label>
            <input
                id="homeserver"
                v-model="homeserverUrl"
                type="text"
                placeholder="matrix.example.com"
                autocomplete="url"
                required
                :disabled="busy"
            />
            <button type="submit" :disabled="busy || homeserverUrl.trim() === ''">
                {{ busy ? "Redirecting…" : "Continue" }}
            </button>
        </form>

        <p v-if="error" role="alert" class="error">{{ error }}</p>
    </main>
</template>
