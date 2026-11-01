<script setup lang="ts">
import Icon from "../icons/Icon.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CallState, ChatClient } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";

// Mounted by the shell for as long as a call exists; the frame inside must stay
// mounted while the user browses other rooms, or navigating away would drop the
// call. So "not viewing the call's room" is a CSS state, never a `v-if`.
const props = defineProps<{
    client: ChatClient;
    /** The room the shell is showing, or undefined (a workspace pane, no room). */
    activeRoomId: string | undefined;
}>();

const emit = defineEmits<{
    /** Show the room the call is in. */
    return: [roomId: string];
}>();

const call = useSubscribable(props.client.call);
const rooms = useSubscribable(props.client.rooms);

const roomName = computed(() => rooms.value.find((room) => room.id === call.value?.roomId)?.name ?? "Call");
// What the host can honestly know. "joined" is the call app reporting the user
// joined — not that media flows (its own errors show only inside the frame),
// so it is "In call", never "Connected".
const STATE_LABEL: Record<CallState, string> = {
    connecting: "Connecting…",
    joined: "In call",
    ended: "Call ended",
    error: "Could not connect",
};
const focused = computed(() => call.value !== null && call.value.roomId === props.activeRoomId);

const frame = ref<HTMLIFrameElement | null>(null);
let detach: (() => void) | null = null;

// Wire the transport once the frame exists, and again for each new call (the
// frame is keyed by room, so a different call is a different element). The
// effect re-runs on the frame ref, not on the call, so a state change
// (connecting → joined) does not re-attach.
watch(
    frame,
    (el) => {
        detach?.();
        detach = null;
        if (el) detach = props.client.attachCall(el);
    },
    { flush: "post" },
);

onBeforeUnmount(() => {
    detach?.();
    detach = null;
});

function leave(): void {
    void props.client.leaveCall().catch((error: unknown) => console.error("[tumult] could not leave the call", error));
}
</script>

<template>
    <section v-if="call" class="tumult-call" :data-focused="focused ? 'true' : 'false'" aria-label="Call">
        <header class="tumult-call-bar">
            <button
                type="button"
                class="tumult-call-title"
                :disabled="focused"
                :aria-label="focused ? roomName : `Return to the call in ${roomName}`"
                @click="emit('return', call.roomId)"
            >
                <Icon :name="call.video ? 'video' : 'phone'" />
                <span class="tumult-call-name">{{ roomName }}</span>
                <span class="tumult-call-state" role="status">
                    {{ STATE_LABEL[call.state] }}
                </span>
            </button>
            <button type="button" class="tumult-call-leave" aria-label="Leave call" title="Leave call" @click="leave">
                <Icon name="phone-hangup" />
            </button>
        </header>
        <!-- allow: the call app captures the mic/camera/screen itself, and
             `autoplay` lets remote audio start without a gesture inside the frame.
             sandbox: it needs scripts and its own origin; it must NOT be served from
             our origin (allow-same-origin would then defeat the sandbox). -->
        <iframe
            :key="call.roomId"
            ref="frame"
            class="tumult-call-frame"
            :src="call.url"
            title="Call"
            allow="microphone; camera; display-capture; autoplay; clipboard-write"
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"
        />
        <p v-if="call.state === 'error'" class="tumult-call-error" role="alert">
            The call app did not respond. Check that the call server is reachable, then leave and try again.
        </p>
    </section>
</template>

<style scoped>
.tumult-call {
    position: absolute;
    z-index: var(--z-panel);
    display: flex;
    flex-direction: column;
    background: var(--surface-pane);
    border: var(--border-width) solid var(--border-default);
}
/* Viewing the call's room: cover the timeline. */
.tumult-call[data-focused="true"] {
    inset: 0;
}
/* Elsewhere: a bar in the corner. The frame stays in the DOM (the call keeps
   running); it just has no visible area. */
.tumult-call[data-focused="false"] {
    inset: auto var(--space-3) var(--space-3) auto;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
}
.tumult-call-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
}
.tumult-call-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
}
.tumult-call-title:disabled {
    cursor: default;
}
.tumult-call-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--weight-semibold);
}
.tumult-call-state {
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-call-leave {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-md);
    height: var(--control-md);
    border: none;
    border-radius: var(--control-radius);
    background: var(--danger);
    color: var(--text-on-danger);
    font-size: var(--icon-md);
    cursor: pointer;
}
.tumult-call-leave:hover {
    background: var(--danger-hover);
}
.tumult-call-frame {
    flex: 1 1 auto;
    min-height: 0;
    border: none;
    background: var(--surface-inset);
}
.tumult-call[data-focused="false"] .tumult-call-frame {
    flex: none;
    width: var(--space-px);
    height: var(--space-px);
    opacity: 0;
    pointer-events: none;
}
.tumult-call-error {
    margin: 0;
    padding: var(--space-3);
    color: var(--danger);
}
</style>
