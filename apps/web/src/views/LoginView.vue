<script setup lang="ts">
import { reportError } from "@tumult/core/errors";
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
        error.value = reportError(cause, "Couldn't start signing in", { verbatimOwn: true });
        busy.value = false;
    }
}
</script>

<template>
    <main class="tumult-page">
        <section class="tumult-page-card">
            <h1 class="tumult-page-title">Tumult</h1>
            <p class="tumult-page-muted">
                Sign in with your homeserver — your identity provider handles the rest.
            </p>

            <form class="tumult-page-form" @submit.prevent="submit">
                <label class="tumult-page-label" for="homeserver">Homeserver</label>
                <input
                    id="homeserver"
                    v-model="homeserverUrl"
                    class="tumult-page-input"
                    type="text"
                    placeholder="matrix.example.com"
                    autocomplete="url"
                    required
                    :disabled="busy"
                />
                <button
                    type="submit"
                    class="tumult-page-button"
                    :disabled="busy || homeserverUrl.trim() === ''"
                >
                    {{ busy ? "Redirecting…" : "Continue" }}
                </button>
            </form>

            <p v-if="error" role="alert" class="tumult-page-error">{{ error }}</p>
        </section>
    </main>
</template>
