import {
    ClientEvent,
    FeatureSupport,
    MatrixEventEvent,
    MsgType,
    RoomEvent,
    Thread,
    ThreadEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk";

import type { MessageView, Subscribable, ThreadSummary } from "../contract.ts";
import { Observable } from "../observable.ts";
import { mapEvent, type MappableEvent } from "../timeline/map.ts";
import { latestReceiptable } from "../timeline/feed.ts";

/**
 * Thread lifecycle events. These fire on the `Room` (which re-emits them from
 * each `Thread`) and are NOT re-emitted by `MatrixClient` — listening on the
 * client hears nothing. Use the enum, never string literals: the member names
 * ("ThreadEvent.Update") are not the values ("Thread.update").
 */
const ROOM_THREAD_EVENTS = [ThreadEvent.New, ThreadEvent.Update, ThreadEvent.NewReply, ThreadEvent.Delete] as const;

/**
 * Tracks threads over one `MatrixClient`.
 *
 * Thread lists are per-room snapshots rebuilt on the room's thread events,
 * with a sync backstop. Listeners attach lazily per room on first
 * `threads(roomId)` — a room that isn't known yet is retried on each sync.
 * Thread timelines are cached `Observable`s (same instance per threadId)
 * mapped through the shared `mapEvent`.
 */
export class ThreadTracker {
    private readonly matrix: MatrixClient;
    private readonly threadLists = new Map<string, Observable<ThreadSummary[]>>();
    private readonly threadTimelines = new Map<string, Observable<MessageView[]>>();
    /** roomId -> the room we attached to, so detach removes exactly those. */
    private readonly attached = new Map<string, Room>();
    private readonly onRoomThreadEvent: (thread?: Thread) => void;
    private readonly onSync: () => void;
    /** Own reply echo flips sending → sent/failed: a room event, not a thread one. */
    private readonly onLocalEcho: (event: MatrixEvent) => void;
    /** Encrypted replies decrypt later; the client re-emits this per event. */
    private readonly onDecrypted: (event: MatrixEvent) => void;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
        this.onRoomThreadEvent = (thread?: Thread) => {
            const roomId = thread?.roomId;
            if (roomId) this.rebuildRoomAndThreads(roomId);
            else this.rebuildAll();
        };
        this.onSync = () => {
            for (const roomId of this.threadLists.keys()) this.attach(roomId);
            this.rebuildAll();
        };
        const onThreadEventOf = (event: MatrixEvent): void => {
            const rootId = event.threadRootId;
            if (rootId && this.threadTimelines.has(rootId)) this.rebuildTimeline(rootId);
        };
        this.onLocalEcho = onThreadEventOf;
        this.onDecrypted = onThreadEventOf;
        this.matrix.on(ClientEvent.Sync, this.onSync);
        this.matrix.on(MatrixEventEvent.Decrypted, this.onDecrypted);
    }

    /** False when the server lacks thread support (pre-v1.4, no MSC3440). */
    public supported(): boolean {
        return Thread.hasServerSideSupport !== FeatureSupport.None;
    }

    public threads(roomId: string): Subscribable<ThreadSummary[]> {
        let obs = this.threadLists.get(roomId);
        if (!obs) {
            obs = new Observable<ThreadSummary[]>([]);
            this.threadLists.set(roomId, obs);
            this.attach(roomId);
            this.rebuildRoom(roomId);
        }
        return obs;
    }

    public threadTimeline(threadId: string): Subscribable<MessageView[]> {
        let obs = this.threadTimelines.get(threadId);
        if (!obs) {
            obs = new Observable<MessageView[]>([]);
            this.threadTimelines.set(threadId, obs);
            const roomId = this.findRoomOf(threadId)?.roomId;
            if (roomId) this.attach(roomId);
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
        // Skip our own pending echo (the SDK throws on those). The SDK reads
        // `threadRootId` off the event and sends a threaded receipt.
        const latest = latestReceiptable(thread.liveTimeline.getEvents());
        if (latest) await this.matrix.sendReadReceipt(latest);
    }

    public detachAll(): void {
        this.matrix.removeListener(ClientEvent.Sync, this.onSync);
        this.matrix.removeListener(MatrixEventEvent.Decrypted, this.onDecrypted);
        for (const room of this.attached.values()) {
            for (const event of ROOM_THREAD_EVENTS) room.removeListener(event, this.onRoomThreadEvent);
            room.removeListener(RoomEvent.LocalEchoUpdated, this.onLocalEcho);
        }
        this.attached.clear();
        this.threadLists.clear();
        this.threadTimelines.clear();
    }

    private attach(roomId: string): void {
        if (this.attached.has(roomId)) return;
        const room = this.matrix.getRoom(roomId);
        if (!room) return;
        for (const event of ROOM_THREAD_EVENTS) room.on(event, this.onRoomThreadEvent);
        room.on(RoomEvent.LocalEchoUpdated, this.onLocalEcho);
        this.attached.set(roomId, room);
    }

    private findRoomOf(threadId: string): Room | null {
        for (const room of this.matrix.getRooms()) {
            if (room.getThread(threadId) || room.findEventById(threadId)) return room;
        }
        return null;
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

    /** Scoped rebuild: only the room that emitted, and its tracked threads. */
    private rebuildRoomAndThreads(roomId: string): void {
        this.rebuildRoom(roomId);
        const room = this.matrix.getRoom(roomId);
        for (const threadId of this.threadTimelines.keys()) {
            if (room?.getThread(threadId) || room?.findEventById(threadId)) this.rebuildTimeline(threadId);
        }
    }

    private rebuildRoom(roomId: string): void {
        const obs = this.threadLists.get(roomId);
        const room = this.matrix.getRoom(roomId);
        if (!obs || !room) return;
        obs.set(
            room
                .getThreads()
                .map((thread) => summarise(room, thread))
                .sort((a, b) => b.lastReplyTs - a.lastReplyTs),
        );
    }

    private rebuildTimeline(threadId: string): void {
        const obs = this.threadTimelines.get(threadId);
        if (!obs) return;
        const thread = this.findThread(threadId);
        // No Thread object until the first reply exists. Show the root alone so
        // a freshly opened thread isn't an empty panel.
        const root = thread?.rootEvent ?? this.findRoomOf(threadId)?.findEventById(threadId);
        const events: MatrixEvent[] = thread ? [...thread.liveTimeline.getEvents()] : [];
        // The SDK only adds the root to the live timeline in some paths.
        if (root && !events.some((e) => e.getId() === root.getId())) events.unshift(root);
        obs.set(
            events
                .filter((event) => event.getStateKey() == null)
                .map((event) => mapEvent(event as unknown as MappableEvent)),
        );
    }
}

/** Pure: one `Thread` -> the UI's summary. Exported for tests. */
export function summarise(room: Pick<Room, "getThreadUnreadNotificationCount">, thread: Thread): ThreadSummary {
    const events = thread.liveTimeline.getEvents();
    const last = events[events.length - 1];
    return {
        rootEventId: thread.id,
        // `length` is replies only (replyCount + pending); the root is not counted.
        replyCount: thread.length,
        lastReplyTs: last?.getTs() ?? thread.replyToEvent?.getTs() ?? 0,
        unreadCount: room.getThreadUnreadNotificationCount(thread.id),
        hasParticipated: thread.hasCurrentUserParticipated,
    };
}
