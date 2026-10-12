import type {
    ChatClient,
    ConnectionState,
    CreateChannelParams,
    CreateDmParams,
    CreateSpaceParams,
    DeviceView,
    EncryptedAttachment,
    MemberView,
    MessageView,
    NotificationPermission,
    NotificationState,
    ProfileView,
    RoomPowerLevelsView,
    RoomSettingsPatch,
    RoomSummary,
    SearchPage,
    SecurityStatus,
    SessionView,
    Subscribable,
    ThreadSummary,
    TypingState,
    UserSearchResult,
    VerificationState,
} from "../contract.ts";
import { Observable } from "../observable.ts";
import { fallbackName } from "../rooms/profile.ts";

/** In-memory cap: dropping the head must not break scroll anchoring. */
export const FAKE_TIMELINE_CAP = 500;

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SENDERS = ["@alice:example.com", "@bob:example.com", "@carol:example.com", "@dave:example.com"];
const DM_NAMES = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy"];
const SELF_ID = "@demo:example.com";
const BODIES = [
    "hey, did anyone see the new build?",
    "shipping the shell today, theme tokens and all",
    "this nesting goes four levels deep — check the rail",
    "diamond room: I render under both parents",
    "late decryption demo: I upgrade in ~4s",
    "mention @alice look at this",
];

export interface FakeOptions {
    seed?: number;
}

function msg(
    id: string,
    senderId: string,
    body: string,
    timestamp: number,
    extra: Partial<MessageView> = {},
): MessageView {
    return {
        id,
        type: "m.room.message",
        senderId,
        senderName: senderId.slice(1).split(":")[0] ?? senderId,
        senderAvatarUrl: null,
        body,
        timestamp,
        status: "sent",
        decryption: "ok",
        content: { msgtype: "m.text", body },
        reactions: [],
        readBy: [],
        edited: false,
        redacted: false,
        reply: null,
        ...extra,
    };
}

function buildRooms(): RoomSummary[] {
    const rooms: RoomSummary[] = [];
    const space = (id: string, name: string, parents: string[] = [], unread = 0, highlight = 0, favourite = false, favouriteOrder: number | null = null): void => {
        rooms.push({
            id,
            name,
            topic: null,
            avatarUrl: null,
            isSpace: true,
            parentSpaceIds: parents,
            unreadCount: unread,
            highlightCount: highlight,
            fullyReadEventId: null,
            joinRule: "invite",
            historyVisibility: "shared",
            canonicalAlias: null,
            favourite,
            favouriteOrder,
        });
    };
    const chan = (id: string, name: string, parents: string[] = [], unread = 0, highlight = 0, favourite = false, favouriteOrder: number | null = null): void => {
        rooms.push({
            id,
            name,
            topic: `${name} discussion`,
            avatarUrl: null,
            isSpace: false,
            parentSpaceIds: parents,
            unreadCount: unread,
            highlightCount: highlight,
            fullyReadEventId: null,
            joinRule: "invite",
            historyVisibility: "shared",
            canonicalAlias: null,
            favourite,
            favouriteOrder,
        });
    };

    // Guild 1: 4-level nesting.
    space("!guild-a:fake", "Guild A");
    space("!a-l1:fake", "Announcements", ["!guild-a:fake"], 3);
    space("!a-l2:fake", "Releases", ["!a-l1:fake"], 5, 1);
    space("!a-l3:fake", "Canary", ["!a-l2:fake"], 120, 2);
    chan("!a-general:fake", "general", ["!guild-a:fake"], 7);
    chan("!a-deep:fake", "deep-note", ["!a-l3:fake"]);

    // Guild 2: 65-room space.
    space("!guild-b:fake", "Big Guild", [], 150, 3);
    for (let i = 0; i < 65; i++) {
        chan(`!b-${i}:fake`, `channel-${String(i).padStart(2, "0")}`, ["!guild-b:fake"], i % 7 === 0 ? 99 + i : 0, i === 3 ? 1 : 0);
    }

    // Guild 3: diamond + shared subspace + reachable cycle.
    space("!guild-c:fake", "Guild C");
    space("!c-left:fake", "Left", ["!guild-c:fake"]);
    space("!c-right:fake", "Right", ["!guild-c:fake"]);
    chan("!c-shared-room:fake", "shared-room", ["!c-left:fake", "!c-right:fake"], 4);
    space("!c-sub:fake", "Shared Sub", ["!c-left:fake", "!c-right:fake"]);
    chan("!c-sub-room:fake", "sub-note", ["!c-sub:fake"]);
    space("!c-cyc1:fake", "Cyc One", ["!guild-c:fake", "!c-cyc2:fake"]);
    space("!c-cyc2:fake", "Cyc Two", ["!c-cyc1:fake"]);
    chan("!c-cyc-room:fake", "cycle-note", ["!c-cyc1:fake"]);

    // Guild 4: plain small guild.
    space("!guild-d:fake", "Guild D");
    chan("!d-general:fake", "general", ["!guild-d:fake"], 1);
    chan("!d-random:fake", "random", ["!guild-d:fake"]);

    // Unreachable cycle: no path from any root → promotion exercises.
    space("!u-bbb:fake", "Unreachable Bee", ["!u-aaa:fake"]);
    space("!u-aaa:fake", "Unreachable Aye", ["!u-bbb:fake"]);
    chan("!u-note:fake", "lost-note", ["!u-aaa:fake"], 2);

    // Dangling parent → sanitised to orphan.
    chan("!dangling:fake", "dangling", ["!missing:fake"]);

    // 10 orphans = DMs tab.
    DM_NAMES.forEach((n, i) => {
        chan(`!dm-${i}:fake`, n, [], i === 0 ? 105 : i, i === 1 ? 2 : 0);
    });

    // Favourites for the rail's Favourites band: spread across guilds (the band
    // is global, not in-guild) plus one DM with no order to exercise
    // no-order-last sorting. Higher order sorts higher. These are room ids the
    // fake already has — mark them rather than re-creating them.
    const markFav = (id: RoomSummary["id"], order: number | null): void => {
        const found = rooms.find((r) => r.id === id);
        if (found) {
            found.favourite = true;
            found.favouriteOrder = order;
        }
    };
    markFav("!dm-2:fake", 7);
    markFav("!b-3:fake", 4);
    markFav("!a-general:fake", 2);
    markFav("!u-note:fake", null); // no order → sorts last

    // Marker sits mid-history in general so the "New messages" divider demos
    // out of the box; fake markRead is a no-op, so it never advances. General
    // is also public with a canonical alias so the settings dialog demos
    // non-default join rule / history / alias values.
    const general = rooms.find((r) => r.id === "!a-general:fake");
    if (general) {
        general.fullyReadEventId = "!a-general:fake:e18";
        general.joinRule = "public";
        general.historyVisibility = "joined";
        general.canonicalAlias = "#general:fake";
    }

    return rooms;
}

