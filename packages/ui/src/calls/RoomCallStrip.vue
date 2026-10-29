<script setup lang="ts">
import { computed } from "vue";
import type { ChatClient, MemberView, Subscribable } from "@tumult/core";

import Avatar from "../primitives/Avatar.vue";
import Icon from "../icons/Icon.vue";
import { useSubscribable } from "../subscribable.ts";
import { useVoiceRooms } from "./voiceRooms.ts";
import { buildCallStrip } from "./callStrip.ts";

// The strip above a room's timeline while that room has a voice session: who
// is in it, who is speaking, and the way in or out. Renders nothing for a room
// with no call. The parent keys it on roomId, so the members feed is
// subscribed once per room (the MembersPane rule).
const props = defineProps<{ client: ChatClient; roomId: string }>();

/** Faces before the rest collapse into "+N". */
const MAX_FACES = 8;

const voice = useSubscribable(props.client.voice);
const session = useSubscribable(props.client.session);
const voiceRooms = useVoiceRooms();

// members() throws before start(); a missing feed just means ids for names.
let memberSource: Subscribable<MemberView[]> | null = null;
try {
    memberSource = props.client.members(props.roomId);
} catch {
    memberSource = null;
}
const members = memberSource ? useSubscribable(memberSource) : null;

const strip = computed(() =>
    buildCallStrip(props.roomId, voice.value, voiceRooms.value, members?.value ?? [], session.value?.userId ?? null),
);
const faces = computed(() => strip.value?.people.slice(0, MAX_FACES) ?? []);
const overflow = computed(() => Math.max(0, (strip.value?.people.length ?? 0) - MAX_FACES));

const status = computed(() => {
    const s = strip.value;
    if (!s) return "";
    const count = `${s.people.length} ${s.people.length === 1 ? "person" : "people"}`;
    switch (s.state) {
        case "connected":
            return `You're in voice · ${count}`;
        case "connecting":
            return "Joining voice…";
        case "reconnecting":
            return "Reconnecting…";
        case "error":
            return voice.value?.error ?? "Could not connect";
        default:
            return `Voice call · ${count}`;
    }
});

function log(action: string): (error: unknown) => void {
    return (error) => console.error(`[tumult] could not ${action}`, error);
}
function join(): void {
    void props.client.joinVoice(props.roomId).catch(log("join voice"));
}
function leave(): void {
    void props.client.leaveVoice().catch(log("leave voice"));
}
function toggleMute(): void {
    if (voice.value) void props.client.setVoiceMuted(!voice.value.muted).catch(log("change the microphone"));
}
</script>

<template>
    <section
        v-if="strip"
        class="tumult-callstrip"
        :data-state="strip.state ?? 'idle'"
        aria-label="Voice call in this room"
    >
        <Icon name="phone" class="tumult-callstrip-icon" />
        <span class="tumult-callstrip-status" role="status">{{ status }}</span>
        <ul class="tumult-callstrip-people" aria-label="In the call">
            <li
                v-for="person in faces"
                :key="person.userId"
                class="tumult-callstrip-person"
                :data-speaking="person.speaking || undefined"
                :title="person.isSelf ? `${person.name} (you)` : person.name"
            >
                <Avatar :label="person.name" :src="person.avatarUrl" size="sm" />
                <span v-if="person.muted" class="tumult-callstrip-muted" aria-label="Muted">
                    <Icon name="microphone-off" />
                </span>
            </li>
            <li v-if="overflow > 0" class="tumult-callstrip-more">+{{ overflow }}</li>
        </ul>
        <div class="tumult-callstrip-actions">
            <template v-if="strip.joined">
                <button
                    type="button"
                    class="tumult-callstrip-button"
                    :aria-pressed="voice?.muted ?? false"
                    :aria-label="voice?.muted ? 'Unmute microphone' : 'Mute microphone'"
                    :title="voice?.muted ? 'Unmute microphone' : 'Mute microphone'"
                    @click="toggleMute"
                >
                    <Icon :name="voice?.muted ? 'microphone-off' : 'microphone'" />
                </button>
                <button type="button" class="tumult-callstrip-leave" @click="leave">
                    <Icon name="phone-hangup" />Leave
                </button>
            </template>
            <button v-else type="button" class="tumult-callstrip-join" @click="join">
                <Icon name="phone" />Join
            </button>
        </div>
    </section>
</template>

<style scoped>
.tumult-callstrip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    background: var(--surface-raised);
    border-bottom: var(--border-width) solid var(--border-default);
    font-size: var(--text-sm);
    color: var(--text-secondary);
}
.tumult-callstrip-icon {
    color: var(--success);
    flex-shrink: 0;
}
.tumult-callstrip[data-state="connecting"] .tumult-callstrip-icon,
.tumult-callstrip[data-state="reconnecting"] .tumult-callstrip-icon {
    color: var(--warning);
}
.tumult-callstrip[data-state="error"] .tumult-callstrip-icon,
.tumult-callstrip[data-state="error"] .tumult-callstrip-status {
    color: var(--danger);
}
.tumult-callstrip-status {
    flex-shrink: 0;
    font-weight: var(--weight-semibold);
}
.tumult-callstrip-people {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: hidden;
}
.tumult-callstrip-person {
    position: relative;
    display: inline-flex;
    border-radius: var(--radius-full);
    outline: var(--border-width-medium) solid transparent;
    outline-offset: var(--space-px);
    transition: outline-color var(--motion-fast) var(--motion-ease);
}
/* The speaking ring is the only live signal, so it must not shift layout. */
.tumult-callstrip-person[data-speaking] {
    outline-color: var(--success);
}
.tumult-callstrip-muted {
    position: absolute;
    right: calc(var(--space-0-5) * -1);
    bottom: calc(var(--space-0-5) * -1);
    display: inline-flex;
    border-radius: var(--radius-full);
    background: var(--surface-raised);
    color: var(--danger);
    font-size: var(--text-xs);
}
.tumult-callstrip-more {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-callstrip-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
}
.tumult-callstrip-button,
.tumult-callstrip-join,
.tumult-callstrip-leave {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: var(--control-sm);
    border: none;
    border-radius: var(--control-radius);
    font: inherit;
    font-weight: var(--weight-semibold);
    cursor: pointer;
}
.tumult-callstrip-button {
    width: var(--control-sm);
    background: transparent;
    color: var(--text-secondary);
}
.tumult-callstrip-button:hover {
    background: var(--surface-hover);
}
.tumult-callstrip-button[aria-pressed="true"] {
    color: var(--danger);
}
.tumult-callstrip-join {
    padding: 0 var(--space-3);
    background: var(--accent);
    color: var(--accent-contrast);
}
.tumult-callstrip-join:hover {
    background: var(--accent-hover);
}
.tumult-callstrip-leave {
    padding: 0 var(--space-3);
    background: var(--danger);
    color: var(--text-on-danger);
}
.tumult-callstrip-leave:hover {
    background: var(--danger-hover);
}
</style>
