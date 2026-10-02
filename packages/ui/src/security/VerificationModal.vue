<script setup lang="ts">
import { ref, watch } from "vue";
import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
} from "reka-ui";
import type { ChatClient, VerificationRequestView } from "@tumult/core";
import { useSubscribable } from "../subscribable.ts";

const props = defineProps<{
    client: ChatClient;
    open: boolean;
}>();

const emit = defineEmits<{
    close: [];
}>();

type Phase = "waiting" | "incoming" | "sas" | "done" | "error";
const phase = ref<Phase>("waiting");
const sasEmoji = ref<[string, string][] | null>(null);
const sasDecimal = ref<[number, number, number] | null>(null);
const error = ref("");
const incomingFrom = ref("");

const verification = useSubscribable(props.client.verification);

function onOpenChange(next: boolean): void {
    if (!next) emit("close");
}

watch(
    () => props.open,
    (isOpen) => {
        if (!isOpen) {
            phase.value = "waiting";
            sasEmoji.value = null;
            sasDecimal.value = null;
            incomingFrom.value = "";
            error.value = "";
        }
    },
);

async function start(): Promise<void> {
    try {
        await props.client.startVerification();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        phase.value = "error";
    }
}

// Watch the verification feed for SAS data
watch(
    verification,
    (state) => {
        const req = currentRequest();
        if (!req) return;

        if (req.sasEmoji) sasEmoji.value = req.sasEmoji;
        if (req.sasDecimal) sasDecimal.value = req.sasDecimal;

        if (!req.initiatedByMe && (req.phase === "requested" || req.phase === "ready")) {
            incomingFrom.value = req.otherDeviceId ?? req.otherUserId;
            if (phase.value === "waiting") phase.value = "incoming";
        }

        if (req.phase === "started") phase.value = "sas";
        if (req.phase === "done") phase.value = "done";
        if (req.phase === "cancelled") phase.value = "error";
    },
    { immediate: true },
);

// Start verification if we initiated it and no requests are active
watch(
    () => props.open,
    (isOpen) => {
        if (isOpen && verification.value.requests.length === 0) {
            start();
        }
    },
);

async function acceptIncoming(): Promise<void> {
    const req = currentRequest();
    if (!req) return;
    phase.value = "waiting";
    try {
        await props.client.acceptVerification(req.id);
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        phase.value = "error";
    }
}

async function confirm(): Promise<void> {
    const req = currentRequest();
    if (!req) return;
    try {
        await props.client.confirmSas(req.id);
        phase.value = "done";
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        phase.value = "error";
    }
}

async function mismatch(): Promise<void> {
    const req = currentRequest();
    if (!req) return;
    try {
        await props.client.mismatchSas(req.id);
        phase.value = "error";
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        phase.value = "error";
    }
}

function cancel(): void {
    const req = currentRequest();
    if (!req) return;
    props.client.declineVerification(req.id);
    phase.value = "error";
}

const PHASE_RANK: Record<string, number> = {
    started: 4,
    ready: 3,
    requested: 2,
    unsent: 1,
    done: 0,
    cancelled: -1,
};

/**
 * Pick the request to display: furthest-along live request wins, so a stale
 * early request never pins the modal while a newer flow advances behind it.
 */
function pickRequest(requests: readonly VerificationRequestView[]): VerificationRequestView | undefined {
    let best: VerificationRequestView | undefined;
    for (const r of requests) {
        if (r.phase === "done" || r.phase === "cancelled") {
            if (best && best.phase !== "done" && best.phase !== "cancelled") continue;
            if (!best) best = r;
            continue;
        }
        if (!best || (PHASE_RANK[r.phase] ?? 0) >= (PHASE_RANK[best.phase] ?? 0)) best = r;
    }
    return best;
}

function currentRequest(): VerificationRequestView | undefined {
    return pickRequest(verification.value.requests);
}

function formatEmoji(emoji: [string, string][]): string {
    return emoji.map(([e, name]) => `${e} (${name})`).join("  ");
}

function formatDecimal(dec: [number, number, number]): string {
    return dec.map((n) => String(n).padStart(5, "0")).join("  ");
}
</script>