function buildTimeline(roomId: string, rand: () => number, now: number): MessageView[] {
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
    const out: MessageView[] = [];
    const day = 86_400_000;
    const statuses = ["sent", "sent", "sent", "sending", "failed"] as const;
    const decryptions = ["ok", "ok", "ok", "ok", "pending", "failed"] as const;

    const count = roomId === "!b-0:fake" ? 2500 : 24;
    const start = now - 2 * day;
    for (let i = 0; i < count; i++) {
        const t = start + Math.floor((i / count) * 2 * day);
        // One inline reply per room so the quote block ships with the fake.
        const quoted = i === 12 ? out[5] : undefined;
        out.push(
            msg(
                `${roomId}:e${i}`,
                pick(SENDERS),
                pick(BODIES),
                t,
                {
                    status: pick(statuses),
                    decryption: pick(decryptions),
                    ...(quoted
                        ? {
                              reply: {
                                  eventId: quoted.id,
                                  senderId: quoted.senderId,
                                  senderName: quoted.senderName,
                                  body: quoted.body,
                              },
                          }
                        : {}),
                },
            ),
        );
    }

    // Deterministic showcase events appended at the end.
    out.push(
        msg(`${roomId}:reacted`, "@alice:example.com", "react to this", now - 7200_000, {
            reactions: [
                { emoji: "👍", count: 2, ownReacted: true },
                { emoji: "❤️", count: 1, ownReacted: false },
            ],
            readBy: ["@bob:example.com", "@carol:example.com"],
        }),
        // Redacted upstream: the redaction event itself never renders, only this tombstone.
        msg(`${roomId}:deleted`, "@bob:example.com", "Message deleted.", now - 7000_000, {
            redacted: true,
            content: {},
        }),
        msg(`${roomId}:poll`, "@alice:example.com", "Lunch poll", now - 3600_000, {
            type: "cc.jackg.tumult.demo.poll",
            content: { question: "Lunch?", options: ["ramen", "tacos", "salad"] },
        }),
        msg(`${roomId}:future`, "@bob:example.com", "from the future", now - 1800_000, {
            type: "cc.jackg.tumult.unknown.future",
            content: { opaque: [1, 2, 3] },
        }),
        msg(`${roomId}:late`, "@carol:example.com", "keys arriving shortly…", now - 60_000, {
            decryption: "pending",
        }),
    );

    // Head-drop at the cap.
    return out.length > FAKE_TIMELINE_CAP ? out.slice(out.length - FAKE_TIMELINE_CAP) : out;
}

/**
 * Mirror the core ordering guarantee: power level desc, then display name,
 * then userId — a stable order so keyed lists don't thrash between snapshots.
 */
function sortMembers(members: MemberView[]): MemberView[] {
    return members.sort(
        (a, b) =>
            b.powerLevel - a.powerLevel ||
            a.displayName.localeCompare(b.displayName, "en") ||
            a.userId.localeCompare(b.userId, "en"),
    );
}

