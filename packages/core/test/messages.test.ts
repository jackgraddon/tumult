import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventStatus, type MatrixClient } from "matrix-js-sdk";

import type { MessageView, SearchPage } from "../src/contract.ts";
import { createFakeChatClient } from "../src/fake/index.ts";
import { redactEvent } from "../src/rooms/redact.ts";
import { SEARCH_PAGE_SIZE, searchRoomHistory } from "../src/rooms/search.ts";
import { TimelineFeed } from "../src/timeline/feed.ts";
import { mapEvent, type MappableEvent } from "../src/timeline/map.ts";

function mappable(over: Partial<MappableEvent> = {}): MappableEvent {
    return {
        getId: () => "$h:localhost",
        getType: () => "m.room.message",
        getSender: () => "@alice:localhost",
        getTs: () => 1700000000000,
        getContent: () => ({ msgtype: "m.text", body: "needle" }),
        isEncrypted: () => false,
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        status: null,
        clearEvent: {},
        // The feed's collectors reach for these before mapping.
        getStateKey: () => null,
        getRelation: () => undefined,
        ...over,
    } as MappableEvent;
}

describe("redactEvent", () => {
    it("uses the two-arg call when no reason is given", async () => {
        const calls: unknown[][] = [];
        const matrix = {
            redactEvent: async (...args: unknown[]) => {
                calls.push(args);
                return { event_id: "$red:localhost" };
            },
        } as unknown as MatrixClient;
        await redactEvent(matrix, "!r:localhost", "$e:localhost");
        assert.deepEqual(calls, [["!r:localhost", "$e:localhost"]]);
    });

    it("passes a reason through the opts argument", async () => {
        const calls: unknown[][] = [];
        const matrix = {
            redactEvent: async (...args: unknown[]) => {
                calls.push(args);
                return { event_id: "$red:localhost" };
            },
        } as unknown as MatrixClient;
        await redactEvent(matrix, "!r:localhost", "$e:localhost", "spam");
        assert.deepEqual(calls[0], ["!r:localhost", "$e:localhost", undefined, { reason: "spam" }]);
    });

    it("propagates homeserver failures", async () => {
        const matrix = {
            redactEvent: async () => {
                throw new Error("M_FORBIDDEN");
            },
        } as unknown as MatrixClient;
        await assert.rejects(() => redactEvent(matrix, "!r:localhost", "$e:localhost"), /M_FORBIDDEN/);
    });
});

