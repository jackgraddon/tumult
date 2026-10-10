<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { ChatClient, MemberView, RoomPowerLevelsView, Subscribable } from "@tumult/core";

import { useSubscribable } from "../subscribable.ts";
import MemberListItem from "./MemberListItem.vue";
import IconButton from "../primitives/IconButton.vue";

const props = defineProps<{
    client: ChatClient;
    /** Undefined while nothing is selected: renders an empty static pane. */
    roomId: string | undefined;
}>();

const emit = defineEmits<{
    invite: [];
}>();

// Subscribed once per mount; the parent keys on roomId so a room switch
// remounts instead of leaking the old subscription. members() throws before
// start(), so catch it and render an explicit placeholder rather than a
// zombie vnode (the same rule the timeline follows).
let source: Subscribable<MemberView[]> | null = null;
try {
    source = props.roomId ? props.client.members(props.roomId) : null;
} catch {
    source = null;
}
const members = source ? useSubscribable(source) : null;

// Power levels gate the per-row moderation menu (kick/ban/unban/set level).
// Same throw-before-start() guard as members(): a missing feed just means no
// actions, never a crash.
let powerSource: Subscribable<RoomPowerLevelsView | null> | null = null;
try {
    powerSource = props.roomId ? props.client.powerLevels(props.roomId) : null;
} catch {
    powerSource = null;
}
const power = powerSource ? useSubscribable(powerSource) : null;

// Banned members are pulled from the room's membership, not the roster feed,
// so they need their own subscription.
let bannedSource: Subscribable<MemberView[]> | null = null;
try {
    bannedSource = props.roomId ? props.client.banned(props.roomId) : null;
} catch {
    bannedSource = null;
}
const banned = bannedSource ? useSubscribable(bannedSource) : null;

// The first sync may only carry a lazy-loaded subset of the room: until
// loadMembers() resolves, the roster is partial — say so instead of
// implying the visible list is complete.
const loading = ref(false);
const loadFailed = ref(false);

async function fetchMembers(): Promise<void> {
    if (!props.roomId) return;
    loading.value = true;
    loadFailed.value = false;
    try {
        await props.client.loadMembers(props.roomId);
    } catch {
        // The partial feed stays visible; the status line owns the failure.
        loadFailed.value = true;
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void fetchMembers();
});

interface Row {
    key: string;
    /** Section label on a header row; null on member rows. */
    header: string | null;
    /** Section size on a header row; 0 on member rows. */
    count: number;
    /** Null on header rows. */
    member: MemberView | null;
}

function pushSection(out: Row[], label: string, list: MemberView[]): void {
    if (list.length === 0) return;
    out.push({ key: `section:${label}`, header: label, count: list.length, member: null });
    for (const member of list) {
        out.push({ key: member.userId, header: null, count: 0, member });
    }
}

const rows = computed<Row[]>(() => {
    const list = members?.value ?? [];
    const joined = list.filter((m) => m.membership === "join");
    const out: Row[] = [];
    pushSection(out, "Admins", joined.filter((m) => m.powerLevel >= 100));
    pushSection(out, "Moderators", joined.filter((m) => m.powerLevel >= 50 && m.powerLevel < 100));
    pushSection(out, "Members", joined.filter((m) => m.powerLevel < 50));
    pushSection(out, "Invited", list.filter((m) => m.membership === "invite"));
    // Banned users are absent from the roster feed (join/invite only) but still
    // `RoomMember`s, so they arrive on their own feed and render last.
    pushSection(out, "Banned", banned?.value ?? []);
    return out;
});

const memberCount = computed(() => members?.value.length ?? 0);

// Same virtualization contract as TimelineViewport: a plain overflow
// scroller (not Reka ScrollArea) so the virtualizer owns the real scroll
// container — needed for the member list well past a few hundred rows.
const scroller = ref<HTMLElement | null>(null);

const virtualizerOptions = computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: (index: number) => (rows.value[index]?.header ? 28 : 36),
    overscan: 8,
}));
const virtualizer = useVirtualizer(virtualizerOptions);

function measure(el: unknown): void {
    if (el instanceof HTMLElement) virtualizer.value.measureElement(el);
}
</script>

<template>
    <aside class="tumult-members" aria-label="Members">
        <h2 class="tumult-members-title">
            <span>Members — {{ members ? memberCount : "…" }}</span>
            <IconButton v-if="roomId" label="Invite people" @click="emit('invite')">
                <span aria-hidden="true">＋</span>
            </IconButton>
        </h2>
        <p v-if="!members" class="tumult-members-state" role="status">
            {{ roomId ? "Member list isn't available yet." : "No room selected." }}
        </p>
        <template v-else>
            <p v-if="loading" class="tumult-members-state" role="status">Loading members…</p>
            <p v-else-if="loadFailed" class="tumult-members-state tumult-members-error" role="alert">
                Couldn't load the full member list.
                <button type="button" class="tumult-members-retry" @click="fetchMembers">Retry</button>
            </p>
            <div
                v-if="!loading || memberCount > 0"
                ref="scroller"
                class="tumult-members-scroller"
                tabindex="0"
                aria-label="Member list"
            >
                <div class="tumult-members-spacer" :style="{ height: `${virtualizer.getTotalSize()}px` }">
                    <div
                        v-for="v in virtualizer.getVirtualItems()"
                        :key="rows[v.index]?.key ?? v.index"
                        :data-index="v.index"
                        :ref="measure"
                        class="tumult-members-row"
                        :style="{ transform: `translateY(${v.start}px)` }"
                    >
                        <template v-if="rows[v.index] as Row | undefined">
                            <h3 v-if="(rows[v.index] as Row).header !== null" class="tumult-members-section">
                                {{ (rows[v.index] as Row).header }}
                                <span class="tumult-members-count">{{ (rows[v.index] as Row).count }}</span>
                            </h3>
                            <MemberListItem
                                v-else-if="(rows[v.index] as Row).member !== null"
                                :member="((rows[v.index] as Row).member as MemberView)"
                                :room-id="roomId ?? ''"
                                :power="power"
                            />
                        </template>
                    </div>
                </div>
                <p v-if="rows.length === 0 && !loading && !loadFailed" class="tumult-members-state">
                    No members yet.
                </p>
            </div>
        </template>
    </aside>
</template>

<style scoped>
.tumult-members {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    background: var(--members-bg);
    color: var(--text-secondary);
}
.tumult-members-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--border-default);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.tumult-members-state {
    margin: 0;
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.tumult-members-error {
    color: var(--danger);
}
.tumult-members-retry {
    margin-left: var(--space-1);
    padding: 2px var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-base);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
}
.tumult-members-retry:focus-visible {
    outline: 2px solid var(--focus-ring-color);
}
.tumult-members-scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-2);
}
.tumult-members-scroller:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: -2px;
}
.tumult-members-spacer {
    position: relative;
    width: 100%;
}
.tumult-members-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
}
.tumult-members-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-2) var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.tumult-members-count {
    font-weight: 600;
}
</style>
