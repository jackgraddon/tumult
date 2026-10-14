<script setup lang="ts">
import { ref } from "vue";
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuTrigger,
} from "reka-ui";
import type { ChatClient, DeviceView, SessionView } from "@tumult/core";

import Avatar from "../primitives/Avatar.vue";
import { useSubscribable } from "../subscribable.ts";

const props = defineProps<{
    session: SessionView | null;
    client: ChatClient;
}>();

const emit = defineEmits<{
    signOut: [];
    security: [];
    verify: [];
    profile: [];
    settings: [];
}>();

// Unlike members(), the profile feed always exists (it's a plain field, not
// bootstrapped in start()), so reading it before start() is safe.
const profile = useSubscribable(props.client.profile);

const devices = ref<DeviceView[] | null>(null);

async function onOpenChange(open: boolean, client: ChatClient): Promise<void> {
    if (!open) return;
    try {
        devices.value = await client.listDevices();
    } catch {
        devices.value = null;
    }
}</script>

<template>
    <DropdownMenuRoot @update:open="(open) => onOpenChange(open, client)">
        <DropdownMenuTrigger as-child>
            <button type="button" class="tumult-account" :aria-label="session ? `Account: ${session.userId}` : 'Account'">
                <Avatar :label="profile?.displayName ?? session?.userId ?? '?'" :src="profile?.avatarUrl" size="sm" />
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
                            <span aria-hidden="true">{{ d.verified ? "🛡️" : "⚠️" }}</span>
                            <span class="tumult-menu-device-name">{{ d.displayName ?? d.id }}{{ d.isCurrent ? " (this device)" : "" }}</span>
                        </li>
                    </ul>
                </div>
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
</template>

<style scoped>
.tumult-account {
    display: flex;
    padding: var(--space-1);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    cursor: pointer;
}
.tumult-account:hover {
    background: var(--rail-item-bg-hover);
}
.tumult-account:focus-visible {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
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
</style>
