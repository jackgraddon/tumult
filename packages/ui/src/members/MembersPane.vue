<script setup lang="ts">
import { computed } from "vue";
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "reka-ui";
import type { ChatClient, MessageView, Subscribable } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import MemberListItem from "./MemberListItem.vue";
import IconButton from "../primitives/IconButton.vue";

const props = defineProps<{
    client: ChatClient;
    /** Undefined while nothing is selected: renders an empty static list. */
    roomId: string | undefined;
}>();

const emit = defineEmits<{
    invite: [];
}>();

interface Member {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    presence: "online" | "offline";
}

// Subscribed once per mount; the parent keys on roomId so a room switch
// remounts instead of leaking the old subscription.
//
// `timeline()` still throws until slice 4 — catch it and render an explicit
// placeholder rather than a zombie vnode (see TimelineBody).
let source: Subscribable<MessageView[]> | null = null;
try {
    source = props.roomId ? props.client.timeline(props.roomId) : null;
} catch {
    source = null;
}
const messages = source ? useSubscribable(source) : null;

/** Flat static list for the slice: distinct senders, no sections. */
const members = computed<Member[]>(() => {
    const seen = new Map<string, Member>();
    for (const m of messages?.value ?? []) {
        // Later messages overwrite earlier: newest profile wins.
        seen.set(m.senderId, {
            id: m.senderId,
            displayName: m.senderName,
            avatarUrl: m.senderAvatarUrl,
            presence: "online",
        });
    }
    // (Was `a.displayName.localeCompare("en")` — compared every name to the
    // string "en", so the list was effectively unsorted.)
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "en"));
});
</script>

<template>
    <aside class="tumult-members" aria-label="Members">
        <h2 class="tumult-members-title">
            <span>Members — {{ messages ? members.length : "…" }}</span>
            <IconButton v-if="roomId" label="Invite people" @click="emit('invite')">
                <span aria-hidden="true">＋</span>
            </IconButton>
        </h2>
        <p v-if="!messages" class="tumult-members-todo" role="status">
            Member loading rides on timeline read (slice 4).
        </p>
        <ScrollAreaRoot v-else class="tumult-members-scroll">
            <ScrollAreaViewport class="tumult-members-viewport">
                <ul class="tumult-members-list">
                    <MemberListItem
                        v-for="m in members"
                        :key="m.id"
                        :id="m.id"
                        :display-name="m.displayName"
                        :avatar-url="m.avatarUrl"
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--border-default);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.tumult-members-todo {
    margin: 0;
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
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
