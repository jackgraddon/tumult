import {
    ClientEvent,
    RoomMemberEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
    type User,
    type SyncState,
    type SyncStateData,
} from "matrix-js-sdk";

import type { MemberView, PresenceState, Subscribable } from "../contract.ts";
import { Observable } from "../observable.ts";
import { snapshotBanned } from "./moderation.ts";
import { fallbackName } from "./profile.ts";

/**
 * One presence snapshot fetched from the REST poller.
 *
 * The whole body matters, not just "this user answered": under sliding sync
 * this is the ONLY honest source of a member's live state, because
 * `client.getPresence()` is a plain REST GET that never touches the SDK's
 * `User` model (`User.presence` defaults to `"offline"` and is only ever
 * assigned by `sync.js`'s presence handling, which SSS does not have).
 */
export interface PresenceInput {
    /** A `user:server` id. */
    userId: string;
    /** The server's live value, mapped (unknown values stay `unknown`). */
    presence: PresenceState;
    /** `m.presence`'s `status_msg`, `null` when they have not set one. */
    statusMessage: string | null;
    /** When they were last active (ms since epoch), `null` when unknown. */
    lastActiveTs: number | null;
}

/** The presence half of a {@link MemberView} — what any one source can answer. */
interface PresenceFacts {
    presence: PresenceState;
    lastActiveTs: number | null;
    statusMessage: string | null;
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
export function toPresence(value: string | undefined): PresenceState {
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
    syncStatus: ReadonlyMap<string, string | null>,
    polled: ReadonlyMap<string, PresenceInput>,
    selfPresence: PresenceFacts,
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
                ? {
                      presence: selfPresence.presence,
                      // Our own dot is "now" whenever presence is known at all.
                      lastActiveTs: selfPresence.presence === "unknown" ? null : Date.now(),
                      statusMessage: selfPresence.statusMessage,
                  }
                : presenceOf(matrix, member.userId, livePresence, syncStatus, polled)),
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
 * Two sources, in order:
 *
 * 1. **The REST poll** (`polled`). Server truth, and the only source under
 *    sliding sync — SSS carries no presence extension, so `m.presence` never
 *    reaches the sync loop and the SDK's `User.presence` stays at its
 *    `"offline"` default forever. The poller therefore hands over the whole
 *    body (`presence`, `status_msg`, `last_active_ago`), not just "answered".
 * 2. **A live `m.presence` event** (classic sync), which is where `livePresence`
 *    and `syncStatus` come from.
 *
 * `client.getUser()` can hand back an object the SDK rebuilt from IndexedDB at
 * boot (store.startup() replays cached presence events) or from the cached
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
    syncStatus: ReadonlyMap<string, string | null>,
    polled: ReadonlyMap<string, PresenceInput>,
): PresenceFacts {
    // The poll wins: under sliding sync nothing else can answer, and under
    // classic sync it is the same server truth. (The poller does not run at
    // all under classic sync, so this map is empty there.)
    const poll = polled.get(userId);
    if (poll) {
        return { presence: poll.presence, lastActiveTs: poll.lastActiveTs, statusMessage: poll.statusMessage };
    }
    if (!livePresence.has(userId)) return { presence: "unknown", lastActiveTs: null, statusMessage: null };
    const user = matrix.getUser(userId);
    if (!user) return { presence: "unknown", lastActiveTs: null, statusMessage: null };
    const presence = toPresence(user.presence);
    if (presence === "unknown") return { presence, lastActiveTs: null, statusMessage: null };
    // `lastActiveAgo` is relative to when the event was processed, so
    // subtracting it from now lands on the activity time the server meant.
    const lastActiveTs =
        typeof user.lastActiveAgo === "number" && Number.isFinite(user.lastActiveAgo)
            ? Date.now() - user.lastActiveAgo
            : null;
    // The status text comes from the EVENT's content, never from
    // `user.presenceStatusMsg` — the SDK only assigns that when `status_msg` is
    // truthy, so a cleared status would keep showing forever.
    return { presence, lastActiveTs, statusMessage: syncStatus.get(userId) ?? null };
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
    private readonly pendingPresence = new Map<string, string | null>();
    /**
     * Status text of the `m.presence` events committed from a live sync —
     * the classic-sync half of `statusMessage`. Read from the event CONTENT
     * (`status_msg`), never from `User.presenceStatusMsg`, which the SDK only
     * writes when the value is truthy and therefore cannot clear.
     */
    private readonly syncStatus = new Map<string, string | null>();
    /**
     * The last REST poll answer per user — the sliding-sync half (see
     * {@link presenceOf}). Empty under classic sync, where the poller never runs.
     */
    private readonly polled = new Map<string, PresenceInput>();
    /**
     * Our own dot + status. Set by the client from its `ownPresence` snapshot,
     * so our row, our profile card and the user bar read ONE value; `unknown`
     * until the server answers.
     */
    private selfPresence: PresenceFacts = { presence: "unknown", lastActiveTs: null, statusMessage: null };
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
            if (!userId) return;
            // Carry the status text from the CONTENT. `status_msg` is absent
            // when unset — that absence is the answer (a cleared status).
            const raw = event.getContent().status_msg;
            this.pendingPresence.set(userId, typeof raw === "string" && raw !== "" ? raw : null);
        };
        this.onSync = (_state, _prev, data) => {
            if (data?.fromCache) {
                // The replayed first batch — presence in it predates this
                // session. Dropped, not committed; the live sync that follows
                // brings any real changes.
                this.pendingPresence.clear();
            } else {
                for (const [userId, status] of this.pendingPresence) {
                    this.livePresence.add(userId);
                    this.syncStatus.set(userId, status);
                }
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
        this.syncStatus.clear();
        this.polled.clear();
    }

    /**
     * Publish our own presence + status into every roster (no-op when
     * unchanged). The client feeds this from its `ownPresence` snapshot, so our
     * row, our profile card and the user bar read ONE value.
     */
    public setSelfPresence(presence: PresenceState, statusMessage: string | null = null): void {
        if (presence === this.selfPresence.presence && statusMessage === this.selfPresence.statusMessage) return;
        this.selfPresence = { presence, lastActiveTs: null, statusMessage };
        this.rebuildAll();
    }

    /**
     * Sliding sync carries no presence in its sync envelope, so inject it here
     * from the REST poll. Each entry is the WHOLE answer — presence, status text
     * and last-active — because `getPresence()` is a bare REST GET that never
     * updates the SDK's `User` (whose `presence` defaults to `"offline"` and is
     * only written by classic sync's presence handling). Reading the poll's body
     * is what makes a roster under sliding sync honest instead of uniformly
     * offline.
     */
    public applyPollPresence(presence: Array<PresenceInput>): boolean {
        if (!presence.length) return false;
        for (const entry of presence) {
            if (!entry.userId) continue;
            this.polled.set(entry.userId, entry);
            this.livePresence.add(entry.userId);
        }
        this.rebuildAll();
        return true;
    }

    private rebuild(roomId: string): void {
        const room = this.matrix.getRoom(roomId);
        const feed = this.feeds.get(roomId);
        // Room gone (left/kicked): an empty roster is the truth, not a stale list.
        if (feed) {
            feed.set(
                room
                    ? snapshotMembers(
                          room,
                          this.matrix,
                          this.livePresence,
                          this.syncStatus,
                          this.polled,
                          this.selfPresence,
                      )
                    : [],
            );
        }
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
