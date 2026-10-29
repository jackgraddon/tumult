<script setup lang="ts">
import Avatar from "../primitives/Avatar.vue";

// A miniature of the shell — rail, room list, timeline, composer — drawn from
// the SAME component tokens the real panes use. Theme, mode and density are all
// custom properties on `:root`, so this repaints the moment a choice lands, with
// no wiring of its own. It is a picture, not UI: `inert` + `aria-hidden` keep it
// out of the tab order and the accessibility tree.

interface PreviewMessage {
    name: string;
    time: string;
    body: string;
    /** The first unread message: the "New" divider draws above it. */
    firstUnread?: boolean;
}

const channels = [
    { name: "general", active: true, unread: 0 },
    { name: "announcements", active: false, unread: 3 },
    { name: "design", active: false, unread: 0 },
    { name: "off-topic", active: false, unread: 0 },
];

const messages: PreviewMessage[] = [
    { name: "Alice", time: "10:42", body: "Morning! Did the new build land?" },
    { name: "Bob", time: "10:44", body: "It did — can you give the settings page a look?", firstUnread: true },
    { name: "Carol", time: "10:45", body: "Looks great in light mode too." },
];
</script>

<template>
    <div class="tumult-preview" aria-hidden="true" inert>
        <div class="tumult-preview-rail">
            <span class="tumult-preview-guild" data-active="true">
                <span class="tumult-preview-pill" />
                <Avatar label="Tumult" size="md" />
            </span>
            <span class="tumult-preview-guild"><Avatar label="Design" size="md" /></span>
            <span class="tumult-preview-guild"><Avatar label="Games" size="md" /></span>
        </div>
        <div class="tumult-preview-rooms">
            <span class="tumult-preview-heading">Tumult</span>
            <span
                v-for="channel in channels"
                :key="channel.name"
                class="tumult-preview-room"
                :data-active="channel.active ? 'true' : undefined"
                :data-unread="channel.unread > 0 ? 'true' : undefined"
            >
                <span class="tumult-preview-room-name"># {{ channel.name }}</span>
                <span v-if="channel.unread > 0" class="tumult-preview-badge">{{ channel.unread }}</span>
            </span>
        </div>
        <div class="tumult-preview-timeline">
            <span class="tumult-preview-heading"># general</span>
            <div class="tumult-preview-messages">
                <span class="tumult-preview-divider">Today</span>
                <template v-for="message in messages" :key="message.name">
                    <span v-if="message.firstUnread" class="tumult-preview-unread">New</span>
                    <div class="tumult-preview-row">
                        <Avatar :label="message.name" size="sm" />
                        <span class="tumult-preview-text">
                            <span class="tumult-preview-meta">
                                <span class="tumult-preview-name">{{ message.name }}</span>
                                <span class="tumult-preview-time">{{ message.time }}</span>
                            </span>
                            <span class="tumult-preview-body">{{ message.body }}</span>
                        </span>
                    </div>
                </template>
            </div>
            <div class="tumult-preview-composer">
                <span class="tumult-preview-input">Message #general</span>
                <span class="tumult-preview-send">Send</span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.tumult-preview {
    display: grid;
    grid-template-columns:
        var(--layout-guild-rail-width)
        minmax(0, var(--layout-roomlist-width))
        minmax(0, 1fr);
    overflow: hidden;
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--text-sm);
    user-select: none;
}

/* Rail */
.tumult-preview-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    background: var(--surface-rail);
}
.tumult-preview-guild {
    position: relative;
    display: flex;
    justify-content: center;
    width: 100%;
}
.tumult-preview-pill {
    position: absolute;
    top: 50%;
    left: 0;
    width: var(--rail-pill-width);
    height: var(--avatar-sm);
    border-radius: 0 var(--radius-full) var(--radius-full) 0;
    background: var(--rail-indicator);
    transform: translateY(-50%);
}

/* Room list */
.tumult-preview-rooms {
    display: flex;
    flex-direction: column;
    gap: var(--hairline);
    padding: var(--space-2);
    background: var(--roomlist-bg);
}
.tumult-preview-heading {
    padding: var(--space-1) var(--space-2) var(--space-2);
    overflow: hidden;
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-preview-room {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    padding: var(--roomlist-item-padding-y) var(--space-2);
    border-radius: var(--roomlist-item-radius);
    color: var(--roomlist-item-text);
}
.tumult-preview-room[data-active] {
    background: var(--roomlist-item-bg-active);
    color: var(--roomlist-item-text-active);
}
.tumult-preview-room[data-unread] {
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
}
.tumult-preview-room-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-preview-badge {
    flex-shrink: 0;
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: var(--badge-bg);
    color: var(--badge-text);
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
}

/* Timeline */
.tumult-preview-timeline {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--timeline-bg);
}
.tumult-preview-timeline > .tumult-preview-heading {
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--border-default);
}
.tumult-preview-messages {
    display: flex;
    flex-direction: column;
    gap: var(--timeline-row-gap);
    padding: var(--space-2) 0;
}
/* Same rule as the real timeline's day divider. */
.tumult-preview-divider {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--timeline-row-padding-x);
    color: var(--timeline-day-divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
}
.tumult-preview-divider::before,
.tumult-preview-divider::after {
    content: "";
    flex: 1;
    border-top: var(--border-width) solid var(--border-default);
}
.tumult-preview-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--timeline-row-padding-y) var(--timeline-row-padding-x);
}
/* Same rule as the real timeline's "New messages" divider. */
.tumult-preview-unread {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--timeline-row-padding-x);
    color: var(--timeline-unread-divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
}
.tumult-preview-unread::before,
.tumult-preview-unread::after {
    content: "";
    flex: 1;
    border-top: var(--border-width-strong) solid var(--timeline-unread-divider);
}
.tumult-preview-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.tumult-preview-meta {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
}
.tumult-preview-name {
    font-weight: var(--weight-semibold);
}
.tumult-preview-time {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-preview-body {
    color: var(--text-primary);
}

/* Composer */
.tumult-preview-composer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: auto;
    padding: var(--space-2) var(--space-3);
    background: var(--composer-bg);
}
.tumult-preview-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-1-5) var(--space-2);
    overflow: hidden;
    border: var(--border-width) solid var(--composer-input-border);
    border-radius: var(--control-radius);
    background: var(--composer-input-bg);
    color: var(--input-placeholder);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-preview-send {
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--control-radius);
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: var(--weight-semibold);
}
</style>
