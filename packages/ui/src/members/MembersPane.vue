<script setup lang="ts">
import { computed } from "vue";
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "reka-ui";
import type { ChatClient } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import MemberListItem from "./MemberListItem.vue";

const props = defineProps<{
    client: ChatClient;
    /** Undefined while nothing is selected: renders an empty static list. */
    roomId: string | undefined;
}>();

interface Member {
    id: string;
    displayName: string;
    presence: "online" | "offline";
}

// Subscribed once per mount; the parent keys on roomId so a room switch
// remounts instead of leaking the old subscription.
const messages = useSubscribable(
    props.roomId ? props.client.timeline(props.roomId) : { get: () => [], subscribe: () => ({ unsubscribe: () => {} }) },
);

/** Flat static list for the slice: distinct senders, no sections. */
const members = computed<Member[]>(() => {
    const seen = new Map<string, Member>();
    for (const m of messages.value) {
        if (!seen.has(m.senderId)) {
            seen.set(m.senderId, { id: m.senderId, displayName: m.senderId, presence: "online" });
        }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare("en"));
});
</script>

<template>
    <aside class="tumult-members" aria-label="Members">
        <h2 class="tumult-members-title">Members — {{ members.length }}</h2>
        <ScrollAreaRoot class="tumult-members-scroll">
            <ScrollAreaViewport class="tumult-members-viewport">
                <ul class="tumult-members-list">
                    <MemberListItem
                        v-for="m in members"
                        :key="m.id"
                        :id="m.id"
                        :display-name="m.displayName"
                        :presence="m.presence"
                    />
                </ul>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical" class="tumult-scrollbar">
                <ScrollAreaThumb class="tumult-scrollthumb" />
            </ScrollAreaScrollbar>
        </ScrollAreaRoot>
    </aside>
</template>

<style scoped>
.tumult-members {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    background: var(--members-bg);
    color: var(--text-secondary);
}
.tumult-members-title {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-default);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.tumult-members-scroll {
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.tumult-members-viewport {
    width: 100%;
    height: 100%;
}
.tumult-members-list {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
}
.tumult-scrollbar {
    width: 6px;
}
.tumult-scrollthumb {
    border-radius: var(--radius-full);
    background: var(--border-default);
}
</style>