describe("searchRoomHistory", () => {
    interface SearchCall {
        body: Record<string, any>;
        next_batch?: string;
    }

    function searchStub(
        hits: MappableEvent[],
        meta: { count?: number; next_batch?: string } = {},
    ): { matrix: MatrixClient; calls: SearchCall[] } {
        const response = {
            search_categories: {
                room_events: {
                    ...(meta.count !== undefined ? { count: meta.count } : {}),
                    ...(meta.next_batch !== undefined ? { next_batch: meta.next_batch } : {}),
                    highlights: [],
                    results: hits.map((event) => ({ rank: 0, event })),
                },
            },
        };
        const calls: SearchCall[] = [];
        const matrix = {
            search: async (params: SearchCall) => {
                calls.push(params);
                return response;
            },
            // The real one maps raw JSON through getEventMapper; the stub hands
            // back mappable events so the mapping path under test is ours.
            processRoomEventsSearch: (acc: Record<string, any>, res: any) => {
                const roomEvents = res.search_categories.room_events;
                if (roomEvents.count !== undefined) acc.count = roomEvents.count;
                if (roomEvents.next_batch !== undefined) acc.next_batch = roomEvents.next_batch;
                acc.results = roomEvents.results.map((r: any) => ({
                    context: { getEvent: () => r.event },
                }));
                return acc;
            },
        };
        return { matrix: matrix as unknown as MatrixClient, calls };
    }

    it("doesn't spend a roundtrip on an empty term", async () => {
        const { matrix, calls } = searchStub([]);
        assert.deepEqual(await searchRoomHistory(matrix, "!r:localhost", "   "), {
            hits: [],
            nextBatch: null,
            total: 0,
        });
        assert.equal(calls.length, 0);
    });

    it("builds a room-scoped, recent-first, page-sized body and maps hits", async () => {
        const hit = mappable({
            getId: () => "$h1:localhost",
            getContent: () => ({ msgtype: "m.text", body: "the needle" }),
        });
        const { matrix, calls } = searchStub([hit], { count: 7, next_batch: "p2" });
        const page = await searchRoomHistory(matrix, "!r:localhost", "  Needle  ");

        assert.equal(calls.length, 1);
        const roomEvents = calls[0]?.body.search_categories.room_events;
        // Trimmed, case preserved: server-side FTS folds case for us (the fake
        // folds locally because it has no index to lean on).
        assert.equal(roomEvents.search_term, "Needle");
        assert.deepEqual(roomEvents.filter, { rooms: ["!r:localhost"], limit: SEARCH_PAGE_SIZE });
        assert.equal(roomEvents.order_by, "recent");
        assert.deepEqual(roomEvents.event_context, {
            before_limit: 1,
            after_limit: 1,
            include_profile: true,
        });
        assert.equal("next_batch" in (calls[0] ?? {}), false, "first page carries no batch token");

        assert.equal(page.total, 7);
        assert.equal(page.nextBatch, "p2");
        assert.equal(page.hits.length, 1);
        // Hits are ordinary MessageViews: mapEvent ran, not a passthrough.
        const mapped = page.hits[0];
        assert.equal(mapped?.id, "$h1:localhost");
        assert.equal(mapped?.body, "the needle");
        assert.equal(mapped?.status, "sent");
        assert.equal(mapped?.decryption, "ok");
    });

    it("threads the batch token through on later pages", async () => {
        const { matrix, calls } = searchStub([]);
        await searchRoomHistory(matrix, "!r:localhost", "x", "p2");
        assert.equal(calls[0]?.next_batch, "p2");
    });

    it("falls back to hits.length / null when the server omits count and batch", async () => {
        const { matrix } = searchStub([mappable()]);
        const page = await searchRoomHistory(matrix, "!r:localhost", "x");
        assert.equal(page.total, 1);
        assert.equal(page.nextBatch, null);
    });

    it("propagates search failures", async () => {
        const matrix = {
            search: async () => {
                throw new Error("Search is disabled on this homeserver");
            },
        } as unknown as MatrixClient;
        await assert.rejects(
            () => searchRoomHistory(matrix, "!r:localhost", "x"),
            /Search is disabled/,
        );
    });
});

describe("fake redact", () => {
    it("tombstones the target like mapEvent would, and only the target", async () => {
        const client = createFakeChatClient();
        const roomId = "!dm-0:fake";
        const before = client.timeline(roomId).get();
        const target = before.find((m) => m.reply !== null);
        assert.ok(target, "fixture must carry an inline reply");
        const count = before.length;

        await client.redact(roomId, target.id, "reason ignored by the fake");

        const after = client.timeline(roomId).get();
        assert.equal(after.length, count, "redaction never adds or drops rows");
        const tomb = after.find((m) => m.id === target.id);
        assert.equal(tomb?.body, "Message deleted.");
        assert.equal(tomb?.redacted, true);
        assert.equal(tomb?.reply, null, "a stripped event has no quote to render");
        assert.equal(tomb?.edited, false);
        assert.deepEqual(tomb?.content, {});
        // Everyone else is untouched (same references, same bodies).
        for (const other of before) {
            if (other.id === target.id) continue;
            const now = after.find((m) => m.id === other.id);
            assert.equal(now?.body, other.body);
            assert.equal(now?.redacted, other.redacted);
        }
    });

    it("keeps a redaction's reactions (a plain redaction doesn't cascade)", async () => {
        const client = createFakeChatClient();
        const roomId = "!dm-0:fake";
        const target = client.timeline(roomId).get().find((m) => m.reactions.length > 0);
        assert.ok(target, "fixture must carry reactions");
        await client.redact(roomId, target.id);
        const after = client.timeline(roomId).get().find((m) => m.id === target.id);
        assert.deepEqual(after?.reactions, target.reactions);
    });

    it("ignores unknown ids", async () => {
        const client = createFakeChatClient();
        const roomId = "!dm-0:fake";
        const before = client.timeline(roomId).get();
        await client.redact(roomId, "$nope:localhost");
        assert.deepEqual(client.timeline(roomId).get(), before);
    });
});

