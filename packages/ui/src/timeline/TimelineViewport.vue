<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { MessageView } from "@tumult/core";

import TimelineRow from "./TimelineRow.vue";

const props = defineProps<{
    messages: readonly MessageView[];
    /** Paginate one history page; resolves false at the start of history. */
    loadMore: () => Promise<boolean>;
    /** Toggle our reaction; absent while the client can't react. */
    onToggleReaction?: ((targetEventId: string, emoji: string) => void) | undefined;
    /** Fired when the live tail is visible (mount + pinned growth). Drives read receipts. */
    onReadLatest?: (() => void) | undefined;
    /** Our user id; the edit affordance shows only on our sent messages. */
    ownUserId?: (string | null) | undefined;
    /** Save an edit; absent while the client can't edit. */
    onEditMessage?: ((targetEventId: string, newBody: string) => void) | undefined;
    /** Redact (delete) a message; absent while the client can't redact. */
    onRedactMessage?: ((targetEventId: string) => void) | undefined;
    /** The room's `m.fully_read` marker; drives the "New messages" divider. */
    fullyReadEventId?: string | null | undefined;
    /** Search hit jump: center this event id and flash it briefly. */
    focusRequest?: { id: string; nonce: number } | null | undefined;
    /** Open a thread on a message. */
    onOpenThread?: ((rootEventId: string) => void) | undefined;
    /** Start an inline reply to a message. */
    onReply?: ((message: MessageView) => void) | undefined;
    /** rootEventId -> reply count, for the reply link on thread roots. */
    threadReplies?: ReadonlyMap<string, number> | undefined;
}>();

interface Row {
    key: string;
    message: MessageView;
    grouped: boolean;
    dayLabel: string | null;
    /** True when the message directly follows the fully-read marker. */
    unreadBefore: boolean;
}

function dayLabel(ts: number): string {
    return new Date(ts).toLocaleDateString("en", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

const rows = computed<Row[]>(() => {
    const out: Row[] = [];
    let prevDayKey = "";
    let prevSender = "";
    const marker = props.fullyReadEventId;
    for (let i = 0; i < props.messages.length; i++) {
        const m = props.messages[i];
        if (!m) continue;
        const dayKey = new Date(m.timestamp).toDateString();
        const newDay = dayKey !== prevDayKey;
        out.push({
            key: m.id,
            message: m,
            grouped: !newDay && m.senderId === prevSender && m.decryption === "ok",
            dayLabel: newDay ? dayLabel(m.timestamp) : null,
            // The divider sits on the first message NEWER than the marker —
            // i.e. the row right after the marker itself.
            unreadBefore: marker != null && props.messages[i - 1]?.id === marker,
        });
        prevDayKey = dayKey;
        prevSender = m.senderId;
    }
    return out;
});

const scroller = ref<HTMLElement | null>(null);
const hasMore = ref(true);
const loadingMore = ref(false);
let scrollQueued = false;

const virtualizerOptions = computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: (index: number) => {
        const row = rows.value[index];
        // Unmeasured estimate only: the divider's real height lands in
        // measureElement, but start close so prepends don't jump.
        if (row?.unreadBefore) return row.dayLabel ? 64 : 92;
        return row?.dayLabel ? 40 : 68;
    },
    overscan: 10,
}));
const virtualizer = useVirtualizer(virtualizerOptions);

function measure(el: unknown): void {
    if (el instanceof HTMLElement) virtualizer.value.measureElement(el);
}

function isNearBottom(): boolean {
    const el = scroller.value;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function pinToBottom(): void {
    const last = rows.value.length - 1;
    if (last >= 0) virtualizer.value.scrollToIndex(last, { align: "end" });
}

onMounted(() => {
    pinToBottom();
    // A pinned tail on open means the latest message is visible: report it
    // so our read receipt sends.
    if (isNearBottom()) props.onReadLatest?.();
    // Fill-forward: short histories never overflow the viewport, so no
    // scroll event will ever fire to trigger pagination. Backfill until the
    // content is scrollable or history runs out.
    void nextTick(() => void fillIfShort());
});

// Keep the view pinned while new messages arrive at the bottom; never yank
// the user out of history they scrolled up to read. A prepended history page
// can also leave the viewport unfilled — fill forward again in that case.
// A pinned tail on growth means the latest message is visible: report it.
watch(
    () => props.messages.length,
    () => {
        if (isNearBottom()) {
            void nextTick(() => pinToBottom());
            props.onReadLatest?.();
        }
        void nextTick(() => void fillIfShort());
    },
);

// Search jump: center the hit once its row exists (jumpTo already paged it
// into the window), then pulse it so the eye doesn't hunt for the row.
const flashEventId = ref<string | null>(null);
let flashTimer: number | undefined;
watch(
    () => props.focusRequest,
    (request) => {
        if (!request) return;
        void nextTick(() => {
            const index = rows.value.findIndex((r) => r.message.id === request.id);
            if (index < 0) return;
            virtualizer.value.scrollToIndex(index, { align: "center" });
            flashEventId.value = request.id;
            window.clearTimeout(flashTimer);
            flashTimer = window.setTimeout(() => {
                flashEventId.value = null;
            }, 2400);
        });
    },
);

/** True when the user cannot scroll up into history: nothing to paginate from. */
function needsFill(): boolean {
    const el = scroller.value;
    if (!el) return false;
    return el.scrollHeight <= el.clientHeight + 160;
}

async function fillIfShort(): Promise<void> {
    if (!needsFill()) return;
    await maybeLoadMore(true);
}

async function maybeLoadMore(fill = false): Promise<void> {
    const el = scroller.value;
    if (!el || loadingMore.value || !hasMore.value) return;
    // Scroll-driven loads require the user to be near the top; fill-forward
    // loads require the viewport to be unfilled.
    if (fill ? !needsFill() : el.scrollTop > 160) return;
    const before = props.messages.length;
    loadingMore.value = true;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    try {
        hasMore.value = await props.loadMore();
    } finally {
        loadingMore.value = false;
    }
    if (props.messages.length === before) {
        // A page that adds nothing means the server has nothing more to
        // give (or a gap we won't fill): stop instead of looping forever.
        hasMore.value = false;
        return;
    }
    await nextTick();
    // Prepending history grows the spacer above the viewport: shift scrollTop
    // by the delta so the visible rows don't jump.
    el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
}

function onScroll(): void {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
        scrollQueued = false;
        void maybeLoadMore();
    });
}

