<script setup lang="ts">
import type { MemberView } from "@tumult/core";

import Avatar from "../primitives/Avatar.vue";

const props = defineProps<{
    member: MemberView;
}>();

function ago(ts: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

// The dot is decorative (aria-hidden); presence still needs to reach a
// pointer user, so the truth lives in the tooltip. "unknown" is honest —
// presence only becomes real once the server has sent it this session.
function presenceTitle(): string {
    const m = props.member;
    if (m.presence === "online") return "Online";
    if (m.presence === "offline") return m.lastActiveTs ? `Last seen ${ago(m.lastActiveTs)}` : "Offline";
    return "Presence not yet known";
}
</script>

<template>
    <div class="tumult-member">
        <span
            class="tumult-member-dot"
            :data-presence="member.presence"
            :title="presenceTitle()"
            aria-hidden="true"
        />
        <Avatar :label="member.displayName" :src="member.avatarUrl" size="sm" />
        <span class="tumult-member-name" :title="member.userId">{{ member.displayName }}</span>
        <span v-if="member.membership === 'invite'" class="tumult-member-badge">Invited</span>
    </div>
</template>

<style scoped>
.tumult-member {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 4px var(--space-2);
    border-radius: var(--control-radius);
    font-size: var(--text-sm);
    color: var(--text-secondary);
}
.tumult-member:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-member-dot {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    box-sizing: border-box;
    background: transparent;
}
.tumult-member-dot[data-presence="online"] {
    background: var(--success);
}
.tumult-member-dot[data-presence="offline"] {
    background: var(--text-muted);
}
.tumult-member-dot[data-presence="unknown"] {
    border: 1.5px solid var(--text-muted);
}
.tumult-member-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-member-badge {
    flex-shrink: 0;
    padding: 0 var(--space-1);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
</style>
