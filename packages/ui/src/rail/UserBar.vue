<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { computed, ref } from "vue";
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuTrigger,
} from "reka-ui";
import type { ChatClient, DeviceView, SessionView } from "@tumult/core";

import Avatar from "../primitives/Avatar.vue";
import IconButton from "../primitives/IconButton.vue";
import { useSubscribable } from "../subscribable.ts";
import { useActivity } from "../members/activity.ts";

const props = defineProps<{
    session: SessionView | null;
    client: ChatClient;
    /**
     * The room list is collapsed, so the bar only owns the rail track: keep the
     * avatar (the account menu still reaches everything) and drop the name,
     * status line and gear rather than letting them overflow.
     */
    compact?: boolean;
}>();

const emit = defineEmits<{
    signOut: [];
    security: [];
    verify: [];
    profile: [];
    settings: [];
    status: [];
}>();

// Unlike members(), the profile and presence feeds always exist (plain fields,
// not bootstrapped in start()), so reading them before start() is safe.
const profile = useSubscribable(props.client.profile);
const ownPresence = useSubscribable(props.client.ownPresence);

const name = computed(() => profile.value?.displayName ?? props.session?.userId ?? "Signed out");
const status = computed(() => ownPresence.value?.statusMessage ?? null);

// A plugin's activity renderer replaces the status text when it accepts our
// own field; the status button (and its click to edit) stays either way.
const activity = useActivity(() => props.session?.userId ?? "");

// `unknown` (no read yet) is its own state: a hollow dot is honest, while a
// filled muted dot would claim we are offline.
const presence = computed(() => ownPresence.value?.presence ?? "unknown");

function presenceTitle(): string {
    if (presence.value === "online") return "Online";
    if (presence.value === "unavailable") return "Away";
    if (presence.value === "offline") return "Offline";
    return "Presence unknown";
}

const devices = ref<DeviceView[] | null>(null);

async function onOpenChange(open: boolean, client: ChatClient): Promise<void> {
    if (!open) return;
    try {
        devices.value = await client.listDevices();
    } catch {
        devices.value = null;
    }
}
</script>

<template>
    <div class="tumult-userbar" :data-compact="compact ? 'true' : undefined">
        <DropdownMenuRoot @update:open="(open) => onOpenChange(open, client)">
            <DropdownMenuTrigger as-child>
                <button
                    type="button"
                    class="tumult-account"
                    :aria-label="session ? `Account: ${session.userId}` : 'Account'"
                >
                    <span class="tumult-userbar-avatar">
                        <Avatar :label="name" :src="profile?.avatarUrl" size="md" />
                        <span
                            class="tumult-userbar-dot"
                            :data-presence="presence"
                            :title="presenceTitle()"
                            aria-hidden="true"
                        />
                    </span>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
                <DropdownMenuContent class="tumult-menu" side="top" align="start">
                    <DropdownMenuItem class="tumult-menu-id" disabled :text-value="session?.userId ?? ''">
                        <span v-if="profile && profile.displayName !== profile.userId" class="tumult-menu-name">
                            {{ profile.displayName }}
                        </span>
                        <span>{{ session?.userId ?? "Signed out" }}</span>
                    </DropdownMenuItem>
                    <div v-if="devices" class="tumult-menu-devices" role="group" aria-label="Devices">
                        <ul>
                            <li
                                v-for="d in devices"
                                :key="d.id"
                                class="tumult-menu-device"
                                :title="d.verified ? 'Verified' : 'Unverified'"
                            >
                                <Icon :name="d.verified ? 'shield-check' : 'alert'" />
                                <span class="tumult-menu-device-name">{{ d.displayName ?? d.id }}{{ d.isCurrent ? " (this device)" : "" }}</span>
                            </li>
                        </ul>
                    </div>
                    <DropdownMenuItem class="tumult-menu-item" text-value="set status" @select="emit('status')">
                        Set status…
                    </DropdownMenuItem>
                    <DropdownMenuItem class="tumult-menu-item" text-value="settings" @select="emit('settings')">
                        Settings…
                    </DropdownMenuItem>
                    <DropdownMenuItem class="tumult-menu-item" text-value="edit profile" @select="emit('profile')">
                        Edit profile…
                    </DropdownMenuItem>
                    <DropdownMenuItem class="tumult-menu-item" text-value="security" @select="emit('security')">
                        Security…
                    </DropdownMenuItem>
                    <DropdownMenuItem class="tumult-menu-item" text-value="verify" @select="emit('verify')">
                        Verify this device…
                    </DropdownMenuItem>
                    <DropdownMenuItem class="tumult-menu-item" text-value="sign out" @select="emit('signOut')">
                        Sign out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenuRoot>
        <div v-if="!compact" class="tumult-userbar-id">
            <span class="tumult-userbar-name" :title="name">{{ name }}</span>
            <button type="button" class="tumult-userbar-status" @click="emit('status')">
                <component
                    :is="activity.renderer.component"
                    v-if="activity && session"
                    class="tumult-userbar-status-text"
                    :user-id="session.userId"
                    :value="activity.value"
                    variant="self"
                />
                <span v-else-if="status" class="tumult-userbar-status-text" :title="status">{{ status }}</span>
                <span v-else class="tumult-userbar-status-hint">Set a status</span>
            </button>
        </div>
        <IconButton v-if="!compact" class="tumult-userbar-gear" label="Settings" @click="emit('settings')">
            <Icon name="cog" />
        </IconButton>
    </div>
