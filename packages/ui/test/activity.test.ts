import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineComponent } from "vue";
import type {
    ChatClient,
    ConnectionState,
    OwnActivityView,
    OwnPresenceState,
    Subscribable,
    Subscription,
} from "@tumult/core";

import { ActivityRenderersRegistry, type ActivityRenderer } from "../src/members/activity.ts";
import { ActivityController } from "../src/activity/controller.ts";
import {
    ACTIVITY_FIELD_KEY,
    activityHeadline,
    activityProgress,
    activityStatusText,
    createActivity,
    parseActivity,
    sameActivity,
} from "../src/activity/document.ts";
import type { NativeActivity, NativeActivityFeed } from "../src/plugins/types.ts";

const Comp = defineComponent({ render: () => null });

function renderer(overrides: Partial<ActivityRenderer> & { id: string }): ActivityRenderer {
    return { key: "app.k", component: Comp, ...overrides };
}

describe("ActivityRenderersRegistry.resolve", () => {
    it("resolves nothing without a non-null value", () => {
        const registry = new ActivityRenderersRegistry({} as ChatClient);
        registry.add(renderer({ id: "a" }));
        assert.equal(registry.resolve(new Map()), null);
        assert.equal(registry.resolve(new Map([["app.k", null]])), null);
    });

    it("picks the highest-priority renderer that matches", () => {
        const registry = new ActivityRenderersRegistry({} as ChatClient);
        registry.add(renderer({ id: "low" }));
        registry.add(renderer({ id: "high", priority: 5, match: (v) => v === "special" }));
        assert.equal(registry.resolve(new Map([["app.k", "plain"]]))?.renderer.id, "low");
        assert.equal(registry.resolve(new Map([["app.k", "special"]]))?.renderer.id, "high");
    });

    it("reads each renderer's own key", () => {
        const registry = new ActivityRenderersRegistry({} as ChatClient);
        registry.add(renderer({ id: "a", key: "app.a" }));
        registry.add(renderer({ id: "b", key: "app.b", priority: 1 }));
        const resolved = registry.resolve(new Map([["app.a", 1]]));
        assert.equal(resolved?.renderer.id, "a");
        assert.equal(resolved?.value, 1);
    });

    it("treats a throwing match as a refusal, not a crash", () => {
        const registry = new ActivityRenderersRegistry({} as ChatClient);
        registry.add(renderer({ id: "bad", priority: 9, match: () => { throw new Error("boom"); } }));
        registry.add(renderer({ id: "good" }));
        const originalError = console.error;
        console.error = () => {};
        try {
            assert.equal(registry.resolve(new Map([["app.k", 1]]))?.renderer.id, "good");
        } finally {
            console.error = originalError;
        }
    });

    it("disposes exactly its own registration", () => {
        const registry = new ActivityRenderersRegistry({} as ChatClient);
        const dispose = registry.add(renderer({ id: "a" }));
        dispose();
        assert.equal(registry.resolve(new Map([["app.k", 1]])), null);
    });
});

class Feed<T> implements Subscribable<T> {
    private readonly listeners = new Set<(value: T) => void>();
    private value: T;
    private readonly immediate: boolean;

    public constructor(value: T, immediate = true) {
        this.value = value;
        this.immediate = immediate;
    }

    public get(): T {
        return this.value;
    }

    public set(value: T): void {
        this.value = value;
        for (const listener of [...this.listeners]) listener(value);
    }

    public subscribe(listener: (value: T) => void): Subscription {
        this.listeners.add(listener);
        if (this.immediate) listener(this.value);
        return { unsubscribe: () => this.listeners.delete(listener) };
    }
}

function nativeFeed(initial: NativeActivity | null): NativeActivityFeed & { set(value: NativeActivity | null): void } {
    const feed = new Feed(initial);
    return {
        current: () => feed.get(),
        subscribe: (callback) => {
            const subscription = feed.subscribe(callback);
            return () => subscription.unsubscribe();
        },
        set: (value) => feed.set(value),
    };
}