<template>
    <DialogRoot :open="open" @update:open="onOpenChange">
        <DialogPortal>
            <DialogOverlay class="tumult-dialog-overlay" />
            <DialogContent class="tumult-dialog tumult-verification-modal" :class="phase">
                <DialogTitle class="tumult-dialog-title">
                    <template v-if="phase === 'waiting'">Waiting for verification…</template>
                    <template v-if="phase === 'incoming'">Verification request</template>
                    <template v-if="phase === 'sas'">Verify SAS</template>
                    <template v-if="phase === 'done'">Verified</template>
                    <template v-if="phase === 'error'">Verification failed</template>
                </DialogTitle>
                <DialogDescription class="tumult-dialog-desc" v-if="phase === 'waiting'">
                    Waiting for the other device to accept the verification request…
                </DialogDescription>
                <DialogDescription class="tumult-dialog-desc" v-if="phase === 'incoming'">
                    {{ incomingFrom || "Another device" }} wants to verify. Accept to compare emojis.
                </DialogDescription>
                <DialogDescription class="tumult-dialog-desc" v-if="phase === 'sas'">
                    Compare the emojis (or numbers) with the other device. They must match exactly.
                </DialogDescription>
                <p v-if="phase === 'sas' && sasEmoji" class="tumult-sas-emoji">
                    {{ formatEmoji(sasEmoji) }}
                </p>
                <p v-if="phase === 'sas' && sasDecimal" class="tumult-sas-decimal">
                    {{ formatDecimal(sasDecimal) }}
                </p>
                <p v-if="phase === 'done'" class="tumult-dialog-status">
                    This device is now verified. Encrypted history will decrypt as keys arrive.
                </p>
                <p v-if="phase === 'error'" class="tumult-dialog-error" role="alert">
                    {{ error || "Verification was cancelled or failed." }}
                </p>

                <div class="tumult-dialog-actions">
                    <DialogClose v-if="phase === 'waiting' || phase === 'error' || phase === 'done'" as-child>
                        <button type="button" class="tumult-dialog-button tumult-dialog-primary">
                            {{ phase === "done" ? "Done" : "Close" }}
                        </button>
                    </DialogClose>
                    <button v-if="phase === 'sas'" type="button" class="tumult-dialog-button tumult-dialog-primary" @click="confirm">
                        They match
                    </button>
                    <button v-if="phase === 'sas'" type="button" class="tumult-dialog-button" @click="mismatch">
                        They don't match
                    </button>
                    <button v-if="phase === 'sas'" type="button" class="tumult-dialog-button" @click="cancel">
                        Cancel
                    </button>
                    <button v-if="phase === 'waiting'" type="button" class="tumult-dialog-button" @click="cancel">
                        Cancel
                    </button>
                    <button v-if="phase === 'incoming'" type="button" class="tumult-dialog-button tumult-dialog-primary" @click="acceptIncoming">
                        Accept
                    </button>
                    <button v-if="phase === 'incoming'" type="button" class="tumult-dialog-button" @click="cancel">
                        Decline
                    </button>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
.tumult-verification-modal {
    --width: min(28rem, calc(100vw - 2rem));
}
.tumult-dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
}
.tumult-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: var(--width);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    color: var(--text-primary);
}
.tumult-dialog:focus-visible {
    outline: 2px solid var(--focus-ring-color);
}
.tumult-dialog-title {
    margin: 0 0 var(--space-1);
    font-size: var(--text-md);
}
.tumult-dialog-desc {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-sas-emoji {
    font-size: 1.5rem;
    letter-spacing: 0.5em;
    text-align: center;
    margin: var(--space-3) 0;
    user-select: none;
}
.tumult-sas-decimal {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    letter-spacing: 0.25em;
    text-align: center;
    margin: var(--space-3) 0;
}
.tumult-dialog-status {
    color: var(--success);
    font-weight: 600;
    text-align: center;
    margin: var(--space-3) 0;
}
.tumult-dialog-error {
    color: var(--danger);
    text-align: center;
    margin: var(--space-3) 0;
}
.tumult-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
}
.tumult-dialog-button {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
}
.tumult-dialog-button:hover:not(:disabled) {
    background: var(--roomlist-item-bg-hover);
}
.tumult-dialog-primary {
    border: none;
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: 600;
}
.tumult-dialog-primary:hover:not(:disabled) {
    background: var(--button-primary-bg-hover);
}
.tumult-dialog-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>