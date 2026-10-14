<script setup lang="ts">
import { computed } from "vue";
import type { MemberView, RoomPowerLevelsView } from "@tumult/core";
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuPortal,
    ContextMenuRoot,
    ContextMenuTrigger,
} from "reka-ui";

import { useActions, type MemberModerationKind } from "../actions.ts";
import { useMemberDecorations } from "./decorations.ts";
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

// Moderation is the server's to enforce; these flags only spare the user an
// obviously doomed action. Everything requires the target to be strictly
// below us and not us: the same rule the server applies.
const myPower = computed(() => props.power?.myPowerLevel ?? 0);
const belowMe = computed(() => !props.member.isSelf && props.member.powerLevel < myPower.value);

const canSetPower = computed(
    () => !!props.power?.canSetPowerLevel && props.member.membership !== "ban" && belowMe.value,
);
const canKick = computed(() => !!props.power?.canKick && props.member.membership === "join" && belowMe.value);
const canBan = computed(() => !!props.power?.canBan && props.member.membership === "join" && belowMe.value);
const canUnban = computed(() => !!props.power?.canBan && props.member.membership === "ban" && belowMe.value);
const hasActions = computed(() => canSetPower.value || canKick.value || canBan.value || canUnban.value);

function request(kind: MemberModerationKind): void {
    actions.requestModeration({ kind, roomId: props.roomId, member: props.member });
}
</script>

<template>
    <ContextMenuRoot>
        <ContextMenuTrigger as-child :disabled="!hasActions">
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
        <!-- No actions for this row → no content, so a right-click shows nothing. -->
        <ContextMenuPortal v-if="hasActions">
            <ContextMenuContent class="tumult-menu">
                <ContextMenuItem
                    v-if="canSetPower"
                    class="tumult-menu-item"
                    text-value="set-power"
                    @select="request('set-power')"
                >
                    Change permissions…
                </ContextMenuItem>
                <ContextMenuItem
                    v-if="canKick"
                    class="tumult-menu-item"
                    text-value="kick"
                    @select="request('kick')"
                >
                    Kick {{ member.displayName }}
                </ContextMenuItem>
                <ContextMenuItem
                    v-if="canBan"
                    class="tumult-menu-item"
                    text-value="ban"
                    @select="request('ban')"
                >
                    Ban {{ member.displayName }}
                </ContextMenuItem>
                <ContextMenuItem
                    v-if="canUnban"
                    class="tumult-menu-item"
                    text-value="unban"
                    @select="request('unban')"
                >
                    Unban {{ member.displayName }}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenuPortal>
    </ContextMenuRoot>
</template>

<style scoped>
.tumult-member {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
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
.tumult-member-dot[data-presence="offline"] {
    background: var(--text-muted);
}
.tumult-member-dot[data-presence="unknown"] {
    border: var(--border-width-medium) solid var(--text-muted);
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
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--member-badge-radius);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
</style>