describe("fake search", () => {
    it("returns nothing for an empty term", async () => {
        const client = createFakeChatClient();
        assert.deepEqual(await client.search("!dm-0:fake", "   "), {
            hits: [],
            nextBatch: null,
            total: 0,
        });
    });

    it("matches case-insensitively on a fixed fixture string", async () => {
        const client = createFakeChatClient();
        const page = await client.search("!dm-0:fake", "  LUNCH ");
        assert.equal(page.total, 1, "only the poll fixture says lunch");
        assert.equal(page.hits[0]?.id, "!dm-0:fake:poll");
        assert.equal(page.nextBatch, null);
    });

    it("orders most recent first", async () => {
        const client = createFakeChatClient();
        // Every seeded body contains "i", so page one is guaranteed full.
        const page = await client.search("!dm-0:fake", "i");
        assert.equal(page.hits.length, 5);
        for (let i = 1; i < page.hits.length; i++) {
            const newer = page.hits[i - 1];
            const older = page.hits[i];
            assert.ok(
                newer !== undefined && older !== undefined && newer.timestamp >= older.timestamp,
                "recent first",
            );
        }
        // The batch token exists exactly when results remain.
        assert.equal(page.hits.length === page.total, page.nextBatch === null);
    });

    it("pages through every hit without repeats", async () => {
        const client = createFakeChatClient();
        // Every seeded body contains "i", so this is guaranteed to span pages.
        const seen: string[] = [];
        let next: string | undefined;
        let total = -1;
        for (let batch = 0; batch < 20; batch++) {
            const res: SearchPage = await client.search(
                "!dm-0:fake",
                "i",
                next === undefined ? undefined : { nextBatch: next },
            );
            if (total === -1) total = res.total;
            assert.equal(res.total, total, "total is stable across pages");
            assert.ok(res.hits.length <= 5);
            for (const hit of res.hits) {
                assert.ok(!seen.includes(hit.id), `duplicate hit ${hit.id}`);
                seen.push(hit.id);
            }
            if (res.nextBatch === null) break;
            next = res.nextBatch;
        }
        assert.ok(total > 5, "the fixture must span more than one page");
        assert.equal(seen.length, total, "the walk saw every match exactly once");
    });
});

describe("fake jumpTo and read marker", () => {
    it("resolves on held ids and misses on unknown ones", async () => {
        const client = createFakeChatClient();
        assert.equal(await client.jumpTo("!dm-0:fake", "!dm-0:fake:e3"), true);
        assert.equal(await client.jumpTo("!dm-0:fake", "$nope:localhost"), false);
        assert.equal(await client.jumpTo("!ghost:fake", "!dm-0:fake:e3"), false);
    });

    it("ships a mid-history marker the divider can actually render", async () => {
        const client = createFakeChatClient();
        const room = client.rooms.get().find((r) => r.id === "!a-general:fake");
        assert.equal(room?.fullyReadEventId, "!a-general:fake:e18");
        const timeline = client.timeline("!a-general:fake").get();
        const index = timeline.findIndex((m) => m.id === room?.fullyReadEventId);
        assert.ok(index >= 0, "the marker must point at a real message");
        assert.ok(index < timeline.length - 1, "something newer must follow it");
    });
});