</template>

<style scoped>
/* Three independent columns: the avatar track is exactly the rail width, so the
   avatar stays centred on the guild rail while the name/status live in the room
   list's track. */
.tumult-userbar {
    display: grid;
    grid-template-columns: var(--layout-guild-rail-width) minmax(0, 1fr) auto;
    align-items: center;
    gap: 0 var(--userbar-gap);
    height: var(--userbar-height);
    min-width: 0;
    padding-right: var(--userbar-padding-x);
    border-top: var(--border-width) solid var(--userbar-border);
    background: var(--userbar-bg);
}
.tumult-userbar[data-compact="true"] {
    grid-template-columns: var(--layout-guild-rail-width);
    padding-right: 0;
}
.tumult-account {
    justify-self: center;
    display: flex;
    padding: var(--space-1);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--motion-ease);
}
.tumult-account:hover {
    background: var(--rail-item-bg-hover);
}
.tumult-account:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
.tumult-userbar-avatar {
    position: relative;
    display: inline-flex;
}
.tumult-userbar-dot {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--presence-dot-size);
    height: var(--presence-dot-size);
    border: var(--border-width-medium) solid var(--userbar-bg);
    border-radius: var(--radius-full);
}
.tumult-userbar-dot[data-presence="online"] {
    background: var(--success);
}
.tumult-userbar-dot[data-presence="unavailable"] {
    background: var(--warning);
}
.tumult-userbar-dot[data-presence="offline"] {
    background: var(--text-muted);
}
.tumult-userbar-dot[data-presence="unknown"] {
    border-color: var(--text-muted);
    background: var(--userbar-bg);
}
.tumult-userbar-id {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: var(--leading-tight);
}
.tumult-userbar-name {
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
    text-overflow: ellipsis;
}
.tumult-userbar-status {
    display: flex;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
}
.tumult-userbar-status:hover {
    color: var(--text-primary);
}
.tumult-userbar-status:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
.tumult-userbar-status-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.tumult-userbar-status-hint {
    color: var(--text-muted);
}
.tumult-userbar-status:hover .tumult-userbar-status-hint {
    color: var(--text-primary);
}
.tumult-userbar-gear {
    justify-self: end;
}
</style>

<style>
.tumult-menu {
    min-width: var(--menu-min-width);
    padding: var(--space-1);
    border: var(--border-width) solid var(--menu-border);
    border-radius: var(--control-radius);
    background: var(--menu-bg);
    color: var(--text-primary);
}
.tumult-menu-id {
    padding: var(--space-1-5) var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
}
.tumult-menu-name {
    display: block;
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
}
.tumult-menu-devices {
    max-height: var(--menu-devices-max-height);
    overflow-y: auto;
    border-top: var(--border-width) solid var(--border-default);
    border-bottom: var(--border-width) solid var(--border-default);
    margin: var(--space-1) 0;
    padding: var(--space-1) 0;
}
.tumult-menu-devices ul {
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-menu-device {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.tumult-menu-device-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-menu-item {
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    cursor: pointer;
    outline: none;
}
.tumult-menu-item[data-highlighted] {
    background: var(--roomlist-item-bg-hover);
}
/* Submenu trigger: label left, chevron right. */
.tumult-menu-sub-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.tumult-menu-chevron {
    margin-left: auto;
    color: var(--text-muted);
}
.tumult-menu-separator {
    height: var(--border-width);
    margin: var(--space-1) 0;
    background: var(--border-default);
}
/* Destructive item: red label, and the highlight inverts to a danger fill —
   the same pairing as the danger dialog button. */
.tumult-menu-item-danger {
    color: var(--menu-item-danger);
}
.tumult-menu-item-danger[data-highlighted] {
    background: var(--danger);
    color: var(--text-on-danger);
}
</style>
