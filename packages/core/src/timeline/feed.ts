import {
    ClientEvent,
    EventTimeline,
    EventType,
    MatrixEventEvent,
    RelationType,
    RoomEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type SyncState,
} from "matrix-js-sdk";

import type { MessageView, ReactionView, ReplyView, Subscribable } from "../contract.ts";
import { collectEdits } from "../rooms/edits.ts";
import { Observable } from "../observable.ts";
import { mapEvent, type MappableEvent } from "./map.ts";

/** In-memory cap per room: the head drops, scroll anchoring must not break. */
export const TIMELINE_CAP = 500;
const PAGINATION_LIMIT = 50;
/** Jump bound: enough pages to walk the whole cap (plus slack), never unbounded. */
const JUMP_MAX_PAGES = 12;

interface RoomFeed {
    obs: Observable<MessageView[]>;
    room: Room | null;
    invalidate: (() => void) | null;
    paginating: Promise<boolean> | null;
    lastReceiptSent: string | null;
}

/** Shallow snapshot equality. Exported for tests. */
export function sameTimeline(a: readonly MessageView[], b: readonly MessageView[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((m, i) => {
        const o = b[i];
        return (
            o !== undefined &&
            m.id === o.id &&
            m.status === o.status &&
            m.decryption === o.decryption &&
            // Body/type change while id/status/decryption stay put: redaction
            // tombstones and (future) edits. Without this a redacted message
            // never republishes — the snapshot looks identical.
            m.body === o.body &&
            m.type === o.type &&
            m.edited === o.edited &&
            m.redacted === o.redacted &&
            // Profile changes republish too (rename, new avatar).
            m.senderName === o.senderName &&
            m.senderAvatarUrl === o.senderAvatarUrl &&
            // Quote enrichment (target loaded → authoritative sender/body)
            // must republish: without this the fallback quote never upgrades.
            sameReply(m.reply, o.reply) &&
            sameReactions(m.reactions, o.reactions) &&
            sameReaders(m.readBy, o.readBy)
        );
    });
}

function sameReply(a: ReplyView | null, b: ReplyView | null): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    return (
        a.eventId === b.eventId &&
        a.senderId === b.senderId &&
        a.senderName === b.senderName &&
        a.body === b.body
    );
}

function sameReactions(a: readonly ReactionView[], b: readonly ReactionView[]): boolean {
    if (a.length !== b.length) return false;
    return a.every(
        (r, i) => r.emoji === b[i]?.emoji && r.count === b[i]?.count && r.ownReacted === b[i]?.ownReacted,
    );
}

function sameReaders(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((u, i) => u === b[i]);
}

/**
 * Assign each reader to exactly one row: the deepest held message they have
 * read up to. Walking newest-first, the first sighting of a user wins; older
 * rows never repeat them. Exported for tests.
 */
export function assignLatestReaders(
    ids: readonly string[],
    readersOf: (id: string) => readonly string[],
): Map<string, string[]> {
    const seen = new Set<string>();
    const out = new Map<string, string[]>();
    for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i];
        if (id === undefined) continue;
        const fresh = readersOf(id).filter((u) => !seen.has(u));
        for (const u of fresh) seen.add(u);
        out.set(id, [...fresh].sort());
    }
    return out;
}

/**
 * Resolve each reply quote against the messages in view. When the replied-to
 * event is loaded its sender and body are authoritative — post-edit,
 * redaction-aware — while the reply's own fallback text goes stale the moment
 * the target is edited. A target outside the window (history not yet
 * paginated in) keeps the fallback quote, as does one that is still
 * encrypted: the fallback was built from the plaintext BEFORE encryption, so
 * it is better than the target's `[m.room.encrypted]` placeholder.
 *
 * Mutates the freshly mapped snapshots in place: they are rebuilt from
 * scratch on every invalidation. Run AFTER edits apply and BEFORE the cap.
 * Exported for tests.
 */
export function applyReplyQuotes(messages: readonly MessageView[]): void {
    const byId = new Map(messages.map((m) => [m.id, m]));
    for (const message of messages) {
        const reply = message.reply;
        if (!reply) continue;
        const target = byId.get(reply.eventId);
        if (!target || target.decryption !== "ok") continue;
        message.reply = {
            eventId: reply.eventId,
            senderId: target.senderId,
            senderName: target.senderName,
            body: target.body,
        };
    }
}

/** Aggregate non-redacted `m.reaction` annotations by target event id. Exported for tests. */
export function collectReactions(
    events: readonly MatrixEvent[],
): ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> {
    const byTarget = new Map<string, Map<string, Set<string>>>();
    for (const event of events) {
        if (event.getStateKey() != null) continue;
        if (event.getType() !== EventType.Reaction || event.isRedacted()) continue;
        const relation = event.getRelation();
        if (relation?.rel_type !== RelationType.Annotation || !relation.event_id || !relation.key) {
            continue;
        }
        const sender = event.getSender();
        if (!sender) continue;
        let byEmoji = byTarget.get(relation.event_id);
        if (!byEmoji) {
            byEmoji = new Map<string, Set<string>>();
            byTarget.set(relation.event_id, byEmoji);
        }
        let senders = byEmoji.get(relation.key);
        if (!senders) {
            senders = new Set<string>();
            byEmoji.set(relation.key, senders);
        }
        senders.add(sender);
    }
    return byTarget;
}

