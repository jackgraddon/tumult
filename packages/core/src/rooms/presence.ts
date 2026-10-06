import { type MatrixClient, type RoomMember } from "matrix-js-sdk";

import type { PresenceInput } from "./members.ts";

const TICK_MS = 30_000;

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
 * The poll runs at a fixed cadence independent of the sync loop: SSS idle
 * polls can still carry a `m.presence` the sync loop already handles, so this
 * is a best effort, not a replacement — the members feed also folds any
 * `m.presence` that does arrive.
 */
export class PresencePoller {
    private readonly matrix: MatrixClient;
    private readonly feed: (presence: Array<PresenceInput>) => void;
    private readonly tickMs: number;
    private readonly pollers = new Map<string, Promise<void>>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private stopped = false;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient, feed: (presence: Array<PresenceInput>) => void, tickMs = TICK_MS) {
        this.matrix = matrix;
        this.feed = feed;
        this.tickMs = tickMs;
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
        for (const member of this.allMembers()) {
            void this.poll(member.userId);
        }
    }

    private poll(userId: string): void {
        if (this.pollers.has(userId)) return;
        const promise = this.request(userId).finally(() => {
            this.pollers.delete(userId);
        });
        this.pollers.set(userId, promise);
    }

    private async request(userId: string): Promise<void> {
        try {
            await this.matrix.getPresence(userId);
            this.feed([{ userId }]);
        } catch {
            // A failing request is skipped — retried on the next tick.
        }
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
    }
}
