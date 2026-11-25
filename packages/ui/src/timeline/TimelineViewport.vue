<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { MessageView, RoomPowerLevelsView } from "@tumult/core";

import { tryUseTheme } from "../theme/controls.ts";
import { densityRowDelta } from "../theme/density.ts";
import TimelineRow from "./TimelineRow.vue";
import { unreadDividerIndex } from "./unreadDivider.ts";

const props = defineProps<{
    messages: readonly MessageView[];
    /** The room these messages came from: the room half of a message link. */
    roomId: string;
    /** Power levels for that room, or null while unknown (then no moderation). */
    power: RoomPowerLevelsView | null;
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
    onRedactMessage?: ((targetEventId: string) => Promise<void>) | undefined;
    /** Retry a failed send; absent while the client can't retry. */
    onRetrySend?: ((eventId: string) => void) | undefined;
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

const dividerIndex = computed(() =>
    unreadDividerIndex(props.messages, props.fullyReadEventId, props.ownUserId),
);

const rows = computed<Row[]>(() => {
    const out: Row[] = [];
    let prevDayKey = "";
    let prevSender = "";
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
            unreadBefore: i === dividerIndex.value,
        });
        prevDayKey = dayKey;
        prevSender = m.senderId;
    }
    return out;
});

const scroller = ref<HTMLElement | null>(null);
const spacer = ref<HTMLElement | null>(null);
const hasMore = ref(true);
const loadingMore = ref(false);
let scrollQueued = false;

// Density is a document-level theme choice; the estimate must track it. Read
// through the theme seam rather than a prop so every timeline (main pane and
// thread panel) follows the active density without prop plumbing.
const theme = tryUseTheme();
const density = computed(() => theme?.state.value.density);

