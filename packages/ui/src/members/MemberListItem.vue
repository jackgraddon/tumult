<script setup lang="ts">
import { computed } from "vue";
import type { ChatClient, MemberView, RoomPowerLevelsView } from "@tumult/core";
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuPortal,
    ContextMenuRoot,
    ContextMenuSeparator,
    ContextMenuTrigger,
    PopoverContent,
    PopoverPortal,
    PopoverRoot,
    PopoverTrigger,
} from "reka-ui";

import { useActions, type MemberModerationKind } from "../actions.ts";
import { copyOrLog } from "../clipboard.ts";
import { buildMemberMenu, type MemberMenuAction } from "./memberMenu.ts";
import { useMemberDecorations } from "./decorations.ts";
import { useActivity } from "./activity.ts";
import { presenceLabel } from "./presenceLabel.ts";
import Avatar from "../primitives/Avatar.vue";
import ProfileCard from "./ProfileCard.vue";
import Icon from "../icons/Icon.vue";

const props = defineProps<{
    member: MemberView;
    /** The room the row belongs to — carried on every moderation request. */
    roomId: string;
    /** Power levels for the room, or null while unknown (then no actions show). */
    power: RoomPowerLevelsView | null;
    /** The shell's client, handed to the profile card's plugin sections. */
    client: ChatClient;
}>();

const actions = useActions();
const decorations = useMemberDecorations();

/** Plugin decorations that apply to this member, after the built-in badges. */
const memberDecorations = computed(() => decorations.resolve(props.member));

/** A plugin-rendered activity subtitle, or null (then the row stays one line). */
const activity = useActivity(() => props.member.userId);

// The dot is decorative (aria-hidden); presence still needs to reach a
// pointer user, so the truth lives in the tooltip. "unknown" is honest —
// presence only becomes real once the server has sent it this session.
function presenceTitle(): string {
    return presenceLabel(props.member);
}

// A verified identity swaps the dot for a shield in the same presence colour,
// so one glyph still carries presence and trust; both reach a pointer user
// through the tooltip and a screen reader through the visually hidden label.
const verified = computed(() => props.member.verification === "verified");
function statusTitle(): string {
    return verified.value ? `Verified · ${presenceTitle()}` : presenceTitle();
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
                <PopoverRoot>
                    <PopoverTrigger as-child>
                        <button class="tumult-member-main" type="button">
                            <span
                                v-if="verified"
                                class="tumult-member-shield"
                                :data-presence="member.presence"
                                :title="statusTitle()"
                                aria-hidden="true"
                            >
                                <Icon name="shield-check" />
                            </span>
                            <span
                                v-else
                                class="tumult-member-dot"
                                :data-presence="member.presence"
                                :title="statusTitle()"
                                aria-hidden="true"
                            />
                            <Avatar :label="member.displayName" :src="member.avatarUrl" size="sm" />
                            <span class="tumult-member-text">
                                <span class="tumult-member-name" :title="member.userId"
                                    >{{ member.displayName
                                    }}<span v-if="verified" class="tumult-member-sr">, verified</span></span
                                >
                                <component
                                    :is="activity.renderer.component"
                                    v-if="activity"
                                    class="tumult-member-activity"
                                    :user-id="member.userId"
                                    :value="activity.value"
                                    variant="row"
                                />
                                <span v-else-if="member.statusMessage" class="tumult-member-activity">{{
                                    member.statusMessage
                                }}</span>
                            </span>
                        </button>
                    </PopoverTrigger>
                    <PopoverPortal>
                        <PopoverContent
                            class="tumult-profile-popover"
                            side="left"
                            :side-offset="8"
                            :avoid-collisions="true"
                        >
                            <ProfileCard :member="member" :room-id="roomId" :client="client" />
                        </PopoverContent>
                    </PopoverPortal>
                </PopoverRoot>
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
/*
 * The row's clickable content is a BUTTON (it opens the profile card), and the
 * row itself stays the context-menu trigger — two `as-child` triggers on one
 * element would fight over their merged attributes. Reset the button to look
 * like the text it wraps.
 */
.tumult-member-main {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 1;
    gap: var(--space-2);
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.tumult-member-main:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
    outline-offset: calc(var(--focus-ring-offset) * -1);
    border-radius: var(--control-radius);
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
/* Same slot as the dot, sized by its own token; colour follows presence. */
.tumult-member-shield {
    display: inline-flex;
    flex-shrink: 0;
    width: var(--member-shield-size);
    height: var(--member-shield-size);
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: var(--member-shield-size);
}
.tumult-member-shield[data-presence="online"] {
    color: var(--success);
}
.tumult-member-shield[data-presence="unavailable"] {
    color: var(--warning);
}
/* Read by a screen reader, drawn nowhere (no literal lengths: the token gate). */
.tumult-member-sr {
    position: absolute;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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

<style>
/*
 * Portalled to `body`, so a scoped rule cannot reach this wrapper (the same
 * reason the reaction popover lives in an unscoped block). The card itself is
 * scoped inside ProfileCard.vue; this only removes the focus ring the popover
 * root would otherwise draw around its own content box.
 */
.tumult-profile-popover:focus {
    outline: none;
}
</style>
