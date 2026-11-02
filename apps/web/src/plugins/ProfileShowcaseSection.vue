<script setup lang="ts">
import { computed, onScopeDispose, ref } from "vue";
import type { ChatClient, MemberView } from "@tumult/core/contract";

/**
 * Reference profile section: one extended-profile field (MSC4133) drawn as an
 * extra block on a member's profile card.
 *
 * The card hands over the member, the room and the shell's client, so a
 * section subscribes to exactly its own data and stops when the card closes —
 * the popover unmounts, `onScopeDispose` runs, the feed drops the listener.
 */
const props = defineProps<{
    member: MemberView;
    roomId: string;
    client: ChatClient;
}>();

/** Namespaced, public, per-user data — Tumult defines no schema for it. */
const KEY = "cc.jackg.tumult.profile-showcase";

const feed = props.client.profileField(props.member.userId, KEY);
const value = ref<unknown>(feed.get());
const subscription = feed.subscribe((next) => {
    value.value = next;
});
onScopeDispose(() => subscription.unsubscribe());

const game = computed(() => (value.value as { game?: unknown } | null)?.game);
</script>

<template>
    <p v-if="typeof game === 'string'" class="tumult-profile-showcase">
        Favourite game: {{ game }}
    </p>
</template>

<style scoped>
.tumult-profile-showcase {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
</style>
