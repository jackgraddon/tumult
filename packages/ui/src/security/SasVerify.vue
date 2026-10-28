<script setup lang="ts">
import { ref, watch } from "vue";
import type { ChatClient, VerificationRequestView } from "@tumult/core";
import { useSubscribable } from "../subscribable.ts";

const props = defineProps<{
    client: ChatClient;
    active: boolean;
}>();

const emit = defineEmits<{
    /** Return to the landing chooser without abandoning the request. */
    back: [];
    /** The flow is finished; the host decides what that closes. */
    done: [];
}>();

const phase = ref<"waiting" | "incoming" | "sas" | "done" | "error">("waiting");
const sasEmoji = ref<[string, string][] | null>(null);
const sasDecimal = ref<[number, number, number] | null>(null);
const error = ref("");
const incomingFrom = ref("");

const verification = useSubscribable(props.client.verification);

// No `DialogRoot`: this is the SAS path *inside* the security dialog, so a
// back/close button drives `use another device` ↔ landing, not a nested overlay.
watch(
    () => props.active,
    (isActive) => {
        if (!isActive) {
            phase.value = "waiting";
            sasEmoji.value = null;
            sasDecimal.value = null;
            incomingFrom.value = "";
            error.value = "";
            return;
        }
        // No pending request means we initiated: kick off the request.
        if (verification.value.requests.length === 0) void start();
    },
    { immediate: true },
);

async function start(): Promise<void> {
    try {
        await props.client.startVerification();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        phase.value = "error";
    }
}

// Drive the phase from the verification feed: SAS data, an incoming request,
// and the live transition waiting → incoming → sas → done/error.
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
    void props.client.declineVerification(req.id);
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
 * early request never pins the view while a newer flow advances behind it.
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
    <div class="tumult-sas">
        <h3 class="tumult-sas-title">
            <template v-if="phase === 'waiting'">Waiting for verification…</template>
            <template v-else-if="phase === 'incoming'">Verification request</template>
            <template v-else-if="phase === 'sas'">Verify SAS</template>
            <template v-else-if="phase === 'done'">Verified</template>
            <template v-else>Verification failed</template>
        </h3>
        <p v-if="phase === 'waiting'" class="tumult-dialog-desc">
            Waiting for the other device to accept the verification request…
        </p>
        <p v-if="phase === 'incoming'" class="tumult-dialog-desc">
            {{ incomingFrom || "Another device" }} wants to verify. Accept to compare emojis.
        </p>
        <p v-if="phase === 'sas'" class="tumult-dialog-desc">
            Compare the emojis (or numbers) with the other device. They must match exactly.
        </p>
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
            <button type="button" class="tumult-dialog-button" @click="emit('back')">Back</button>
            <template v-if="phase === 'waiting'">
                <button
                    type="button"
                    class="tumult-dialog-button tumult-dialog-primary"
                    @click="cancel"
                >
                    Cancel
                </button>
            </template>
            <template v-else-if="phase === 'incoming'">
                <button type="button" class="tumult-dialog-button" @click="cancel">Decline</button>
                <button
                    type="button"
                    class="tumult-dialog-button tumult-dialog-primary"
                    @click="acceptIncoming"
                >
                    Accept
                </button>
            </template>
            <template v-else-if="phase === 'sas'">
                <button type="button" class="tumult-dialog-button" @click="mismatch">
                    They don't match
                </button>
                <button
                    type="button"
                    class="tumult-dialog-button tumult-dialog-primary"
                    @click="confirm"
                >
                    They match
                </button>
            </template>
            <template v-else>
                <button type="button" class="tumult-dialog-button tumult-dialog-primary" @click="emit('done')">
                    {{ phase === 'done' ? "Done" : "Close" }}
                </button>
            </template>
        </div>
    </div>
</template>

<style scoped>
.tumult-sas-title {
    margin: 0 0 var(--space-1);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    text-align: center;
}
.tumult-dialog-desc {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-sas-emoji {
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-emoji-lg);
    text-align: center;
    margin: var(--space-3) 0;
    user-select: none;
}
.tumult-sas-decimal {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-emoji);
    text-align: center;
    margin: var(--space-3) 0;
}
.tumult-dialog-status {
    color: var(--success);
    font-weight: var(--weight-semibold);
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
    border: var(--border-width) solid var(--button-secondary-border);
    border-radius: var(--control-radius);
    background: var(--button-secondary-bg);
    color: var(--button-secondary-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
}
.tumult-dialog-button:hover:not(:disabled) {
    background: var(--button-secondary-bg-hover);
}
.tumult-dialog-primary {
    border: none;
    background: var(--button-primary-bg);
    color: var(--button-primary-text);
    font-weight: var(--weight-semibold);
}
.tumult-dialog-primary:hover:not(:disabled) {
    background: var(--button-primary-bg-hover);
}
</style>