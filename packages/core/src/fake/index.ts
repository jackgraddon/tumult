import type {
    ChatClient,
    ConnectionState,
    DeviceView,
    MessageView,
    RoomSummary,
    SecurityStatus,
    SessionView,
    Subscribable,
    ThreadSummary,
    TypingState,
    VerificationState,
} from "../contract.ts";
import { Observable } from "../observable.ts";

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
        body,
        timestamp,
        status: "sent",
        decryption: "ok",
        content: { msgtype: "m.text", body },
        reactions: [],
        readBy: [],
        edited: false,
        ...extra,
    };
}

function buildRooms(): RoomSummary[] {
    const rooms: RoomSummary[] = [];
    const space = (id: string, name: string, parents: string[] = [], unread = 0, highlight = 0): void => {
        rooms.push({
            id,
            name,
            topic: null,
            avatarUrl: null,
            isSpace: true,
            parentSpaceIds: parents,
            unreadCount: unread,
            highlightCount: highlight,
        });
    };
    const chan = (id: string, name: string, parents: string[] = [], unread = 0, highlight = 0): void => {
        rooms.push({
            id,
            name,
            topic: `${name} discussion`,
            avatarUrl: null,
            isSpace: false,
            parentSpaceIds: parents,
            unreadCount: unread,
            highlightCount: highlight,
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
    const dmNames = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy"];
    dmNames.forEach((n, i) => {
        chan(`!dm-${i}:fake`, n, [], i === 0 ? 105 : i, i === 1 ? 2 : 0);
    });

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
        out.push(
            msg(
                `${roomId}:e${i}`,
                pick(SENDERS),
                pick(BODIES),
                t,
                {
                    status: pick(statuses),
                    decryption: pick(decryptions),
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
        msg(`${roomId}:deleted`, "@bob:example.com", "Message deleted.", now - 7000_000),
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

class FakeChatClient implements ChatClient {
    public readonly session: Subscribable<SessionView | null>;
    public readonly connection: Subscribable<ConnectionState>;
    public readonly rooms: Subscribable<RoomSummary[]>;
    public readonly security: Subscribable<SecurityStatus>;
    public readonly verification: Subscribable<VerificationState>;
    public readonly typing: Subscribable<TypingState>;
    public readonly _threads: Subscribable<ThreadSummary[]>;
    private readonly timelines = new Map<string, Observable<MessageView[]>>();
    private readonly threadTimelines = new Map<string, Observable<MessageView[]>>();
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
        // One thread in the general room.
        this._threads = new Observable<ThreadSummary[]>([
            { rootEventId: "!a-general:fake:e0", replyCount: 2, lastReplyTs: Date.now() - 60_000, unreadCount: 1, hasParticipated: false },
        ]);

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

    public async sendTyping(_roomId: string, _isTyping: boolean): Promise<void> {
        // No-op in fake.
    }

    public threads(_roomId: string): Subscribable<ThreadSummary[]> {
        return this._threads;
    }

    public threadTimeline(threadId: string): Subscribable<MessageView[]> {
        let obs = this.threadTimelines.get(threadId);
        if (!obs) {
            obs = new Observable<MessageView[]>([
                msg(`${threadId}:root`, "@alice:example.com", "thread root", Date.now() - 120_000),
                msg(`${threadId}:r1`, "@bob:example.com", "first reply", Date.now() - 90_000),
                msg(`${threadId}:r2`, "@alice:example.com", "second reply", Date.now() - 60_000),
            ]);
            this.threadTimelines.set(threadId, obs);
        }
        return obs;
    }

    public async markThreadRead(_threadId: string): Promise<void> {
        // No-op in fake.
    }

    public async sendReply(_roomId: string, threadId: string, body: string): Promise<void> {
        const obs = this.threadTimelines.get(threadId);
        if (!obs) return;
        obs.update((cur) => [
            ...cur,
            msg(`${threadId}:local-${Date.now()}`, "@demo:example.com", body, Date.now(), { status: "sent" }),
        ]);
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

    public async send(roomId: string, body: string): Promise<void> {
        const obs = this.timelines.get(roomId);
        if (!obs) return;
        const echo: MessageView = msg(
            `${roomId}:local-${Date.now()}`,
            "@demo:example.com",
            body,
            Date.now(),
            { status: "sending" },
        );
        obs.update((cur) => [...cur.slice(-(FAKE_TIMELINE_CAP - 1)), echo]);
        setTimeout(() => {
            obs.update((cur) => cur.map((m) => (m.id === echo.id ? { ...m, status: "sent" as const } : m)));
        }, 300);
    }
}

export function createFakeChatClient(options: FakeOptions = {}): ChatClient {
    return new FakeChatClient(options.seed ?? 1337);
}