const virtualizerOptions = computed(() => ({
    count: rows.value.length,
    // Key measurements by event id, not array index. A history prepend or the
    // 500-event head drop shifts every index; with index keys the virtualizer
    // reuses one row's measured height for a completely different message and
    // the visible range jumps. The template already keys rows this way.
    getItemKey: (index: number) => rows.value[index]?.key ?? `empty-${index}`,
    getScrollElement: () => scroller.value,
    estimateSize: (index: number) => {
        const row = rows.value[index];
        // Unmeasured estimate only: the divider's real height lands in
        // measureElement, but start close so prepends don't jump. Density moves
        // the message row's own vertical padding.
        const delta = densityRowDelta(density.value);
        if (row?.unreadBefore) return (row.dayLabel ? 64 : 92) + delta;
        return (row?.dayLabel ? 40 : 68) + delta;
    },
    overscan: 10,
    // Keep content that is ABOVE the reading position anchored when a row
    // re-measures (an image finishes decoding, a reply is edited in, a pending
    // decryption lands). The virtualizer's default skips this while scrolling
    // backward, which is exactly when a layout shift is most disorienting.
    // Rows spanning the fold are deliberately left alone: growing them below
    // the top edge must not drag the reader down (#1218).
    shouldAdjustScrollPositionOnItemSizeChange: (item: { end: number }, _delta: number, instance: { scrollOffset: number | null }) => {
        return item.end <= (instance.scrollOffset ?? 0);
    },
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

/**
 * Jump to the bottom of the current spacer.
 *
 * The spacer is only an estimate until measureElement lands, so this is
 * re-run whenever it changes — see the size watcher below.
 */
function pinToBottom(): void {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
}

/** True while the view should keep tracking the latest message. */
const trackingTail = ref(false);

/** Report the live tail as visible; core ignores repeats for the same event. */
function reportTailVisible(): void {
    if (props.messages.length > 0) props.onReadLatest?.();
}

/**
 * Open (or switch to) a room at its latest message.
 *
 * The first batch can already be taller than the viewport, so `isNearBottom()`
 * is false before the first pin (measured: scrollTop 0 of 2802). Never use it
 * as an open guard: pin first, then report the tail as read. If the feed has
 * not published anything yet (a cold deep link), the tail watcher below does
 * the same work when it does arrive.
 */
async function openAtTail(): Promise<void> {
    trackingTail.value = true;
    await nextTick();
    pinToBottom();
    reportTailVisible();
}

onMounted(() => {
    void openAtTail();
    // Fill-forward: short histories never overflow the viewport, so no
    // scroll event will ever fire to trigger pagination. Backfill until the
    // content is scrollable or history runs out.
    void nextTick(() => void fillIfShort());
});

/**
 * Returning to an active window with the tail on screen is also "looking at
 * the messages". Catch the read marker up on focus/visibility rather than
 * leaving a stale "New messages" banner up until the next unrelated event.
 * Reading history keeps its place: we only report while tracking the tail.
 */
function onWindowActive(): void {
    if (document.visibilityState !== "visible") return;
    if (!trackingTail.value && !isNearBottom()) return;
    reportTailVisible();
}
onMounted(() => {
    window.addEventListener("focus", onWindowActive);
    document.addEventListener("visibilitychange", onWindowActive);
});
onScopeDispose(() => {
    window.removeEventListener("focus", onWindowActive);
    document.removeEventListener("visibilitychange", onWindowActive);
});

// Watch the tail EVENT, not `messages.length`: core caps a live window at 500
// messages, so a busy room keeps the same length while its newest message
// changes. Watching the first message had the same flaw in reverse — a head
// drop looked like a room switch and yanked a reader out of history.
watch(
    () => props.messages.at(-1)?.id ?? null,
    (id, previous) => {
        if (!id || id === previous) return;
        void nextTick(() => void fillIfShort());
        // A row can grow between the change and this callback (echo
        // confirmation, late decryption, media decode), so `isNearBottom()`
        // can read false for a frame while we are still tracking the tail.
        // Trust the latch first, then pin and report: vetoing on a stale
        // measurement here left our own sends below the fully-read marker
        // until somebody else posted and re-ran the read path.
        if (!trackingTail.value && !isNearBottom()) return;
        trackingTail.value = true;
        void nextTick(() => {
            pinToBottom();
            reportTailVisible();
        });
    },
);

// measureElement corrects the spacer after the estimate, so a jump to the
// current bottom would otherwise leave the tail stranded above the real
// bottom. React to the spacer's own height changing (that is the reliable
// trigger — the virtualizer gives no reactive hook on measurement updates)
// and re-jump while we still track the tail.
let pinQueued = false;
function onSpacerResize(): void {
    if (!trackingTail.value || pinQueued) return;
    // One re-pin per batch: every entry asks for the same thing.
    pinQueued = true;
    void nextTick(() => {
        pinQueued = false;
        if (trackingTail.value) pinToBottom();
    });
}
const spacerObserver = new ResizeObserver(onSpacerResize);
onScopeDispose(() => spacerObserver.disconnect());
onMounted(() => {
    if (spacer.value) spacerObserver.observe(spacer.value);
});
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
            // A queued tail re-pin must not land on top of the jump.
            trackingTail.value = false;
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
    // Scrolling up into history opts the user out of tail tracking; coming
    // back down re-arms it (and marks the newly visible tail read). A one-way
    // latch left late images and decryption upgrades unanchored for the rest
    // of the mount.
    const atBottom = isNearBottom();
    if (atBottom !== trackingTail.value) {
        trackingTail.value = atBottom;
        if (atBottom) reportTailVisible();
    }
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
        scrollQueued = false;
        void maybeLoadMore();
    });
}

/**
 * Plain overflow-y scroller — NOT Reka ScrollArea. The timeline needs precise
 * scrollTop, `overflow-anchor: none` (see the rule below) and the virtualizer
 * on the real scroll container, all of which a wrapped viewport would hide.
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
            ref="spacer"
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
                        :room-id="roomId"
                        :power="power"
                        :on-toggle-reaction="onToggleReaction"
                        :own-user-id="ownUserId"
                        :on-edit-message="onEditMessage"
                        :on-redact-message="onRedactMessage"
                        :on-retry-send="onRetrySend"
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
    /* MUST stay none: the virtualizer adjusts scrollTop itself when a row
       re-measures (measureElement) or history prepends, and native scroll
       anchoring would apply the SAME shift a second time — the view lands
       twice as far from where it was, i.e. "not pinned to where we loaded". */
    overflow-anchor: none;
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
    animation: tumult-flash var(--timeline-flash-duration) var(--motion-ease);
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
        outline: var(--focus-ring-outline) solid var(--focus-ring-color);
        outline-offset: calc(var(--focus-ring-offset) * -1);
    }
}
.tumult-day {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    color: var(--timeline-day-divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.tumult-day::before,
.tumult-day::after {
    content: "";
    flex: 1;
    border-top: var(--border-width) solid var(--border-default);
}
.tumult-unread {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    color: var(--timeline-unread-divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
}
.tumult-unread::before,
.tumult-unread::after {
    content: "";
    flex: 1;
    border-top: var(--border-width-strong) solid var(--timeline-unread-divider);
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
