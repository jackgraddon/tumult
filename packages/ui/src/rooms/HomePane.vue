<script setup lang="ts">
import { computed } from "vue";
import type { RoomSummary } from "@tumult/core";

import Icon from "../icons/Icon.vue";
import Avatar from "../primitives/Avatar.vue";
import UnreadBadge from "../primitives/UnreadBadge.vue";
import TimelineSkeleton from "../timeline/TimelineSkeleton.vue";
import { useSelection } from "../selection.ts";
import { recentChats, topSpaceId, unreadChats } from "./homeLists.ts";

const props = defineProps<{
    rooms: readonly RoomSummary[];
    /** A rail click or a deep link whose timeline has not landed yet. */
    loading?: boolean | undefined;
}>();

const emit = defineEmits<{
    "create-dm": [];
    "create-group": [];
    explore: [];
    "continue-reading": [roomId: string];
}>();

const selection = useSelection();
const recent = computed(() => recentChats(props.rooms));
const unread = computed(() => unreadChats(props.rooms));
const firstUnread = computed(() => unread.value[0]);

function open(room: RoomSummary): void {
    const guildId = topSpaceId(props.rooms, room);
    if (guildId === undefined) selection.select({ view: "dms", roomId: room.id });
    else selection.select({ view: "guild", guildId, roomId: room.id });
}
</script>

<template>
    <section class="tumult-timeline-pane tumult-home" aria-label="No conversation selected">
        <header class="tumult-timeline-header">
            <div class="tumult-timeline-header-text">
                <h2>Pick up where you left off</h2>
            </div>
        </header>
        <TimelineSkeleton v-if="loading" />
        <div v-else class="tumult-home-scroll">
            <div class="tumult-home-content">
                <section class="tumult-home-section" aria-labelledby="tumult-home-recent">
                    <h3 id="tumult-home-recent" class="tumult-home-heading">Recent chats</h3>
                    <ul v-if="recent.length > 0" class="tumult-home-list">
                        <li v-for="room in recent" :key="room.id">
                            <button type="button" class="tumult-home-chat" @click="open(room)">
                                <Avatar :label="room.name" :src="room.avatarUrl" size="sm" />
                                <span class="tumult-home-chat-name">{{ room.name }}</span>
                                <UnreadBadge :count="room.unreadCount" :highlight="room.highlightCount > 0" />
                            </button>
                        </li>
                    </ul>
                    <p v-else class="tumult-home-note">No conversations yet. Start one below.</p>
                </section>

                <section class="tumult-home-section" aria-labelledby="tumult-home-unread">
                    <h3 id="tumult-home-unread" class="tumult-home-heading">Unreads</h3>
                    <ul v-if="unread.length > 0" class="tumult-home-list">
                        <li v-for="room in unread" :key="room.id">
                            <button type="button" class="tumult-home-chat" @click="open(room)">
                                <Avatar :label="room.name" :src="room.avatarUrl" size="sm" />
                                <span class="tumult-home-chat-name">{{ room.name }}</span>
                                <UnreadBadge :count="room.unreadCount" :highlight="room.highlightCount > 0" />
                            </button>
                        </li>
                    </ul>
                    <p v-else class="tumult-home-note">You're all caught up.</p>
                </section>

                <section class="tumult-home-section" aria-labelledby="tumult-home-actions">
                    <h3 id="tumult-home-actions" class="tumult-home-heading">Start something</h3>
                    <div class="tumult-home-actions">
                        <button type="button" class="tumult-home-action" @click="emit('create-dm')">
                            <Icon name="message-plus" /><span>New direct message</span>
                        </button>
                        <button type="button" class="tumult-home-action" @click="emit('create-group')">
                            <Icon name="account-group" /><span>New group</span>
                        </button>
                        <button
                            type="button"
                            class="tumult-home-action"
                            :disabled="!firstUnread"
                            @click="firstUnread && emit('continue-reading', firstUnread.id)"
                        >
                            <Icon name="book-open-outline" /><span>Continue reading</span>
                        </button>
                        <button type="button" class="tumult-home-action" @click="emit('explore')">
                            <Icon name="compass" /><span>Explore rooms</span>
                        </button>
                    </div>
                </section>
            </div>
        </div>
    </section>
</template>

<style scoped>
.tumult-home {
    background: var(--surface-base);
}
.tumult-home-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}
.tumult-home-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: var(--panel-width);
    margin-inline: auto;
    padding: var(--space-5) var(--space-4);
}
.tumult-home-heading {
    margin: 0 0 var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.tumult-home-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-home-chat,
.tumult-home-action {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
}
.tumult-home-chat:hover,
.tumult-home-action:hover:not(:disabled) {
    background: var(--state-hover);
}
.tumult-home-chat:focus-visible,
.tumult-home-action:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: var(--hairline);
}
.tumult-home-action:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.tumult-home-action :deep(svg) {
    flex-shrink: 0;
    color: var(--text-muted);
}
.tumult-home-chat-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-home-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-home-actions {
    display: grid;
    gap: var(--space-2);
}
</style>
