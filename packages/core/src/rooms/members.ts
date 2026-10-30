import {
    ClientEvent,
    RoomMemberEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
    type SyncState,
    type SyncStateData,
} from "matrix-js-sdk";

import type { MemberView, PresenceState, Subscribable } from "../contract.ts";
import { Observable } from "../observable.ts";
import { snapshotBanned } from "./moderation.ts";
import { fallbackName } from "./profile.ts";

/** A single presence entry fetched from the REST poller. */
export interface PresenceInput {
    /** A `user:server` id. */
    userId: string;
}

/**
 * Map a live presence value. Unknown/unexpected values stay `unknown` —
 * never guess `offline` from a value we don't understand.
 */
function isRostered(membership: string | undefined): boolean {
    return membership === "join" || membership === "invite";
}

/**
 * Map a live presence value. Unknown/unexpected values stay `unknown` —
 * never guess `offline` from a value we don't understand.
 */
function toPresence(value: string | undefined): PresenceState {
    if (value === "online") return "online";
    if (value === "unavailable") return "unavailable";
    if (value === "offline") return "offline";
    return "unknown";
}

/**
 * Build the roster snapshot for one room.
 *
 * Ordering is part of the contract: power level descending, then display
 * name, then userId so equal names stay deterministic across snapshots (a
 * reordering every rebuild would make the UI's keyed list thrash).
 */
function snapshotMembers(
    room: Room,
    matrix: MatrixClient,
    livePresence: ReadonlySet<string>,
    selfPresence: PresenceState,
): MemberView[] {
    const selfId = matrix.getUserId();
    const out: MemberView[] = [];
    for (const member of room.getMembers()) {
        if (!isRostered(member.membership)) continue;
        const isSelf = member.userId === selfId;
        const displayName = fallbackName(member.userId, member.rawDisplayName);
        out.push({
            userId: member.userId,
            displayName,
            avatarUrl: member.getMxcAvatarUrl() || null,
            membership: member.membership as MemberView["membership"],
            powerLevel: member.powerLevel ?? 0,
            isSelf,
            ...(isSelf
                ? { presence: selfPresence, lastActiveTs: selfPresence === "unknown" ? null : Date.now() }
                : presenceOf(matrix, member.userId, livePresence)),
        });
    }
    out.sort(
        (a, b) =>
            b.powerLevel - a.powerLevel ||
            a.displayName.localeCompare(b.displayName, "en") ||
            a.userId.localeCompare(b.userId, "en"),
    );
    return out;
}

/**
 * Read one user's presence — the honesty rule of this tracker.
 *
 * `client.getUser()` can hand back an object the SDK rebuilt from IndexedDB
 * at boot (store.startup() replays cached presence events) or from the cached
 * first sync — hours old and possibly still saying `online` for someone who
 * went away while we were closed. So a user only counts as known once a LIVE
 * `/sync` response carried their `m.presence`: presence events queue into
 * `pendingPresence` and are committed on the next sync event, unless that
 * sync reports `fromCache` (the replayed first batch), in which case they are
 * dropped. Until then the roster says `unknown` rather than a stale `online`.
 */
function presenceOf(
    matrix: MatrixClient,
    userId: string,
    livePresence: ReadonlySet<string>,
): { presence: PresenceState; lastActiveTs: number | null } {
    if (!livePresence.has(userId)) return { presence: "unknown", lastActiveTs: null };
    const user = matrix.getUser(userId);
    if (!user) return { presence: "unknown", lastActiveTs: null };
    const presence = toPresence(user.presence);
    if (presence === "unknown") return { presence, lastActiveTs: null };
    // `lastActiveAgo` is relative to when the event was processed, so
    // subtracting it from now lands on the activity time the server meant.
    const lastActiveTs =
        typeof user.lastActiveAgo === "number" && Number.isFinite(user.lastActiveAgo)
            ? Date.now() - user.lastActiveAgo
            : null;
    return { presence, lastActiveTs };
}

/**
 * Per-room member rosters over one `MatrixClient`.
 *
 * Lazy loading (`lazyLoadMembers` on `startClient()`) means sync initially
 * carries only members who speak, so the first snapshot for a room can be
 * partial — whoever showed up in sync. `loadMembers()` fetches the full list
 * the first time a pane opens it; until then the feed honestly reports what
 * is known instead of presenting a stub as the complete roster.
 *
 * Member state events (`RoomMember.membership` / `.name` / `.powerLevel`)
 * are re-emitted on the client for every member, with no roomId in their
 * arguments — `member.roomId` is how a change finds its feed. Every sync is
 * a backstop rebuild, same as TypingTracker: the SDK mutates Room/RoomMember
 * in place and events are only invalidation signals.
 *
 * Same `Subscribable` per roomId on repeat calls (the `timeline()` rule).
 */
