<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { chat } from "../chat.ts";

const router = useRouter();
const error = ref<string | null>(null);

onMounted(async () => {
    try {
        await chat.completeLogin({ callbackUrl: window.location.href });

        // The fragment still holds the authorization code. Drop it from history
        // before navigating so it can't be recovered from the back stack.
        window.history.replaceState(null, "", window.location.pathname);
        await router.replace({ name: "dms" });
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
    }
});
</script>

<template>
    <main class="tumult-page">
        <section class="tumult-page-card">
            <template v-if="error">
                <h1 class="tumult-page-title">Sign-in failed</h1>
                <p role="alert" class="tumult-page-error">{{ error }}</p>
                <RouterLink class="tumult-page-link" to="/login">Try again</RouterLink>
            </template>
            <p v-else class="tumult-page-muted" role="status">Completing sign-in…</p>
        </section>
    </main>
</template>