/**
 * Per-room live timeline feeds over one `MatrixClient`.
 *
 * One `Observable` per roomId, created on first `timeline()` call and never
 * replaced. Listeners attach lazily (rooms may not be in the store yet) and
 * detach on `stop()`. Every signal rebuilds the snapshot wholesale — events
 * are invalidation, never patches.
 */
export class TimelineFeed {
    private readonly feeds = new Map<string, RoomFeed>();
    private readonly matrix: MatrixClient;
    private readonly onSync: (state: SyncState) => void;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
        // Self-driving: rooms enter the store on any sync batch, so attach
        // and rebuild here rather than trusting callers to poll. Rebuilds skip
        // publishing when nothing changed.
        this.onSync = () => {
            this.attachAll();
            this.rebuildAll();
        };
        this.matrix.on(ClientEvent.Sync, this.onSync);
    }

    public timeline(roomId: string): Subscribable<MessageView[]> {
        let feed = this.feeds.get(roomId);
        if (!feed) {
            feed = { obs: new Observable<MessageView[]>([]), room: null, invalidate: null, paginating: null, lastReceiptSent: null };
            this.feeds.set(roomId, feed);
            this.attach(roomId);
        }
        return feed.obs;
    }

    /** Rebuild every live feed. Called on each sync as a backstop for missed signals. */
    public rebuildAll(): void {
        for (const roomId of this.feeds.keys()) this.rebuild(roomId);
    }

    /** Re-attempt listener attach for feeds whose room wasn't in the store yet. */
    public attachAll(): void {
        for (const roomId of this.feeds.keys()) this.attach(roomId);
    }

    /**
     * Send a read receipt for the latest held event, and set the room's
     * `m.fully_read` marker to the same point (the divider's anchor).
     * Throttled per room: a repeat call with nothing new resolves without
     * touching the server. This is what clears our unread badge on the next
     * sync.
     */
    public async markRead(roomId: string): Promise<void> {
        const feed = this.feeds.get(roomId);
        const room = feed?.room ?? this.matrix.getRoom(roomId) ?? undefined;
        if (!room) return;
        const latest = latestReceiptable(room.getLiveTimeline().getEvents());
        const latestId = latest?.getId();
        if (!latest || !latestId) return;
        if (feed && feed.lastReceiptSent === latestId) return;
        try {
            // One request writes both halves: m.fully_read (marker) and
            // m.read (receipt), with the SDK's own local receipt echo.
            await this.matrix.setRoomReadMarkers(roomId, latestId, latest);
        } catch (error) {
            // Keep the slice-9 guarantee if the marker endpoint refuses
            // (very old homeserver, or a race the guard didn't catch).
            console.error("[tumult] read marker failed; receipt only", error);
            await this.matrix.sendReadReceipt(latest);
        }
        if (feed) feed.lastReceiptSent = latestId;
    }

    public async loadMore(roomId: string): Promise<boolean> {
        const feed = this.feeds.get(roomId) ?? this.create(roomId);
        if (feed.paginating) return feed.paginating;
        const room = feed.room ?? this.matrix.getRoom(roomId) ?? undefined;
        if (!room) return false;
        feed.paginating = (async () => {
            try {
                const before = feed.obs.get().length;
                await this.matrix.scrollback(room, PAGINATION_LIMIT);
                this.rebuild(roomId);
                const added = feed.obs.get().length - before;
                // A null backwards token means the start (or an unfilled gap).
                const token = room.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS);
                console.debug(`[tumult] paginated ${roomId}: +${added} events, more=${token != null}`);
                return token != null;
            } catch (error) {
                console.error("[tumult] timeline pagination failed", error);
                return true;
            } finally {
                feed.paginating = null;
            }
        })();
        return feed.paginating;
    }

    /**
     * Page history backwards until `eventId` sits in the loaded snapshot, or
     * the bound runs out. The window only ever holds `TIMELINE_CAP` events,
     * so targets further back than that can't render — they resolve `false`
     * after ~cap-plus-a-few pages. Callers must not scroll on `false`.
     */
    public async jumpTo(roomId: string, eventId: string): Promise<boolean> {
        // Building the feed first catches "already loaded" without spending
        // a page (attach() snapshots whatever the SDK timeline already holds).
        this.feeds.get(roomId) ?? this.create(roomId);
        const held = (): boolean =>
            this.feeds.get(roomId)?.obs.get().some((m) => m.id === eventId) ?? false;
        if (held()) return true;
        for (let page = 0; page < JUMP_MAX_PAGES; page++) {
            const more = await this.loadMore(roomId);
            if (held()) return true;
            if (!more) return false;
        }
        return false;
    }

    public detachAll(): void {
        this.matrix.removeListener(ClientEvent.Sync, this.onSync);
        for (const [roomId, feed] of this.feeds) {
            if (feed.room && feed.invalidate) {
                feed.room.removeListener(RoomEvent.Timeline, feed.invalidate);
                feed.room.removeListener(RoomEvent.LocalEchoUpdated, feed.invalidate);
            }
            this.feeds.delete(roomId);
        }
    }

    private create(roomId: string): RoomFeed {
        const feed: RoomFeed = {
            obs: new Observable<MessageView[]>([]),
            room: null,
            invalidate: null,
            paginating: null,
            lastReceiptSent: null,
        };
        this.feeds.set(roomId, feed);
        this.attach(roomId);
        return feed;
    }

    private attach(roomId: string): void {
        const feed = this.feeds.get(roomId);
        if (!feed || feed.room) return;
        const room = this.matrix.getRoom(roomId);
        if (!room) return;
        const invalidate = (): void => this.rebuild(roomId);
        room.on(RoomEvent.Timeline, invalidate);
        room.on(RoomEvent.LocalEchoUpdated, invalidate);
        feed.room = room;
        feed.invalidate = invalidate;
        this.rebuild(roomId);
    }

    private rebuild(roomId: string): void {
        const feed = this.feeds.get(roomId);
        if (!feed) return;
        const room = feed.room ?? this.matrix.getRoom(roomId) ?? undefined;
        if (!room) return;
        const events = room.getLiveTimeline().getEvents();
        const ownUserId = this.matrix.getUserId() ?? "";
        const annotations = collectReactions(events);
        const edits = collectEdits(events);
        const byId = new Map<string, MatrixEvent>();
        for (const event of events) {
            const id = event.getId();
            if (id) byId.set(id, event);
        }
        // Readers per message, then collapsed so each reader lands on exactly
        // one (their deepest held) row. `getUsersReadUpTo` covers both
        // `m.read` and `m.read.private`.
        const latestReaders = assignLatestReaders(
            events.map((event) => event.getId() ?? ""),
            (id) => {
                const event = byId.get(id);
                return event ? room.getUsersReadUpTo(event) : [];
            },
        );
        // State events (joins, name changes, space links) ride the timeline
        // but render as room-list/structure updates, not messages. Reaction
        // annotations ride it too, but render as chips on their target, not
        // rows — and so do edit events, whose content already lives on the
        // target. Game and custom events are non-state, so they pass through
        // untouched.
        const next = events
            .filter(
                (event) =>
                    event.getStateKey() == null &&
                    event.getType() !== EventType.Reaction &&
                    event.getType() !== EventType.RoomRedaction &&
                    !isAggregatedRelation(event),
            )
            .map((event: MatrixEvent) => {
                const message = mapEvent(event as unknown as MappableEvent);
                const byEmoji = annotations.get(message.id);
                if (byEmoji) {
                    message.reactions = [...byEmoji]
                        .map(
                            ([emoji, senders]): ReactionView => ({
                                emoji,
                                count: senders.size,
                                ownReacted: senders.has(ownUserId),
                            }),
                        )
                        .sort((a, b) => (a.emoji < b.emoji ? -1 : 1));
                }
                message.readBy = latestReaders.get(message.id) ?? [];
                // Edits apply only from the target's own sender, and never
                // over a redaction tombstone. Latest edit wins (timeline order
                // in collectEdits).
                const edit = edits.get(message.id);
                if (edit && edit.senderId === message.senderId && !event.isRedacted()) {
                    message.body = edit.body;
                    message.edited = true;
                }
                return message;
            });
        // After edits (quotes must reflect the edited body) but before the
        // cap (a quote may target history about to fall out of the window).
        applyReplyQuotes(next);
        const capped = next.slice(-TIMELINE_CAP);
        if (sameTimeline(capped, feed.obs.get())) return;
        feed.obs.set(capped);
    }
}