function member(
    userId: string,
    displayName: string,
    powerLevel: number,
    membership: MemberView["membership"],
    presence: MemberView["presence"],
    lastActiveTs: number | null,
): MemberView {
    return { userId, displayName, avatarUrl: null, membership, powerLevel, isSelf: false, presence, lastActiveTs };
}

/**
 * Roster fixture per room. Rich rooms exercise every section the UI groups
 * by (admin / moderator / member / invite) and every presence state
 * (online / offline / unknown); DM rooms are just the two participants. The
 * self row tracks the profile so a rename shows up in the roster too.
 */
function buildRoster(roomId: string, self: MemberView): MemberView[] {
    const now = Date.now();
    const dm = /^!dm-(\d+):fake$/.exec(roomId);
    if (dm) {
        const i = Number(dm[1]);
        const name = DM_NAMES[i] ?? `person-${i}`;
        const partner = SENDERS[i] ?? `@${name.toLowerCase()}:example.com`;
        return sortMembers([
            self,
            member(
                partner,
                name,
                0,
                "join",
                i % 2 === 0 ? "online" : "offline",
                i % 2 === 0 ? now - 45_000 : now - 5 * 3_600_000,
            ),
        ]);
    }
    return sortMembers([
        self,
        member("@alice:example.com", "Alice", 100, "join", "online", now - 30_000),
        member("@bob:example.com", "Bob", 50, "join", "offline", now - 3 * 3_600_000),
        member("@carol:example.com", "Carol", 0, "join", "unknown", null),
        member("@erin:example.com", "Erin", 0, "invite", "unknown", null),
        // General demos the Banned section: Mallory is banned, so she is absent
        // from the roster feed and present in the banned feed only.
        ...(roomId === "!a-general:fake"
            ? [member("@mallory:example.com", "Mallory", 0, "ban", "unknown", null)]
            : []),
    ]);
}

/** The roster `members()` publishes: join/invite only. */
function isRosteredMember(m: MemberView): boolean {
    return m.membership === "join" || m.membership === "invite";
}

class FakeChatClient implements ChatClient {
    public readonly session: Subscribable<SessionView | null>;
    public readonly connection: Subscribable<ConnectionState>;
    public readonly rooms: Subscribable<RoomSummary[]>;
    public readonly security: Subscribable<SecurityStatus>;
    public readonly verification: Subscribable<VerificationState>;
    public readonly typing: Subscribable<TypingState>;
    public readonly notifications: Subscribable<NotificationState>;
    public readonly profile: Subscribable<ProfileView | null>;
    private readonly _threads: Observable<ThreadSummary[]>;
    private readonly noThreads = new Observable<ThreadSummary[]>([]);
    private readonly timelines = new Map<string, Observable<MessageView[]>>();
    private readonly threadTimelines = new Map<string, Observable<MessageView[]>>();
    private readonly memberFeeds = new Map<string, Observable<MemberView[]>>();
    private readonly bannedFeeds = new Map<string, Observable<MemberView[]>>();
    private readonly powerLevelFeeds = new Map<string, Observable<RoomPowerLevelsView | null>>();
    private readonly rosters = new Map<string, MemberView[]>();
    private readonly rand: () => number;

    public constructor(seed: number) {
        this.rand = mulberry32(seed);
        const now = Date.now();
        this.session = new Observable<SessionView | null>({
            userId: "@demo:example.com",
            deviceId: "FAKEDEVICE",
            homeserverUrl: "https://matrix.example.com",
        });
        this.connection = new Observable<ConnectionState>("syncing");
        this.rooms = new Observable<RoomSummary[]>(buildRooms());
        // Fake device is fully healthy: the security banner stays hidden.
        this.security = new Observable<SecurityStatus>({
            crossSigningReady: true,
            backupEnabled: true,
            backupTrusted: true,
            secretStorageReady: true,
        });
        // No verification requests in fake mode.
        this.verification = new Observable<VerificationState>({ requests: [] });
        // Alice is typing in the general room.
        this.typing = new Observable<TypingState>({
            rooms: { "!a-general:fake": ["@alice:example.com"] },
        });
        // Fake client reports permission granted but unsupported (no real Notification API).
        this.notifications = new Observable<NotificationState>({
            permission: "granted",
            supported: false,
        });
        // One thread in the general room.
        this._threads = new Observable<ThreadSummary[]>([
            { rootEventId: "!a-general:fake:e0", replyCount: 2, lastReplyTs: Date.now() - 60_000, unreadCount: 1, hasParticipated: false },
        ]);
        this.profile = new Observable<ProfileView | null>({
            userId: SELF_ID,
            displayName: "Demo",
            avatarUrl: null,
        });

        for (const r of this.rooms.get()) {
            this.rosters.set(r.id, buildRoster(r.id, this.selfMember()));
        }

        for (const r of this.rooms.get()) {
            if (r.isSpace) continue;
            const timeline = buildTimeline(r.id, this.rand, now);
            const obs = new Observable<MessageView[]>(timeline);
            this.timelines.set(r.id, obs);

            // Late-decryption upgrade: the pending showcase event resolves to ok after ~4s.
            const late = timeline.find((m) => m.id === `${r.id}:late`);
            if (late && r.id === "!a-general:fake") {
                setTimeout(() => {
                    obs.update((cur) => cur.map((m) => (m.id === late.id ? { ...m, decryption: "ok" as const } : m)));
                }, 4000);
            }
        }
    }