export class MembersTracker {
    private readonly matrix: MatrixClient;
    private readonly feeds = new Map<string, Observable<MemberView[]>>();
    private readonly bannedFeeds = new Map<string, Observable<MemberView[]>>();
    private readonly livePresence = new Set<string>();
    private readonly pendingPresence = new Set<string>();
    /**
     * Our own dot. Set by the client from its `ownPresence` snapshot, so our
     * row and the user bar read ONE value; `unknown` until the server answers.
     */
    private selfPresence: PresenceState = "unknown";
    private readonly onMemberChange: (event: MatrixEvent, member: RoomMember) => void;
    private readonly onClientEvent: (event: MatrixEvent) => void;
    private readonly onSync: (state: SyncState, prev: SyncState | null, data?: SyncStateData) => void;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
        this.onMemberChange = (_event, member) => {
            if (member?.roomId && this.tracks(member.roomId)) this.rebuild(member.roomId);
        };
        this.onClientEvent = (event) => {
            if (event.getType() !== "m.presence") return;
            const userId = event.getSender() ?? (event.getContent().user_id as string | undefined);
            if (userId) this.pendingPresence.add(userId);
        };
        this.onSync = (_state, _prev, data) => {
            if (data?.fromCache) {
                // The replayed first batch — presence in it predates this
                // session. Dropped, not committed; the live sync that follows
                // brings any real changes.
                this.pendingPresence.clear();
            } else {
                for (const userId of this.pendingPresence) this.livePresence.add(userId);
                this.pendingPresence.clear();
            }
            this.rebuildAll();
        };
        this.matrix.on(RoomMemberEvent.Membership, this.onMemberChange);
        this.matrix.on(RoomMemberEvent.Name, this.onMemberChange);
        this.matrix.on(RoomMemberEvent.PowerLevel, this.onMemberChange);
        this.matrix.on(ClientEvent.Event, this.onClientEvent);
        this.matrix.on(ClientEvent.Sync, this.onSync);
    }

    public members(roomId: string): Subscribable<MemberView[]> {
        let feed = this.feeds.get(roomId);
        if (!feed) {
            feed = new Observable<MemberView[]>([]);
            this.feeds.set(roomId, feed);
            this.rebuild(roomId);
        }
        return feed;
    }

    /**
     * Banned members for one room. Same `Subscribable` per roomId. Only rooms
     * whose list has actually been asked for are tracked, exactly like
     * `members()`.
     */
    public banned(roomId: string): Subscribable<MemberView[]> {
        let feed = this.bannedFeeds.get(roomId);
        if (!feed) {
            feed = new Observable<MemberView[]>([]);
            this.bannedFeeds.set(roomId, feed);
            this.rebuild(roomId);
        }
        return feed;
    }

    /**
     * Fetch the room's full membership list. `loadMembersIfNeeded()` collapses
     * concurrent calls (one shared promise) and clears it on failure so a
     * rejected fetch can be retried — the rejection itself propagates so the
     * caller never mistakes a partial roster for a complete one.
     */
    public async loadMembers(roomId: string): Promise<void> {
        const room = this.matrix.getRoom(roomId);
        if (!room) throw new Error(`Cannot load members for unknown room ${roomId}`);
        await room.loadMembersIfNeeded();
        this.rebuild(roomId);
    }

    public detachAll(): void {
        this.matrix.removeListener(RoomMemberEvent.Membership, this.onMemberChange);
        this.matrix.removeListener(RoomMemberEvent.Name, this.onMemberChange);
        this.matrix.removeListener(RoomMemberEvent.PowerLevel, this.onMemberChange);
        this.matrix.removeListener(ClientEvent.Event, this.onClientEvent);
        this.matrix.removeListener(ClientEvent.Sync, this.onSync);
        this.feeds.clear();
        this.bannedFeeds.clear();
        this.livePresence.clear();
        this.pendingPresence.clear();
    }

    /**
     * Sliding sync carries no presence in its sync envelope, so inject it here
     * from the REST poll: mark the user live (so `presenceOf` no longer says
     * `unknown`) and rebuild the rosters. The poller already fetched each
     * `User`'s live status via `client.getUser()`, so no separate presence
     * event is set — the trigger is each poll (not every sync), the sink is
     * the REST response.
     */
    /** Publish our own presence into every roster (no-op when unchanged). */
    public setSelfPresence(presence: PresenceState): void {
        if (presence === this.selfPresence) return;
        this.selfPresence = presence;
        this.rebuildAll();
    }

    public applyPollPresence(presence: Array<PresenceInput>): boolean {
        if (!presence.length) return false;
        for (const { userId } of presence) {
            if (!userId) continue;
            this.livePresence.add(userId);
        }
        this.rebuildAll();
        return true;
    }

    private rebuild(roomId: string): void {
        const room = this.matrix.getRoom(roomId);
        const feed = this.feeds.get(roomId);
        // Room gone (left/kicked): an empty roster is the truth, not a stale list.
        if (feed) feed.set(room ? snapshotMembers(room, this.matrix, this.livePresence, this.selfPresence) : []);
        const banned = this.bannedFeeds.get(roomId);
        if (banned) banned.set(room ? snapshotBanned(room, this.matrix) : []);
    }

    private tracks(roomId: string): boolean {
        return this.feeds.has(roomId) || this.bannedFeeds.has(roomId);
    }

    private rebuildAll(): void {
        const rooms = new Set<string>([...this.feeds.keys(), ...this.bannedFeeds.keys()]);
        for (const roomId of rooms) this.rebuild(roomId);
    }
}