/**
 * Reactions and edits render on their target, never as rows. Decide by the
 * WIRE relation: `m.relates_to` stays cleartext on encrypted events, but
 * `getType()` reads `m.room.encrypted` until decryption — so a type-based
 * filter leaks still-encrypted (or undecryptable) reactions and edits into the
 * timeline as "waiting for keys" / "unable to decrypt" rows.
 * Exported for tests.
 */
export function isAggregatedRelation(event: Pick<MatrixEvent, "getRelation">): boolean {
    const relType = event.getRelation()?.rel_type;
    return relType === RelationType.Annotation || relType === RelationType.Replace;
}

/**
 * Newest event a read receipt may point at. The SDK throws "Cannot set read
 * receipt to a pending event" on local echoes, and the live tail is usually
 * our own echo right after sending — so skip anything not yet acknowledged.
 * Exported for tests.
 */
export function latestReceiptable<E extends Pick<MatrixEvent, "getId" | "status">>(events: readonly E[]): E | undefined {
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event && event.status == null && event.getId()) return event;
    }
    return undefined;
}

/** Matrix-level decrypted-event hook: any late key upgrades some feed. */
export function onDecryptedRebuild(matrix: MatrixClient, feed: TimelineFeed): () => void {
    const handler = (): void => feed.rebuildAll();
    matrix.on(MatrixEventEvent.Decrypted, handler);
    return () => matrix.removeListener(MatrixEventEvent.Decrypted, handler);
}
