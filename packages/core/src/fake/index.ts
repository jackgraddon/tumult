import type {
    ChatClient,
    ConnectionState,
    MessageView,
    RoomSummary,
    SessionView,
    Subscribable,
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
    private readonly timelines = new Map<string, Observable<MessageView[]>>();
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