describe("TimelineFeed.markRead", () => {
    interface FeedWorld {
        matrix: MatrixClient;
        live: MappableEvent[];
        stats: { scrollbacks: number; markers: Array<[string, string, unknown]>; receipts: unknown[] };
    }

    function feedWorld(
        opts: {
            initial: MappableEvent[];
            pages?: MappableEvent[][];
            infinite?: boolean;
            markerThrows?: boolean;
            room?: boolean;
        },
    ): FeedWorld {
        const live = [...opts.initial];
        const queue = [...(opts.pages ?? [])];
        const stats: FeedWorld["stats"] = { scrollbacks: 0, markers: [], receipts: [] };
        const room = {
            roomId: "!r:x",
            getLiveTimeline: () => ({
                getEvents: () => live,
                getPaginationToken: () => ((opts.infinite ?? false) || queue.length > 0 ? "tok" : null),
            }),
            on: () => undefined,
            removeListener: () => true,
            getUsersReadUpTo: () => [],
        };
        const matrix = {
            getUserId: () => "@me:x",
            getRoom: (id: string) => ((opts.room ?? true) && id === "!r:x" ? room : null),
            on: () => undefined,
            removeListener: () => true,
            scrollback: async () => {
                stats.scrollbacks++;
                if (opts.infinite) {
                    live.push(mappable({ getId: () => `$inf${stats.scrollbacks}:x` }));
                } else {
                    const page = queue.shift();
                    if (page) live.push(...page);
                }
                return {};
            },
            setRoomReadMarkers: async (...args: [string, string, unknown]) => {
                if (opts.markerThrows) throw new Error("M_UNRECOGNIZED");
                stats.markers.push(args);
            },
            sendReadReceipt: async (event: unknown) => {
                stats.receipts.push(event);
            },
        };
        return { matrix: matrix as unknown as MatrixClient, live, stats };
    }

    function ev(id: string, status: EventStatus | null = null): MappableEvent {
        return mappable({ getId: () => id, status });
    }

    async function withoutConsole<T>(
        level: "debug" | "error",
        fn: () => Promise<T>,
    ): Promise<{ value: T; logs: unknown[][] }> {
        const original = console[level];
        const logs: unknown[][] = [];
        console[level] = (...args: unknown[]) => {
            logs.push(args);
        };
        try {
            return { value: await fn(), logs };
        } finally {
            console[level] = original;
        }
    }

    it("writes marker and receipt at the newest acknowledged event", async () => {
        const w = feedWorld({ initial: [ev("$a"), ev("$b")] });
        const feed = new TimelineFeed(w.matrix);
        try {
            feed.timeline("!r:x");
            await feed.markRead("!r:x");
            assert.equal(w.stats.markers.length, 1);
            const [roomId, eventId, event] = w.stats.markers[0] ?? [];
            assert.equal(roomId, "!r:x");
            assert.equal(eventId, "$b");
            assert.equal((event as MappableEvent)?.getId?.(), "$b");
            assert.equal(w.stats.receipts.length, 0, "the marker call carries the receipt too");
        } finally {
            feed.detachAll();
        }
    });

    it("skips our own pending local echo", async () => {
        const w = feedWorld({ initial: [ev("$a"), ev("~echo", EventStatus.SENDING)] });
        const feed = new TimelineFeed(w.matrix);
        try {
            feed.timeline("!r:x");
            await feed.markRead("!r:x");
            assert.equal(w.stats.markers[0]?.[1], "$a");
        } finally {
            feed.detachAll();
        }
    });

    it("throttles repeats and fires again when the tail moves", async () => {
        const w = feedWorld({ initial: [ev("$a"), ev("$b")] });
        const feed = new TimelineFeed(w.matrix);
        try {
            feed.timeline("!r:x");
            await feed.markRead("!r:x");
            await feed.markRead("!r:x");
            assert.equal(w.stats.markers.length, 1, "nothing new, no request");

            w.live.push(ev("$c"));
            await feed.markRead("!r:x");
            assert.equal(w.stats.markers.length, 2);
            assert.equal(w.stats.markers[1]?.[1], "$c");
        } finally {
            feed.detachAll();
        }
    });

    it("falls back to a receipt when the marker endpoint refuses", async () => {
        const w = feedWorld({ initial: [ev("$a")], markerThrows: true });
        const feed = new TimelineFeed(w.matrix);
        try {
            feed.timeline("!r:x");
            const { logs } = await withoutConsole("error", () => feed.markRead("!r:x"));
            assert.equal(w.stats.markers.length, 0);
            assert.equal(w.stats.receipts.length, 1, "the slice-9 receipt must survive");
            assert.equal(
                (w.stats.receipts[0] as MappableEvent)?.getId?.(),
                "$a",
                "the fallback points at the same event",
            );
            assert.ok(String(logs[0]?.[0]).includes("read marker failed"));
        } finally {
            feed.detachAll();
        }
    });

    it("resolves quietly when the room isn't in the store", async () => {
        const w = feedWorld({ initial: [ev("$a")], room: false });
        const feed = new TimelineFeed(w.matrix);
        try {
            feed.timeline("!r:x");
            await feed.markRead("!r:x");
            await feed.markRead("!missing:x");
            assert.equal(w.stats.markers.length, 0);
            assert.equal(w.stats.receipts.length, 0);
        } finally {
            feed.detachAll();
        }
    });

    it("marks read even when nobody built the feed yet", async () => {
        const w = feedWorld({ initial: [ev("$a"), ev("$b")] });
        const feed = new TimelineFeed(w.matrix);
        try {
            await feed.markRead("!r:x");
            assert.equal(w.stats.markers.length, 1);
            assert.equal(w.stats.markers[0]?.[1], "$b");
        } finally {
            feed.detachAll();
        }
    });
});