interface Harness {
    client: ChatClient;
    field: Feed<unknown>;
    ownActivity: Feed<OwnActivityView | null>;
    connection: Feed<ConnectionState>;
    presence: Feed<{ presence: OwnPresenceState; statusMessage?: string } | null>;
    native: ReturnType<typeof nativeFeed>;
    presenceWrites: Array<string | undefined>;
    ownWrites: Array<unknown>;
    setSupported(value: boolean): void;
    /** A write from another device on this account, as Sync would deliver it. */
    remoteActivity(document: unknown | null): void;
}

function harness(
    initialField: unknown = null,
    initialNative: NativeActivity | null = null,
    initialOwn: unknown = null,
): Harness {
    // Core's profileField() is lazy and does NOT deliver on subscribe; the
    // native feed does. The harness deliberately keeps that asymmetry.
    const field = new Feed(initialField, false);
    const ownActivity = new Feed<OwnActivityView | null>(null, false);
    const connection = new Feed<ConnectionState>("syncing");
    const presence = new Feed<{ presence: OwnPresenceState; statusMessage?: string } | null>({ presence: "online" });
    const presenceWrites: Array<string | undefined> = [];
    const ownWrites: Array<unknown> = [];
    let ownStamp = 0;
    let supported = true;
    const publishOwn = (document: unknown | null, deviceId: string): void => {
        ownStamp += 1;
        ownActivity.set({ document: document ?? null, updatedAt: ownStamp, deviceId });
    };
    if (initialOwn !== null) publishOwn(initialOwn, "OTHERDEVICE");
    const client = {
        connection,
        session: { get: () => ({ userId: "@alice-a:example.com", deviceId: "LOCALDEVICE" }) },
        ownActivity,
        profileFieldsSupported: () => Promise.resolve(supported),
        profileField: () => field,
        setProfileField: (key: string, value: unknown) => {
            assert.equal(key, ACTIVITY_FIELD_KEY);
            field.set(value ?? null);
            return Promise.resolve();
        },
        setOwnActivity: (document: unknown | null) => {
            ownWrites.push(document ?? null);
            publishOwn(document, "LOCALDEVICE");
            return Promise.resolve();
        },
        ownPresence: presence,
        setOwnPresence: (state: OwnPresenceState, statusMessage?: string) => {
            presence.set({ presence: state, ...(statusMessage ? { statusMessage } : {}) });
            presenceWrites.push(statusMessage);
            return Promise.resolve();
        },
    } as unknown as ChatClient;
    return {
        client,
        field,
        ownActivity,
        connection,
        presence,
        native: nativeFeed(initialNative),
        presenceWrites,
        ownWrites,
        setSupported: (value) => {
            supported = value;
        },
        remoteActivity: (document) => publishOwn(document, "OTHERDEVICE"),
    };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("first-party activity document", () => {
    it("validates the v1 shape instead of rendering arbitrary profile JSON", () => {
        assert.equal(parseActivity({ v: 1, type: "playing", name: "Chess" })?.name, "Chess");
        assert.equal(parseActivity({ v: 2, type: "playing", name: "Chess" }), null);
        assert.equal(parseActivity({ v: 1, type: "dancing", name: "Chess" }), null);
        assert.equal(parseActivity({ v: 1, type: "playing", name: "" }), null);
        assert.deepEqual(parseActivity({ v: 1, type: "playing", name: "Chess", details: "" }), { v: 1, type: "playing", name: "Chess" }, "empty optionals normalize to absent");
        assert.equal(parseActivity({ v: 1, type: "playing", name: "Chess", details: "x".repeat(129) }), null);
    });

    it("builds a document with bounded optional fields", () => {
        assert.deepEqual(
            createActivity({ type: "listening", name: " Song ", details: " Artist ", state: "", emoji: "🎵" }, 1000),
            { v: 1, type: "listening", name: "Song", details: "Artist", emoji: "🎵", startedAt: 1000 },
        );
        assert.equal(activityHeadline({ v: 1, type: "custom", name: "Focusing" }), "Focusing");
        assert.equal(activityStatusText({ v: 1, type: "playing", name: "Chess", emoji: "♟" }), "♟ Playing Chess");
    });

    it("keeps up to two bounded images and a live progress window", () => {
        const parsed = parseActivity({
            v: 1,
            type: "listening",
            name: "Song",
            startedAt: 0,
            endsAt: 298_000,
            media: [
                { url: "https://cdn.example/art.png", label: "Art" },
                { url: "mxc://example.com/badge" },
            ],
        });
        assert.deepEqual(parsed?.media, [
            { url: "https://cdn.example/art.png", label: "Art" },
            { url: "mxc://example.com/badge" },
        ]);
        assert.deepEqual(activityProgress(parsed!, 149_000), {
            percent: 50,
            elapsed: "2:29",
            duration: "4:58",
            ended: false,
        });
        assert.equal(activityProgress(parsed!, 400_000)?.percent, 100);
        assert.equal(activityProgress({ v: 1, type: "playing", name: "Chess", startedAt: 0 }, 2000), null);
    });

    it("refuses arbitrary URLs, too many images and a broken progress window", () => {
        assert.equal(parseActivity({ v: 1, type: "playing", name: "Chess", media: [{ url: "javascript:alert(1)" }] }), null);
        assert.equal(
            parseActivity({
                v: 1,
                type: "playing",
                name: "Chess",
                media: [{ url: "https://a/1" }, { url: "https://a/2" }, { url: "https://a/3" }],
            }),
            null,
        );
        assert.equal(parseActivity({ v: 1, type: "playing", name: "Chess", startedAt: 2000, endsAt: 1000 }), null);
        assert.deepEqual(parseActivity({ v: 1, type: "playing", name: "Chess", media: [] }), { v: 1, type: "playing", name: "Chess" });
    });

    it("keeps up to two outbound buttons with http(s) URLs", () => {
        const buttons = [
            { label: "Watch game", url: "https://example.com/watch" },
            { label: "Open board", url: "http://example.com/board" },
        ];
        const parsed = parseActivity({ v: 1, type: "playing", name: "Chess", buttons });
        assert.deepEqual(parsed?.buttons, buttons);
        assert.deepEqual(
            createActivity({ type: "playing", name: "Chess", buttons: [{ label: " Go ", url: " https://example.com/go " }] }, 1).buttons,
            [{ label: "Go", url: "https://example.com/go" }],
        );
        assert.equal(
            sameActivity(parsed, parseActivity({ v: 1, type: "playing", name: "Chess", buttons: [...buttons] })),
            true,
        );
        assert.equal(
            sameActivity(parsed, parseActivity({ v: 1, type: "playing", name: "Chess", buttons: [buttons[0]!] })),
            false,
        );
    });

    it("refuses unsafe or malformed buttons rather than rendering them as links", () => {
        for (const buttons of [
            [{ label: "Click", url: "javascript:alert(1)" }],
            [{ label: "Click", url: "data:text/html,hi" }],
            [{ label: "Click", url: "mxc://example.com/thing" }],
            [{ label: "", url: "https://example.com" }],
            [{ label: "Click", url: "" }],
            [{ label: "x".repeat(33), url: "https://example.com" }],
            [{ label: "Click", url: `https://example.com/${"x".repeat(513)}` }],
            [
                { label: "One", url: "https://example.com/1" },
                { label: "Two", url: "https://example.com/2" },
                { label: "Three", url: "https://example.com/3" },
            ],
            [{ label: "Click" }],
        ]) {
            assert.equal(parseActivity({ v: 1, type: "playing", name: "Chess", buttons }), null, JSON.stringify(buttons));
        }
        assert.deepEqual(parseActivity({ v: 1, type: "playing", name: "Chess", buttons: [] }), { v: 1, type: "playing", name: "Chess" });
        assert.throws(
            () => createActivity({ type: "playing", name: "Chess", buttons: [{ label: "Bad", url: "file:///etc/passwd" }] }),
            /activity buttons/,
        );
    });
});

describe("ActivityController precedence", () => {
    it("publishes native activity over the manual one and restores the draft on clear", async () => {
        const h = harness();
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-a:example.com");

        await controller.setManual({ type: "listening", name: "Manual album" });
        assert.equal(parseActivity(h.field.get())?.name, "Manual album");

        h.native.set({ type: "playing", name: "Native game" });
        await tick();
        assert.equal(parseActivity(h.field.get())?.name, "Native game");
        assert.equal(controller.source.value, "native");

        await controller.setManual({ type: "watching", name: "Manual film" });
        assert.equal(parseActivity(h.field.get())?.name, "Native game", "a manual edit must not displace a live producer");

        h.native.set(null);
        await tick();
        assert.equal(parseActivity(h.field.get())?.name, "Manual film", "the saved manual activity returns on clear");
        assert.equal(controller.source.value, "manual");
        controller.stop();
    });

    it("passes native artwork and progress through to the shared document", async () => {
        const h = harness();
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-native-media:example.com");
        const native = {
            type: "listening" as const,
            name: "Song",
            startedAt: 1000,
            endsAt: 200_000,
            media: [{ url: "https://cdn.example/art.png", label: "Album art" }],
            buttons: [{ label: "Listen", url: "https://music.example/song" }],
        };
        h.native.set(native);
        await tick();

        const published = parseActivity(h.field.get());
        assert.deepEqual(published?.media, native.media);
        assert.deepEqual(published?.buttons, native.buttons);
        assert.equal(published?.endsAt, native.endsAt);
        assert.ok(activityProgress(published!), "progress reaches the renderer as bounded document data");
        controller.stop();
    });

    it("reasserts native activity when an older plugin writes the field back", async () => {
        const h = harness(null, { type: "playing", name: "Native game" });
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-b:example.com");
        await tick();

        assert.equal(parseActivity(h.field.get())?.name, "Native game");
        // A released plugin that starts late writes its own native document;
        // the field is the shared surface, so the controller owns the outcome.
        h.field.set(null);
        await tick();
        assert.equal(parseActivity(h.field.get())?.name, "Native game");
        controller.stop();
    });

    it("does not mistake an already-mirrored native field for a manual draft", async () => {
        const native = { type: "listening", name: "Native album" } as const;
        const h = harness({ v: 1, ...native }, native);
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-c:example.com");
        await tick();

        h.native.set(null);
        await tick();
        assert.equal(h.field.get(), null, "a native activity is not restored as the user's manual one");
        controller.stop();
    });

    it("mirrors status text but never overwrites a status the user chose", async () => {
        const h = harness();
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-d:example.com");

        await controller.setManual({ type: "playing", name: "Chess" });
        assert.equal(h.presenceWrites.at(-1), "Playing Chess");

        h.presence.set({ presence: "online", statusMessage: "Busy" });
        const writes = h.presenceWrites.length;
        await controller.setManual({ type: "playing", name: "Go" });
        assert.equal(h.presence.get()?.statusMessage, "Busy", "a hand-typed status wins");
        assert.equal(h.presenceWrites.length, writes, "no status write follows a user-owned status");
        controller.stop();
    });

    it("clears a mirrored status when mirroring is turned off", async () => {
        const h = harness();
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-e:example.com");

        await controller.setManual({ type: "playing", name: "Chess" });
        assert.equal(h.presence.get()?.statusMessage, "Playing Chess");

        controller.setMirror(false);
        await tick();
        assert.equal(h.presenceWrites.at(-1), undefined);
        controller.stop();
    });

    it("adopts a warm profile field without treating its first null as a clear", async () => {
        const stored = { v: 1, type: "watching", name: "Saved film" } as const;
        const h = harness(stored);
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-f:example.com");
        await tick();

        assert.equal(controller.draft.value?.name, "Saved film", "the field's current value is the manual draft");
        assert.equal(controller.source.value, "manual");

        h.field.set(null);
        await tick();
        assert.equal(controller.draft.value, null, "an explicit clear from another surface clears the draft");
        controller.stop();
    });

    it("retries profile-field support after the session's early false", async () => {
        const h = harness();
        h.setSupported(false);
        h.connection.set("starting");
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-g:example.com");

        assert.equal(controller.supported.value, null, "before startClient(), support is unknown");
        await controller.setManual({ type: "playing", name: "Queued game" });
        assert.equal(h.field.get(), null, "the field cannot be written yet");

        h.setSupported(true);
        h.connection.set("syncing");
        await tick();
        await tick();
        assert.equal(controller.supported.value, true);
        assert.equal(parseActivity(h.field.get())?.name, "Queued game", "the queued document is written once support arrives");
        assert.equal(h.ownWrites.length, 1, "the account-data copy is retried exactly once");
        assert.equal(parseActivity(h.ownWrites[0])?.name, "Queued game");
        controller.stop();
    });

    it("publishes a startup native activity once support arrives", async () => {
        const h = harness(null, { type: "listening", name: "Startup song" });
        h.setSupported(false);
        h.connection.set("starting");
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-h:example.com");
        await tick();
        assert.equal(h.field.get(), null);

        h.setSupported(true);
        h.connection.set("syncing");
        await tick();
        await tick();
        assert.equal(parseActivity(h.field.get())?.name, "Startup song");
        assert.equal(controller.source.value, "native");
        controller.stop();
    });

    it("adopts another device's activity without echoing it back", async () => {
        const h = harness();
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-a:example.com");
        await tick();

        h.remoteActivity({ v: 1, type: "listening", name: "Remote album" });
        await tick();
        await tick();

        assert.equal(controller.draft.value?.name, "Remote album");
        assert.equal(controller.current.value?.name, "Remote album");
        assert.deepEqual(h.ownWrites, [], "an incoming sync echo is not written back to the account");
        controller.stop();
    });

    it("restores the last server-side document when native clears", async () => {
        const h = harness(null, null, { v: 1, type: "watching", name: "Remote film" });
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-a:example.com");
        await tick();
        assert.equal(controller.draft.value?.name, "Remote film");

        h.native.set({ type: "playing", name: "Native game" });
        await tick();
        await tick();
        assert.equal(parseActivity(h.field.get())?.name, "Native game", "native still wins while it is live");

        h.native.set(null);
        await tick();
        await tick();
        assert.equal(parseActivity(h.field.get())?.name, "Remote film", "the other device's document comes back");
        controller.stop();
    });

    it("remembers an explicit clear from another device as the restore point", async () => {
        const h = harness();
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-a:example.com");
        await controller.setManual({ type: "playing", name: "Local game" });
        await tick();

        h.remoteActivity(null);
        await tick();
        assert.equal(controller.draft.value, null, "an explicit clear is not treated as 'no answer yet'");

        h.native.set({ type: "playing", name: "Native game" });
        await tick();
        h.native.set(null);
        await tick();
        await tick();
        assert.equal(h.field.get(), null, "the native clear does not resurrect the stale local draft");
        controller.stop();
    });

    it("retries an account-data write queued before startClient()", async () => {
        const h = harness();
        h.connection.set("starting");
        const controller = new ActivityController(h.client, h.native);
        await controller.start("@alice-a:example.com");
        await controller.setManual({ type: "listening", name: "Queued song" });
        assert.deepEqual(h.ownWrites, [], "account data cannot be written before the client starts");

        h.connection.set("syncing");
        await tick();
        await tick();
        assert.equal(parseActivity(h.ownWrites.at(-1))?.name, "Queued song");
        controller.stop();
    });
});