    public async login(): Promise<void> {
        // Fake is always signed in.
    }

    public async completeLogin(): Promise<void> {
        // No-op.
    }

    public async restoreSession(): Promise<boolean> {
        return true;
    }

    public async logout(): Promise<void> {
        (this.session as Observable<SessionView | null>).set(null);
        (this.profile as Observable<ProfileView | null>).set(null);
    }

    public async start(): Promise<void> {
        (this.connection as Observable<ConnectionState>).set("syncing");
    }

    public async stop(): Promise<void> {
        (this.connection as Observable<ConnectionState>).set("stopped");
    }

    public timeline(roomId: string): Subscribable<MessageView[]> {
        let obs = this.timelines.get(roomId);
        if (!obs) {
            obs = new Observable<MessageView[]>([]);
            this.timelines.set(roomId, obs);
        }
        return obs;
    }

    public async loadMore(_roomId: string): Promise<boolean> {
        // Fake timelines are complete in memory: already at the start.
        return false;
    }

    public async search(roomId: string, term: string, opts?: { nextBatch?: string }): Promise<SearchPage> {
        const trimmed = term.trim().toLowerCase();
        if (trimmed.length === 0) return { hits: [], nextBatch: null, total: 0 };
        const held = this.timelines.get(roomId)?.get() ?? [];
        // Recent-first, substring match — Synapse-without-Seshat behavior.
        const all = held.filter((m) => m.body.toLowerCase().includes(trimmed)).reverse();
        const offset = Number.parseInt(opts?.nextBatch ?? "0", 10) || 0;
        const PAGE_SIZE = 5;
        const hits = all.slice(offset, offset + PAGE_SIZE);
        const next = offset + PAGE_SIZE < all.length ? String(offset + PAGE_SIZE) : null;
        return { hits, nextBatch: next, total: all.length };
    }

    public async jumpTo(roomId: string, eventId: string): Promise<boolean> {
        // Fixtures are fully loaded: present in the window or gone for good.
        return this.timelines.get(roomId)?.get().some((m) => m.id === eventId) ?? false;
    }

    public setRoomSelection(_roomId: string | null): void {
        // The fake has no sync window; selection is a UI concern here.
    }

    public async loadMoreRooms(): Promise<boolean> {
        // Fixtures are fully loaded; there is never more to page in.
        return false;
    }

    public hasMoreRooms(): boolean {
        return false;
    }

    // Monotonic id source for created rooms: fixtures use readable ids, new
    // ones just need to be unique and recognisable in the tree.
    private nextCreated = 1;

    private pushRoom(summary: RoomSummary, extraMemberId?: string): string {
        (this.rooms as Observable<RoomSummary[]>).update((cur) => [...cur, summary]);
        this.timelines.set(summary.id, new Observable<MessageView[]>([]));
        const roster = buildRoster(summary.id, this.selfMember());
        if (extraMemberId) {
            roster.push(member(extraMemberId, fallbackName(extraMemberId), 0, "join", "unknown", null));
            sortMembers(roster);
        }
        this.rosters.set(summary.id, roster);
        return summary.id;
    }

    public async createSpace(params: CreateSpaceParams): Promise<string> {
        return this.pushRoom({
            id: `!created-${this.nextCreated++}:fake`,
            name: params.name,
            topic: params.topic ?? null,
            avatarUrl: null,
            isSpace: true,
            parentSpaceIds: [],
            unreadCount: 0,
            highlightCount: 0,
            fullyReadEventId: null,
            joinRule: "invite",
            historyVisibility: "shared",
            canonicalAlias: null,
            favourite: false,
            favouriteOrder: null,
        });
    }

    public async createChannel(spaceId: string, params: CreateChannelParams): Promise<string> {
        // visibility/alias/encrypted don't surface in snapshots: the tree only
        // cares about the parent link the fake writes below.
        return this.pushRoom({
            id: `!created-${this.nextCreated++}:fake`,
            name: params.name,
            topic: params.topic ?? null,
            avatarUrl: null,
            isSpace: false,
            // The fake writes the same parent link the real one does, so the
            // channel lands under its guild in selectSpaceTree immediately.
            parentSpaceIds: [spaceId],
            unreadCount: 0,
            highlightCount: 0,
            fullyReadEventId: null,
            joinRule: "invite",
            historyVisibility: "shared",
            canonicalAlias: null,
            favourite: false,
            favouriteOrder: null,
        });
    }

