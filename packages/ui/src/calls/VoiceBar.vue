<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { computed } from "vue";
import type { ChatClient } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";

// The native voice session's controls. Sits at the foot of the room-list track,
// above the user bar, and renders nothing outside a session.
const props = defineProps<{ client: ChatClient }>();

const voice = useSubscribable(props.client.voice);
const rooms = useSubscribable(props.client.rooms);

const roomName = computed(() => rooms.value.find((room) => room.id === voice.value?.roomId)?.name ?? "Voice");
const status = computed(() => {
    switch (voice.value?.state) {
        case "connected":
            return "Voice connected";
        case "reconnecting":
            return "Reconnecting…";
        case "error":
            return voice.value.error ?? "Could not connect";
        default:
            return "Connecting…";
    }
});
const speaking = computed(() => voice.value?.participants.filter((p) => p.speaking).length ?? 0);

function log(action: string): (error: unknown) => void {
    return (error) => console.error(`[tumult] could not ${action}`, error);
}
function toggleMute(): void {
    if (voice.value) void props.client.setVoiceMuted(!voice.value.muted).catch(log("change the microphone"));
}
function toggleDeafen(): void {
    if (voice.value) props.client.setVoiceDeafened(!voice.value.deafened);
}
function toggleCamera(): void {
    if (voice.value) void props.client.setVoiceCamera(!voice.value.camera).catch(log("change the camera"));
}
function toggleScreen(): void {
    if (voice.value) void props.client.setVoiceScreenShare(!voice.value.screen).catch(log("share the screen"));
}
function leave(): void {
    void props.client.leaveVoice().catch(log("leave voice"));
}
</script>

<template>
    <section v-if="voice" class="tumult-voice" :data-state="voice.state" aria-label="Voice">
        <div class="tumult-voice-info">
            <span class="tumult-voice-status" role="status" :title="status">{{ status }}</span>
            <span class="tumult-voice-room">
                {{ roomName }} · {{ voice.participants.length }}
                <span v-if="speaking > 0" class="tumult-voice-speaking" aria-label="Someone is speaking">●</span>
            </span>
        </div>
        <!-- A failed session has nothing to mute or share: offer only the way out,
             which also gives the status the width to be read. -->
        <div v-if="voice.state === 'error'" class="tumult-voice-controls">
            <button type="button" class="tumult-voice-button" aria-label="Dismiss" title="Dismiss" @click="leave">
                <Icon name="close" />
            </button>
        </div>
        <div v-else class="tumult-voice-controls">
            <button
                type="button"
                class="tumult-voice-button"
                :aria-pressed="voice.muted"
                :aria-label="voice.muted ? 'Unmute microphone' : 'Mute microphone'"
                :title="voice.muted ? 'Unmute microphone' : 'Mute microphone'"
                @click="toggleMute"
            >
                <Icon :name="voice.muted ? 'microphone-off' : 'microphone'" />
            </button>
            <button
                type="button"
                class="tumult-voice-button"
                :aria-pressed="voice.deafened"
                :aria-label="voice.deafened ? 'Undeafen' : 'Deafen'"
                :title="voice.deafened ? 'Undeafen' : 'Deafen'"
                @click="toggleDeafen"
            >
                <Icon :name="voice.deafened ? 'headphones-off' : 'headphones'" />
            </button>
            <button
                type="button"
                class="tumult-voice-button"
                :aria-pressed="voice.camera"
                :aria-label="voice.camera ? 'Turn off camera' : 'Turn on camera'"
                :title="voice.camera ? 'Turn off camera' : 'Turn on camera'"
                @click="toggleCamera"
            >
                <Icon :name="voice.camera ? 'video' : 'video-off'" />
            </button>
            <button
                type="button"
                class="tumult-voice-button"
                :aria-pressed="voice.screen"
                :aria-label="voice.screen ? 'Stop sharing screen' : 'Share screen'"
                :title="voice.screen ? 'Stop sharing screen' : 'Share screen'"
                @click="toggleScreen"
            >
                <Icon :name="voice.screen ? 'monitor-off' : 'monitor-share'" />
            </button>
            <button type="button" class="tumult-voice-button tumult-voice-leave" aria-label="Disconnect" title="Disconnect" @click="leave">
                <Icon name="phone-hangup" />
            </button>
        </div>
    </section>
</template>

<style scoped>
.tumult-voice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised);
    border-top: var(--border-width) solid var(--border-default);
}
.tumult-voice-info {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
}
.tumult-voice-status {
    color: var(--success);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
}
.tumult-voice[data-state="error"] .tumult-voice-status {
    color: var(--danger);
    /* Two lines at most: the full text is the tooltip. A long error used to
       stack one word per line up the whole room-list track. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
}
.tumult-voice[data-state="connecting"] .tumult-voice-status,
.tumult-voice[data-state="reconnecting"] .tumult-voice-status {
    color: var(--warning);
}
.tumult-voice-room {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-voice-speaking {
    color: var(--success);
}
.tumult-voice-controls {
    display: flex;
    gap: var(--space-1);
}
.tumult-voice-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-md);
    height: var(--control-md);
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--icon-md);
    cursor: pointer;
}
.tumult-voice-button:hover {
    background: var(--surface-hover);
}
.tumult-voice-button[aria-pressed="true"] {
    color: var(--danger);
}
.tumult-voice-leave:hover {
    background: var(--danger);
    color: var(--text-on-danger);
}
</style>
