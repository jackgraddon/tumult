import { ClientEvent, MsgType, type MatrixClient, type Thread } from "matrix-js-sdk";

import type { MessageView, Subscribable, ThreadSummary } from "../contract.ts";
import { Observable } from "../observable.ts";
import { mapEvent, type MappableEvent } from "../timeline/map.ts";

/**
 * Tracks threads over one `MatrixClient`.
 *
 * Thread lists are per-room snapshots rebuilt on `ThreadEvent.Update` /
 * `NewReply` plus a sync backstop. Thread timelines are cached
 * `Observable`s (same instance per threadId) mapped through the shared
 * `mapEvent`, so reactions / read receipts / edits compose for free.
 */
export class ThreadTracker {
    private readonly matrix: MatrixClient;
    private readonly threadLists = new Map<string, Observable<ThreadSummary[]>>();
    private readonly threadTimelines = new Map<string, Observable<MessageView[]>>();
    private readonly onThreadEvent: () => void;
    private readonly onSync: () => void;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
        this.onThreadEvent = () => this.rebuildAll();
        this.onSync = () => this.rebuildAll();
        this.matrix.on("ThreadEvent.Update" as never, this.onThreadEvent as never);
        this.matrix.on("ThreadEvent.NewReply" as never, this.onThreadEvent as never);
        this.matrix.on(ClientEvent.Sync, this.onSync);
    }

    public threads(roomId: string): Subscribable<ThreadSummary[]> {
        let obs = this.threadLists.get(roomId);
        if (!obs) {
            obs = new Observable<ThreadSummary[]>([]);
            this.threadLists.set(roomId, obs);
            this.rebuildRoom(roomId);
        }
        return obs;
    }

    public threadTimeline(threadId: string): Subscribable<MessageView[]> {
        let obs = this.threadTimelines.get(threadId);
        if (!obs) {
            obs = new Observable<MessageView[]>([]);
            this.threadTimelines.set(threadId, obs);
            this.rebuildTimeline(threadId);
        }
        return obs;
    }

    public async sendReply(roomId: string, threadId: string, body: string): Promise<void> {
        await this.matrix.sendMessage(roomId, threadId, { msgtype: MsgType.Text, body });
    }

    public async markThreadRead(threadId: string): Promise<void> {
        const thread = this.findThread(threadId);
        if (!thread) return;
        const events = thread.liveTimeline.getEvents();
        const latest = events[events.length - 1];
        if (latest) await this.matrix.sendReadReceipt(latest);
    }

    public detachAll(): void {
        this.matrix.removeListener("ThreadEvent.Update" as never, this.onThreadEvent as never);
        this.matrix.removeListener("ThreadEvent.NewReply" as never, this.onThreadEvent as never);
        this.matrix.removeListener(ClientEvent.Sync, this.onSync);
        this.threadLists.clear();
        this.threadTimelines.clear();
    }

    private findThread(threadId: string): Thread | null {
        for (const room of this.matrix.getRooms()) {
            const thread = room.getThread(threadId);
            if (thread) return thread;
        }
        return null;
    }

    private rebuildAll(): void {
        for (const roomId of this.threadLists.keys()) this.rebuildRoom(roomId);
        for (const threadId of this.threadTimelines.keys()) this.rebuildTimeline(threadId);
    }

    private rebuildRoom(roomId: string): void {
        const obs = this.threadLists.get(roomId);
        const room = this.matrix.getRoom(roomId);
        if (!obs || !room) return;
        const summaries = room
            .getThreads()
            .map((thread): ThreadSummary => {
                const events = thread.liveTimeline.getEvents();
                const last = events[events.length - 1];
                return {
                    rootEventId: thread.id,
                    replyCount: Math.max(0, thread.length - 1),
                    lastReplyTs: last?.getTs() ?? thread.replyToEvent?.getTs() ?? 0,
                    unreadCount: room.getThreadUnreadNotificationCount(thread.id),
                    hasParticipated: thread.hasCurrentUserParticipated,
                };
            })
            .sort((a, b) => b.lastReplyTs - a.lastReplyTs);
        obs.set(summaries);
    }

    private rebuildTimeline(threadId: string): void {
        const obs = this.threadTimelines.get(threadId);
        if (!obs) return;
        const thread = this.findThread(threadId);
        // Thread may not exist yet (no replies sent). Keep the observable
        // empty until it does — the thread list rebuild will populate it.
        if (!thread) {
            obs.set([]);
            return;
        }
        const events = thread.liveTimeline.getEvents();
        obs.set(
            events
                .filter((event) => event.getStateKey() == null)
                .map((event) => mapEvent(event as unknown as MappableEvent)),
        );
    }
}
