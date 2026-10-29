<script setup lang="ts">
import { computed } from "vue";
import type { MemberView, RoomPowerLevelsView } from "@tumult/core";
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuPortal,
    ContextMenuRoot,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "reka-ui";

import { useActions, type MemberModerationKind } from "../actions.ts";
import { copyOrLog } from "../clipboard.ts";
import { buildMemberMenu, type MemberMenuAction } from "./memberMenu.ts";
import { useMemberDecorations } from "./decorations.ts";
import { useActivity } from "./activity.ts";
import Avatar from "../primitives/Avatar.vue";

const props = defineProps<{
    member: MemberView;
    /** The room the row belongs to — carried on every moderation request. */
    roomId: string;
    /** Power levels for the room, or null while unknown (then no actions show). */
    power: RoomPowerLevelsView | null;
}>();

const actions = useActions();
const decorations = useMemberDecorations();

/** Plugin decorations that apply to this member, after the built-in badges. */
const memberDecorations = computed(() => decorations.resolve(props.member));

/** A plugin-rendered activity subtitle, or null (then the row stays one line). */
const activity = useActivity(() => props.member.userId);

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
    if (m.presence === "unavailable") return "Away";
    if (m.presence === "offline") return m.lastActiveTs ? `Last seen ${ago(m.lastActiveTs)}` : "Offline";
    return "Presence not yet known";
}

// Which moderation actions apply is `memberMenu.ts`'s call (the same rule the
// server applies: strictly below us, never ourselves). The row only renders the
// list it returns and routes an id back to a request.
const menu = computed(() => buildMemberMenu(props.member, { power: props.power }));

function request(kind: MemberModerationKind): void {
    actions.requestModeration({ kind, roomId: props.roomId, member: props.member });
}

function run(action: MemberMenuAction): void {
    switch (action) {
        case "copy-id":
            copyOrLog(props.member.userId, "user id");
            break;
        case "copy-link":
            copyOrLog(menu.value.userLink, "user link");
            break;
        case "set-power":
        case "kick":
        case "ban":
        case "unban":
            request(action);
            break;
    }
}
</script>

<template>
    <ContextMenuRoot>
        <!-- Copying an id needs no permission, so every row has a menu. -->
        <ContextMenuTrigger as-child>
            <div class="tumult-member">
                <span
                    class="tumult-member-dot"
                    :data-presence="member.presence"
                    :title="presenceTitle()"
                    aria-hidden="true"
                />
                <Avatar :label="member.displayName" :src="member.avatarUrl" size="sm" />
                <span class="tumult-member-text">
                    <span class="tumult-member-name" :title="member.userId">{{ member.displayName }}</span>
                    <component
                        :is="activity.renderer.component"
                        v-if="activity"
                        class="tumult-member-activity"
                        :user-id="member.userId"
                        :value="activity.value"
                        variant="row"
                    />
                </span>
                <span v-if="member.membership === 'invite'" class="tumult-member-badge">Invited</span>
                <span v-else-if="member.membership === 'ban'" class="tumult-member-badge">Banned</span>
                <component
                    :is="decoration.component"
                    v-for="decoration in memberDecorations"
                    :key="decoration.id"
                    class="tumult-member-decoration"
                    :member="member"
                    :room-id="roomId"
                />
            </div>
        </ContextMenuTrigger>
        <ContextMenuPortal>
            <ContextMenuContent class="tumult-menu">
                <template v-for="entry in menu.entries" :key="entry.id">
                    <ContextMenuSeparator
                        v-if="entry.kind === 'separator'"
                        class="tumult-menu-separator"
                    />
                    <ContextMenuItem
                        v-else
                        class="tumult-menu-item"
                        :class="{ 'tumult-menu-item-danger': entry.danger }"
                        :text-value="entry.label"
                        @select="run(entry.id)"
                    >
                        {{ entry.label }}
                    </ContextMenuItem>
                </template>
            </ContextMenuContent>
        </ContextMenuPortal>
    </ContextMenuRoot>
</template>

<style scoped>
.tumult-member {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--member-item-padding-y) var(--space-2);
    border-radius: var(--control-radius);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-member:hover {
    background: var(--roomlist-item-bg-hover);
}
.tumult-member-dot {
    width: var(--member-dot-size);
    height: var(--member-dot-size);
    flex-shrink: 0;
    border-radius: var(--radius-full);
    background: transparent;
}
.tumult-member-dot[data-presence="online"] {
    background: var(--success);
}
.tumult-member-dot[data-presence="unavailable"] {
    background: var(--warning);
}
.tumult-member-dot[data-presence="offline"] {
    background: var(--text-muted);
}
.tumult-member-dot[data-presence="unknown"] {
    border: var(--border-width-medium) solid var(--text-muted);
}
.tumult-member-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
}
/* The activity subtitle is ONE line: rows are virtualized on an estimate. */
.tumult-member-activity {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-member-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-member-badge {
    flex-shrink: 0;
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--member-badge-radius);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
</style>