describe("TimelineFeed.jumpTo", () => {
    function ev(id: string): MappableEvent {
        return mappable({ getId: () => id });
    }

    // Mirrors the world builder above; jumpTo needs scrollback paging.
    function jumpWorld(opts: {
        initial: MappableEvent[];
        pages?: MappableEvent[][];
        infinite?: boolean;
    }): { matrix: MatrixClient; stats: { scrollbacks: number } } {
        const live = [...opts.initial];
        const queue = [...(opts.pages ?? [])];
        const stats = { scrollbacks: 0 };
        const room = {
            roomId: "!r:x",
            getLiveTimeline: () => ({
                getEvents: () => live,
                getPaginationToken: () => ((opts.infinite ?? false) || queue.length > 0 ? "tok" : null),
            }),
            on: () => undefined,
            removeListener: () => true,
            getUsersReadUpTo: () => [],
        };
        const matrix = {
            getUserId: () => "@me:x",
            getRoom: (id: string) => (id === "!r:x" ? room : null),
            on: () => undefined,
            removeListener: () => true,
            scrollback: async () => {
                stats.scrollbacks++;
                if (opts.infinite) {
                    live.push(mappable({ getId: () => `$inf${stats.scrollbacks}:x` }));
                } else {
                    const page = queue.shift();
                    if (page) live.push(...page);
                }
                return {};
            },
        };
        return { matrix: matrix as unknown as MatrixClient, stats };
    }

    async function quiet<T>(fn: () => Promise<T>): Promise<T> {
        const original = console.debug;
        console.debug = () => undefined;
        try {
            return await fn();
        } finally {
            console.debug = original;
        }
    }

    it("resolves without paging when the target is already held", async () => {
        const w = jumpWorld({ initial: [ev("$a"), ev("$t")] });
        const feed = new TimelineFeed(w.matrix);
        try {
            assert.equal(await quiet(() => feed.jumpTo("!r:x", "$t")), true);
            assert.equal(w.stats.scrollbacks, 0);
        } finally {
            feed.detachAll();
        }
    });

    it("pages until the target lands, then stops", async () => {
        const w = jumpWorld({ initial: [ev("$a")], pages: [[ev("$b")], [ev("$t")]] });
        const feed = new TimelineFeed(w.matrix);
        try {
            assert.equal(await quiet(() => feed.jumpTo("!r:x", "$t")), true);
            assert.equal(w.stats.scrollbacks, 2, "stops the page the target arrives on");
        } finally {
            feed.detachAll();
        }
    });

    it("returns false once history runs out", async () => {
        const w = jumpWorld({ initial: [ev("$a")] });
        const feed = new TimelineFeed(w.matrix);
        try {
            assert.equal(await quiet(() => feed.jumpTo("!r:x", "$gone")), false);
            assert.equal(w.stats.scrollbacks, 1, "one look, then the token says start");
        } finally {
            feed.detachAll();
        }
    });

    it("never walks past the jump bound", async () => {
        const w = jumpWorld({ initial: [ev("$a")], infinite: true });
        const feed = new TimelineFeed(w.matrix);
        try {
            assert.equal(await quiet(() => feed.jumpTo("!r:x", "$never")), false);
            // JUMP_MAX_PAGES (12) pages cover the whole 500-event window.
            assert.equal(w.stats.scrollbacks, 12);
        } finally {
            feed.detachAll();
        }
    });

    it("collapses concurrent jumps onto one in-flight pagination", async () => {
        const w = jumpWorld({ initial: [ev("$a")], pages: [[ev("$t")]] });
        const feed = new TimelineFeed(w.matrix);
        try {
            // One quiet() wrapper: nesting would restore console.debug out of order.
            const [a, b] = await quiet(async () => {
                const first = feed.jumpTo("!r:x", "$t");
                const second = feed.jumpTo("!r:x", "$t");
                return Promise.all([first, second]);
            });
            assert.equal(a, true);
            assert.equal(b, true);
            assert.equal(w.stats.scrollbacks, 1);
        } finally {
            feed.detachAll();
        }
    });

    it("misses on a room the store doesn't know", async () => {
        const w = jumpWorld({ initial: [ev("$a")] });
        const feed = new TimelineFeed(w.matrix);
        try {
            assert.equal(await quiet(() => feed.jumpTo("!nope:x", "$a")), false);
            assert.equal(w.stats.scrollbacks, 0, "no room, no scrollback");
        } finally {
            feed.detachAll();
        }
    });
});

describe("mapEvent through the feed's redaction lens", () => {
    it("tombstones an already-redacted event", () => {
        const view: MessageView = mapEvent(
            mappable({
                isRedacted: () => true,
                getContent: () => ({}),
            }),
        );
        assert.equal(view.body, "Message deleted.");
        assert.equal(view.redacted, true);
        assert.equal(view.reply, null, "a stripped event carries no reply relation");
    });
});