/**
 * Plain overflow-y scroller — NOT Reka ScrollArea. The timeline needs precise
 * scrollTop, overflow-anchor and the virtualizer on the real scroll container,
 * all of which a wrapped viewport would hide.
 */

// Sender profiles seen in this window, newest wins, so read-receipt avatars
// can show real faces without a separate member lookup.
const profiles = computed(() => {
    const out = new Map<string, { name: string; avatarUrl: string | null }>();
    for (const m of props.messages) out.set(m.senderId, { name: m.senderName, avatarUrl: m.senderAvatarUrl });
    return out;
});
</script>

<template>
    <div ref="scroller" class="tumult-viewport" tabindex="0" aria-label="Message history" @scroll="onScroll">
        <div
            class="tumult-virtual-spacer"
            :style="{ height: `${virtualizer.getTotalSize()}px` }"
        >
            <div
                v-for="v in virtualizer.getVirtualItems()"
                :key="rows[v.index]?.key ?? v.index"
                :data-index="v.index"
                :data-flash="flashEventId && rows[v.index]?.message.id === flashEventId ? 'on' : undefined"
                :ref="measure"
                class="tumult-virtual-row"
                :style="{ transform: `translateY(${v.start}px)` }"
            >
                <template v-if="rows[v.index] as Row | undefined">
                    <div v-if="rows[v.index]?.unreadBefore" class="tumult-unread" role="separator">
                        <span>New messages</span>
                    </div>
                    <div v-if="rows[v.index]?.dayLabel" class="tumult-day" role="separator">
                        <span>{{ rows[v.index]?.dayLabel }}</span>
                    </div>
                    <TimelineRow
                        v-if="rows[v.index]?.message"
                        :message="(rows[v.index] as Row).message"
                        :grouped="(rows[v.index] as Row).grouped"
                        :on-toggle-reaction="onToggleReaction"
                        :own-user-id="ownUserId"
                        :on-edit-message="onEditMessage"
                        :on-redact-message="onRedactMessage"
                        :on-open-thread="onOpenThread"
                        :on-reply="onReply"
                        :profiles="profiles"
                        :thread-reply-count="threadReplies?.get((rows[v.index] as Row).message.id) ?? 0"
                    />
                </template>
            </div>
        </div>
        <p v-if="loadingMore" class="tumult-history-loading" role="status">Loading history…</p>
        <p v-if="rows.length === 0 && !loadingMore" class="tumult-empty">No messages yet.</p>
    </div>
</template>

<style scoped>
.tumult-viewport {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-anchor: auto;
    background: var(--timeline-bg);
    position: relative;
}
.tumult-virtual-spacer {
    position: relative;
    width: 100%;
}
.tumult-virtual-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
}
.tumult-virtual-row[data-flash="on"] {
    animation: tumult-flash 2.4s ease-out;
}
@keyframes tumult-flash {
    0%,
    35% {
        background: var(--timeline-mention-bg);
    }
    100% {
        background: transparent;
    }
}
/* Motion-minimal systems: static tint instead of a pulse. */
@media (prefers-reduced-motion: reduce) {
    .tumult-virtual-row[data-flash="on"] {
        animation: none;
        background: var(--timeline-mention-bg);
        outline: 2px solid var(--focus-ring-color);
        outline-offset: -2px;
    }
}
.tumult-day {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    color: var(--timeline-day-divider);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.tumult-day::before,
.tumult-day::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--border-default);
}
.tumult-unread {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    color: var(--timeline-unread-divider);
    font-size: var(--text-xs);
    font-weight: 700;
}
.tumult-unread::before,
.tumult-unread::after {
    content: "";
    flex: 1;
    border-top: 2px solid var(--timeline-unread-divider);
}
.tumult-history-loading {
    position: sticky;
    top: 0;
    margin: 0;
    padding: var(--space-1);
    text-align: center;
    color: var(--text-muted);
    font-size: var(--text-xs);
    background: var(--timeline-bg);
}
.tumult-empty {
    padding: var(--space-4);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
