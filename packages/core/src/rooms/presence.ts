import { type MatrixClient, type RoomMember } from "matrix-js-sdk";

import type { PresenceInput } from "./members.ts";

const TICK_MS = 30_000;
/** Non-priority users are refreshed every Nth tick (priority polls every tick). */
const SLOW_EVERY = 5;
/** Cap on how long a poll wave waits before committing whatever has arrived. */
const FLUSH_MS = 1_000;

/**
 * A rest poller for presence under Simplified Sliding Sync.
 *
 * SSS carries no presence extension, so `m.presence` never reaches the sync
 * loop; the poller is the only source of status and hands each id straight
 * to {@link MembersTracker.applyPollPresence}, which marks the user live and
 * rebuilds the rosters (the live status itself comes from the `User` the SDK
 * already holds once the request is outstanding).
 *
 * One `GET /presence/:user/status` per joined/invited member each tick,
 * deduplicated so overlapping ticks (a slow fetch running into the next) do not
 * fan out. A failing request is skipped per-user rather than aborting the whole
 * poll — one unreachable user must not blind the roster to everyone else.
 *
 * Commits are batched: the sink (`MembersTracker.applyPollPresence`) rebuilds
 * every tracked roster, so feeding one user per response would run that rebuild
 * once per polled member. A wave instead commits once — when the in-flight
 * requests all settle, or {@link FLUSH_MS} after the first response, whichever
 * comes first (so one hung request cannot starve the rest).
 *
 * The poll runs at a fixed cadence independent of the sync loop: SSS idle
 * polls can still carry a `m.presence` the sync loop already handles, so this
 * is a best effort, not a replacement — the members feed also folds any
 * `m.presence` that does arrive.
 */
export class PresencePoller {
    private readonly matrix: MatrixClient;
    private readonly feed: (presence: Array<PresenceInput>) => void;
    private readonly tickMs: number;
    /**
     * Members of the room on screen. Polled every tick — their roster is what
     * the user is looking at. Everyone else refreshes on the slow cadence.
     */
    private readonly getPriorityUserIds: (() => string[]) | undefined;
    private readonly pollers = new Map<string, Promise<void>>();
    /** Users fetched since the last commit, held while a wave is in flight. */
    private readonly pending = new Set<string>();
    private flushTimer: ReturnType<typeof setTimeout> | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private stopped = false;
    private tickCount = 0;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(
        matrix: MatrixClient,
        feed: (presence: Array<PresenceInput>) => void,
        tickMs = TICK_MS,
        getPriorityUserIds?: () => string[],
    ) {
        this.matrix = matrix;
        this.feed = feed;
        this.tickMs = tickMs;
        this.getPriorityUserIds = getPriorityUserIds;
    }

    public start(): void {
        if (this.timer !== undefined) return;
        this.stopped = false;
        this.tick();
        this.schedule();
    }

    public stop(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.flushTimer !== undefined) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    /** All joined/invited members across every room, deduplicated. */
    private allMembers(): RoomMember[] {
        const seen = new Set<string>();
        const members: RoomMember[] = [];
        for (const room of this.matrix.getRooms()) {
            for (const member of room.getMembers()) {
                if (!member.userId || seen.has(member.userId)) continue;
                if (member.membership !== "join" && member.membership !== "invite") continue;
                seen.add(member.userId);
                members.push(member);
            }
        }
        return members;
    }

    public tick(): void {
        this.tickCount += 1;
        const priority = new Set(this.getPriorityUserIds?.() ?? []);
        for (const userId of priority) this.poll(userId);

        // No priority callback means "poll everyone" (classic callers/tests).
        // With one, non-priority users refresh on the slow cadence, plus a
        // warm-up tick so a fresh roster isn't blank for the first interval.
        const slow =
            this.getPriorityUserIds === undefined || this.tickCount === 1 || this.tickCount % SLOW_EVERY === 0;
        if (!slow) return;
        for (const member of this.allMembers()) {
            if (priority.has(member.userId)) continue;
            this.poll(member.userId);
        }
    }

    private poll(userId: string): void {
        if (this.pollers.has(userId)) return;
        const promise = this.request(userId).finally(() => {
            this.pollers.delete(userId);
            // The whole wave settled: commit now rather than waiting for the cap.
            if (this.pollers.size === 0) this.flush();
        });
        this.pollers.set(userId, promise);
    }

    private async request(userId: string): Promise<void> {
        try {
            await this.matrix.getPresence(userId);
            this.pending.add(userId);
            this.armFlush();
        } catch {
            // A failing request is skipped — retried on the next tick.
        }
    }

    /** Guarantee a commit even if a request never settles. */
    private armFlush(): void {
        if (this.flushTimer !== undefined) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.flush();
        }, FLUSH_MS);
        (this.flushTimer as { unref?: () => void }).unref?.();
    }

    /** Commit every presence fetched since the last flush as ONE feed call. */
    private flush(): void {
        if (this.flushTimer !== undefined) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (!this.pending.size) return;
        const ids = [...this.pending];
        this.pending.clear();
        this.feed(ids.map((userId) => ({ userId })));
    }

    private schedule(): void {
        if (this.stopped) return;
        this.timer = setTimeout(() => {
            if (this.stopped) return;
            this.tick();
            this.schedule();
        }, this.tickMs);
    }

    public detachAll(): void {
        this.stopped = true;
        this.stop();
        this.pollers.clear();
        this.pending.clear();
    }
}