    public async createDm(params: CreateDmParams): Promise<string> {
        // encrypted isn't tracked by the fake (nothing decrypts in it).
        const id = `!created-${this.nextCreated++}:fake`;
        return this.pushRoom({
            id,
            name: params.userId.slice(1).split(":")[0] ?? params.userId,
            topic: null,
            avatarUrl: null,
            isSpace: false,
            parentSpaceIds: [],
            unreadCount: 0,
            highlightCount: 0,
            fullyReadEventId: null,
            joinRule: "invite",
            historyVisibility: "shared",
            canonicalAlias: null,
            favourite: false,
            favouriteOrder: null,
        }, params.userId);
    }

    public async joinRoom(idOrAlias: string): Promise<string> {
        const existing = (this.rooms as Observable<RoomSummary[]>)
            .get()
            .find((r) => r.id === idOrAlias);
        if (existing) return existing.id;
        // Unknown id/alias: fake can't know the real room's parents, so it
        // lands as an orphan (DMs tab) — same honest rule as the real feed.
        return this.pushRoom({
            id: idOrAlias.startsWith("!") ? idOrAlias : `!created-${this.nextCreated++}:fake`,
            name: idOrAlias.replace(/^#/, "").split(":")[0] ?? idOrAlias,
            topic: null,
            avatarUrl: null,
            isSpace: false,
            parentSpaceIds: [],
            unreadCount: 0,
            highlightCount: 0,
            fullyReadEventId: null,
            joinRule: "invite",
            historyVisibility: "shared",
            canonicalAlias: null,
            favourite: false,
            favouriteOrder: null,
        });
    }

    public async leave(roomId: string): Promise<void> {
        (this.rooms as Observable<RoomSummary[]>).update((cur) => cur.filter((r) => r.id !== roomId));
        this.timelines.delete(roomId);
        this.threadTimelines.delete(roomId);
    }

    public async updateRoomSettings(roomId: string, patch: RoomSettingsPatch): Promise<void> {
        (this.rooms as Observable<RoomSummary[]>).update((cur) =>
            cur.map((room) => {
                if (room.id !== roomId) return room;
                const next: RoomSummary = { ...room };
                if (patch.name !== undefined) {
                    // Empty clear replays the real fallback-name behavior; the
                    // fake has no member-derived fallback, so keep the old name.
                    const name = patch.name.trim();
                    if (name.length > 0) next.name = name;
                }
                if (patch.topic !== undefined) {
                    const topic = patch.topic === null ? null : patch.topic.trim();
                    next.topic = topic && topic.length > 0 ? topic : null;
                }
                if (patch.avatar !== undefined) {
                    next.avatarUrl = patch.avatar === null ? null : `mxc://fake/avatar-${this.nextCreated++}`;
                }
                if (patch.joinRule !== undefined) next.joinRule = patch.joinRule;
                if (patch.historyVisibility !== undefined) next.historyVisibility = patch.historyVisibility;
                if (patch.canonicalAlias !== undefined) {
                    const alias = patch.canonicalAlias === null ? null : patch.canonicalAlias.trim();
                    next.canonicalAlias = alias && alias.length > 0 ? alias : null;
                }
                return next;
            }),
        );
    }

    public async invite(roomId: string, userId: string): Promise<void> {
        const roster = this.rosters.get(roomId);
        if (!roster) return;
        if (roster.some((m) => m.userId === userId)) return;
        roster.push(member(userId, fallbackName(userId), 0, "invite", "unknown", null));
        sortMembers(roster);
        this.publishRoom(roomId);
    }

    public async searchUsers(term: string, opts?: { limit?: number }): Promise<UserSearchResult[]> {
        const trimmed = term.trim().toLowerCase();
        if (trimmed.length === 0) return [];
        const all = SENDERS.map((userId) => ({
            userId,
            displayName: userId.slice(1).split(":")[0] ?? userId,
            avatarUrl: null,
        })).filter(
            (u) => u.userId.toLowerCase().includes(trimmed) || u.displayName.toLowerCase().includes(trimmed),
        );
        return all.slice(0, opts?.limit ?? 10);
    }

    public async toggleReaction(roomId: string, targetEventId: string, emoji: string): Promise<void> {
        const obs = this.timelines.get(roomId);
        if (!obs) return;
        const own = "@demo:example.com";
        const existing = obs
            .get()
            .find((m) => m.id === targetEventId)
            ?.reactions.find((r) => r.emoji === emoji && r.ownReacted);
        obs.update((cur) =>
            cur.map((m) => {
                if (m.id !== targetEventId) return m;
                const reactions = m.reactions.filter((r) => !(r.emoji === emoji && r.ownReacted));
                if (!existing) {
                    const prior = m.reactions.find((r) => r.emoji === emoji);
                    reactions.push({ emoji, count: (prior?.count ?? 0) + 1, ownReacted: true });
                }
                return { ...m, reactions: reactions.sort((a, b) => (a.emoji < b.emoji ? -1 : 1)) };
            }),
        );
    }

    public async setupRecovery(): Promise<string> {
        return "EsT fake fake fake fake fake fake fake fake fake fake fake fake";
    }

    public async restoreBackup(_recoveryKey: string): Promise<boolean> {
        // Already healthy; nothing to restore.
        return true;
    }

    public async markRead(_roomId: string): Promise<void> {
        // Fake rooms are always fully read.
    }

    public async edit(roomId: string, targetEventId: string, newBody: string): Promise<void> {
        const obs = this.timelines.get(roomId);
        if (!obs) return;
        obs.update((cur) =>
            cur.map((m) => (m.id === targetEventId ? { ...m, body: newBody, edited: true } : m)),
        );
    }

    public async redact(roomId: string, eventId: string, _reason?: string): Promise<void> {
        const obs = this.timelines.get(roomId);
        if (!obs) return;
        // Mirrors mapEvent on a redacted event: body tombstones, reply/edits
        // vanish, content strips. Reactions survive (a plain redaction doesn't
        // cascade to relations — same as the real feed).
        obs.update((cur) =>
            cur.map((m) =>
                m.id === eventId
                    ? { ...m, body: "Message deleted.", reply: null, edited: false, redacted: true, content: {} }
                    : m,
            ),
        );
    }

    public async sendTyping(_roomId: string, _isTyping: boolean): Promise<void> {
        // No-op in fake.
    }

    public async resolveMedia(uri: string, _size: number): Promise<string> {
        // Fixtures carry loadable URLs (or none); nothing to authenticate.
        return uri;
    }

    public async resolveMediaDownload(uri: string): Promise<string> {
        // Fixtures carry loadable URLs (or none); nothing to authenticate.
        return uri;
    }

    public async resolveEncryptedMedia(file: EncryptedAttachment): Promise<string> {
        // Fake client doesn't encrypt; return the plain URL.
        return file.url;
    }

    public async requestNotificationPermission(): Promise<NotificationPermission> {
        // Fake client reports granted but unsupported (no real Notification API).
        return "granted";
    }

    public supportsThreads(): boolean {
        return true;
    }

    public threads(roomId: string): Subscribable<ThreadSummary[]> {
        // The fixture thread lives in the general room only.
        return roomId === "!a-general:fake" ? this._threads : this.noThreads;
    }

    public threadTimeline(threadId: string): Subscribable<MessageView[]> {
        let obs = this.threadTimelines.get(threadId);
        if (!obs) {
            obs = new Observable<MessageView[]>([
                msg(threadId, "@alice:example.com", "thread root", Date.now() - 120_000),
                msg(`${threadId}:r1`, "@bob:example.com", "first reply", Date.now() - 90_000),
                msg(`${threadId}:r2`, "@alice:example.com", "second reply", Date.now() - 60_000),
            ]);
            this.threadTimelines.set(threadId, obs);
        }
        return obs;
    }

    public async markThreadRead(threadId: string): Promise<void> {
        this._threads.update((list) => list.map((t) => (t.rootEventId === threadId ? { ...t, unreadCount: 0 } : t)));
    }

    public async sendReply(_roomId: string, threadId: string, body: string): Promise<void> {
        const obs = this.threadTimelines.get(threadId);
        if (!obs) return;
        obs.update((cur) => [
            ...cur,
            msg(`${threadId}:local-${Date.now()}`, "@demo:example.com", body, Date.now(), { status: "sent" }),
        ]);
        if (threadId === "!a-general:fake:e0") {
            this._threads.update((list) =>
                list.map((t) => (t.rootEventId === threadId ? { ...t, replyCount: t.replyCount + 1, lastReplyTs: Date.now(), hasParticipated: true } : t)),
            );
        }
    }

    public async startVerification(): Promise<void> {
        // No-op in fake.
    }

    public async acceptVerification(_id: string): Promise<void> {
        // No-op in fake.
    }

    public async declineVerification(_id: string): Promise<void> {
        // No-op in fake.
    }

    public async confirmSas(_id: string): Promise<void> {
        // No-op in fake.
    }

    public async mismatchSas(_id: string): Promise<void> {
        // No-op in fake.
    }

    public async listDevices(): Promise<DeviceView[]> {
        return [
            { id: "FAKEDEVICE", displayName: "Fake browser", lastSeenTs: Date.now(), isCurrent: true, verified: true },
            { id: "FAKEPHONE", displayName: "Fake phone", lastSeenTs: null, isCurrent: false, verified: false },
        ];
    }

    public members(roomId: string): Subscribable<MemberView[]> {
        let feed = this.memberFeeds.get(roomId);
        if (!feed) {
            feed = new Observable<MemberView[]>(this.rosterFor(roomId).filter(isRosteredMember));
            this.memberFeeds.set(roomId, feed);
        }
        return feed;
    }

    public banned(roomId: string): Subscribable<MemberView[]> {
        let feed = this.bannedFeeds.get(roomId);
        if (!feed) {
            feed = new Observable<MemberView[]>(this.bannedFor(roomId));
            this.bannedFeeds.set(roomId, feed);
        }
        return feed;
    }

    public powerLevels(roomId: string): Subscribable<RoomPowerLevelsView | null> {
        let feed = this.powerLevelFeeds.get(roomId);
        if (!feed) {
            feed = new Observable<RoomPowerLevelsView | null>(this.powerLevelsFor(roomId));
            this.powerLevelFeeds.set(roomId, feed);
        }
        return feed;
    }

    public async loadMembers(roomId: string): Promise<void> {
        if (!this.rooms.get().some((r) => r.id === roomId)) {
            throw new Error(`Cannot load members for unknown room ${roomId}`);
        }
        // Fake rosters are complete in memory: nothing to fetch, but publish
        // anyway so the UI's loading → ready transition runs the same path.
        this.publishRoom(roomId);
    }

    public async setProfile(params: { displayName?: string; avatar?: Blob | null }): Promise<void> {
        const current = this.profile.get() ?? {
            userId: SELF_ID,
            displayName: fallbackName(SELF_ID),
            avatarUrl: null,
        };
        const next: ProfileView = { ...current };
        if (params.displayName !== undefined) {
            const trimmed = params.displayName.trim();
            // Empty clears to the localpart — same as the server echoing an
            // empty displayname back through readProfile()'s fallback.
            next.displayName = trimmed.length > 0 ? trimmed : fallbackName(current.userId);
        }
        if (params.avatar !== undefined) {
            next.avatarUrl = params.avatar === null ? null : URL.createObjectURL(params.avatar);
        }
        (this.profile as Observable<ProfileView | null>).set(next);
        // The self row in every roster follows the profile, the way a real
        // m.room.member rename does once the server echoes it.
        for (const [roomId, roster] of this.rosters) {
            if (!roster.some((m) => m.isSelf)) continue;
            this.rosters.set(
                roomId,
                sortMembers(roster.map((m) => (m.isSelf ? { ...m, displayName: next.displayName, avatarUrl: next.avatarUrl } : m))),
            );
            this.publishRoom(roomId);
        }
    }

    private selfMember(): MemberView {
        const profile = this.profile.get();
        return {
            userId: SELF_ID,
            displayName: profile?.displayName ?? fallbackName(SELF_ID),
            avatarUrl: profile?.avatarUrl ?? null,
            membership: "join",
            powerLevel: 100,
            isSelf: true,
            presence: "online",
            lastActiveTs: Date.now(),
        };
    }

    /** Unknown rooms are empty — same honest rule as the real tracker. */
    private rosterFor(roomId: string): MemberView[] {
        return this.rosters.get(roomId) ?? [];
    }

    private bannedFor(roomId: string): MemberView[] {
        return this.rosterFor(roomId).filter((m) => m.membership === "ban");
    }

    /**
     * The fake treats each member's effective level as an explicit override —
     * it has no separate `users_default` bookkeeping. The self row is the
     * admin (100), so every gate clears; the real floors are the spec defaults.
     */
    private powerLevelsFor(roomId: string): RoomPowerLevelsView | null {
        const roster = this.rosters.get(roomId);
        if (!roster) return null;
        const users: Record<string, number> = {};
        for (const m of roster) users[m.userId] = m.powerLevel;
        const myPowerLevel = roster.find((m) => m.isSelf)?.powerLevel ?? 0;
        return {
            users,
            usersDefault: 0,
            eventsDefault: 0,
            stateDefault: 50,
            ban: 50,
            kick: 50,
            redact: 50,
            invite: 0,
            events: {},
            myPowerLevel,
            canKick: myPowerLevel >= 50,
            canBan: myPowerLevel >= 50,
            canSetPowerLevel: myPowerLevel >= 50,
            canEditSettings: myPowerLevel >= 50,
        };
    }

    /** Publish every feed a roster change can touch (members, banned, power). */
    private publishRoom(roomId: string): void {
        this.memberFeeds.get(roomId)?.set(this.rosterFor(roomId).filter(isRosteredMember));
        this.bannedFeeds.get(roomId)?.set(this.bannedFor(roomId));
        const power = this.powerLevelFeeds.get(roomId);
        if (power) power.set(this.powerLevelsFor(roomId));
    }

    /** Refuse to act on self or someone at/above our level, like the server. */
    private assertCanModerate(roomId: string, userId: string): MemberView {
        const roster = this.rosters.get(roomId);
        if (!roster) throw new Error(`Unknown room ${roomId}`);
        const target = roster.find((m) => m.userId === userId);
        if (!target) throw new Error(`${userId} is not in ${roomId}`);
        const myPower = roster.find((m) => m.isSelf)?.powerLevel ?? 0;
        if (myPower < 50) throw new Error("Insufficient power to moderate this room");
        if (target.powerLevel >= myPower) throw new Error("Cannot moderate a member at or above your own power level");
        return target;
    }

    public async kick(roomId: string, userId: string, _reason?: string): Promise<void> {
        this.assertCanModerate(roomId, userId);
        const roster = this.rosters.get(roomId);
        if (!roster) return;
        // Kicked → gone from the roster (leave is not rostered), not banned.
        this.rosters.set(roomId, roster.filter((m) => m.userId !== userId));
        this.publishRoom(roomId);
    }

    public async ban(roomId: string, userId: string, _reason?: string): Promise<void> {
        this.assertCanModerate(roomId, userId);
        const roster = this.rosters.get(roomId);
        if (!roster) return;
        const idx = roster.findIndex((m) => m.userId === userId);
        const existing = idx >= 0 ? roster[idx]! : member(userId, fallbackName(userId), 0, "ban", "unknown", null);
        const banned: MemberView = { ...existing, membership: "ban" };
        if (idx >= 0) roster[idx] = banned;
        else roster.push(banned);
        sortMembers(roster);
        this.publishRoom(roomId);
    }

    public async unban(roomId: string, userId: string): Promise<void> {
        const roster = this.rosters.get(roomId);
        if (!roster) return;
        // Unban → leave, so the user drops off `banned()` without reappearing.
        this.rosters.set(roomId, roster.filter((m) => m.userId !== userId));
        this.publishRoom(roomId);
    }

    public async setPowerLevel(roomId: string, userId: string, powerLevel: number): Promise<void> {
        const target = this.assertCanModerate(roomId, userId);
        const roster = this.rosters.get(roomId);
        if (!roster) return;
        target.powerLevel = powerLevel;
        sortMembers(roster);
        this.publishRoom(roomId);
    }

    public async send(roomId: string, body: string, replyToEventId?: string): Promise<void> {
        const obs = this.timelines.get(roomId);
        if (!obs) return;
        // Quote from the fixture timeline when the target is loaded — the
        // real client does the same via `room.findEventById`.
        const target = replyToEventId ? obs.get().find((m) => m.id === replyToEventId) : undefined;
        const echo: MessageView = msg(
            `${roomId}:local-${Date.now()}`,
            "@demo:example.com",
            body,
            Date.now(),
            {
                status: "sending",
                reply: replyToEventId
                    ? {
                          eventId: replyToEventId,
                          senderId: target?.senderId ?? "",
                          senderName: target?.senderName ?? "",
                          body: target?.body ?? "",
                      }
                    : null,
            },
        );
        obs.update((cur) => [...cur.slice(-(FAKE_TIMELINE_CAP - 1)), echo]);
        setTimeout(() => {
            obs.update((cur) => cur.map((m) => (m.id === echo.id ? { ...m, status: "sent" as const } : m)));
        }, 300);
    }

    public async sendMediaMessage(roomId: string, file: File | Blob, body?: string): Promise<void> {
        const obs = this.timelines.get(roomId);
        if (!obs) return;
        const name = file instanceof File ? file.name : "file";
        const msgtype = file.type.startsWith("image/")
            ? "m.image"
            : file.type.startsWith("video/")
              ? "m.video"
              : file.type.startsWith("audio/")
                ? "m.audio"
                : "m.file";
        const echo: MessageView = msg(
            `${roomId}:local-${Date.now()}`,
            "@demo:example.com",
            body ?? name,
            Date.now(),
            {
                status: "sending",
                type: "m.room.message",
                content: {
                    msgtype,
                    body: body ?? name,
                    url: `mxc://fake/${Date.now().toString(36)}`,
                    info: { mimetype: file.type, size: file.size },
                },
            },
        );
        obs.update((cur) => [...cur.slice(-(FAKE_TIMELINE_CAP - 1)), echo]);
        setTimeout(() => {
            obs.update((cur) => cur.map((m) => (m.id === echo.id ? { ...m, status: "sent" as const } : m)));
        }, 300);
    }

    public async retry(roomId: string, eventId: string): Promise<void> {
        const obs = this.timelines.get(roomId);
        if (!obs) return;
        const failed = obs.get().find((m) => m.id === eventId && m.status === "failed");
        if (!failed) return;
        // Mirror the SDK: the pending echo goes back to SENDING and settles
        // SENT (the fixture's failure never repeats on retry — deterministic).
        obs.update((cur) =>
            cur.map((m) => (m.id === eventId ? { ...m, status: "sending" as const } : m)),
        );
        setTimeout(() => {
            obs.update((cur) =>
                cur.map((m) => (m.id === eventId ? { ...m, status: "sent" as const } : m)),
            );
        }, 300);
    }
}

export function createFakeChatClient(options: FakeOptions = {}): ChatClient {
    return new FakeChatClient(options.seed ?? 1337);
}
