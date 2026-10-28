import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createFakeChatClient } from "../src/fake/index.ts";
import { assertProfileFieldKey, ProfileFieldStore } from "../src/rooms/profile-fields.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function store(answers: unknown[], clock = { now: 0 }) {
    const reads: string[] = [];
    const fields = new ProfileFieldStore(
        async (userId, key) => {
            reads.push(`${userId}/${key}`);
            const next = answers.shift();
            if (next instanceof Error) throw next;
            return next;
        },
        { ttlMs: 1000, now: () => clock.now },
    );
    return { fields, reads, clock };
}

describe("assertProfileFieldKey", () => {
    it("accepts namespaced keys", () => {
        assertProfileFieldKey("app.tumult.activity");
    });
    it("refuses the spec's own keys and bare names", () => {
        assert.throws(() => assertProfileFieldKey("displayname"), /reserved/);
        assert.throws(() => assertProfileFieldKey("avatar_url"), /reserved/);
        assert.throws(() => assertProfileFieldKey("activity"), /namespaced/);
        assert.throws(() => assertProfileFieldKey("a..b"), /namespaced/);
    });
});

describe("ProfileFieldStore", () => {
    it("returns the same feed per (user, key) and reads only once watched", async () => {
        const { fields, reads } = store([{ name: "Chess" }]);
        const feed = fields.feed("@a:x", "app.k");
        assert.equal(fields.feed("@a:x", "app.k"), feed);
        assert.equal(reads.length, 0);
        const sub = feed.subscribe(() => {});
        await tick();
        assert.deepEqual(feed.get(), { name: "Chess" });
        assert.deepEqual(reads, ["@a:x/app.k"]);
        sub.unsubscribe();
    });

    it("serves a fresh answer from cache and refetches after the ttl", async () => {
        const { fields, reads, clock } = store([1, 2], { now: 5 });
        const feed = fields.feed("@a:x", "app.k");
        feed.subscribe(() => {}).unsubscribe();
        await tick();
        feed.subscribe(() => {}).unsubscribe();
        await tick();
        assert.equal(reads.length, 1);
        clock.now = 1006;
        feed.subscribe(() => {}).unsubscribe();
        await tick();
        assert.equal(reads.length, 2);
        assert.equal(feed.get(), 2);
    });

    it("stays stale when it could not ask, so the next watch retries", async () => {
        const { fields, reads } = store([undefined, new Error("boom"), "ok"]);
        const feed = fields.feed("@a:x", "app.k");
        const originalError = console.error;
        console.error = () => {};
        try {
            for (let i = 0; i < 3; i++) {
                feed.subscribe(() => {}).unsubscribe();
                await tick();
            }
        } finally {
            console.error = originalError;
        }
        assert.equal(reads.length, 3);
        assert.equal(feed.get(), "ok");
    });

    it("drops a read that lands after clear()", async () => {
        let release: (value: unknown) => void = () => {};
        const fields = new ProfileFieldStore(() => new Promise((resolve) => (release = resolve)), { ttlMs: 1000 });
        const feed = fields.feed("@a:x", "app.k");
        feed.subscribe(() => {});
        fields.clear();
        release("late");
        await tick();
        assert.equal(feed.get(), null);
    });

    it("publish() makes our own write visible and fresh", async () => {
        const { fields, reads } = store([], { now: 5 });
        fields.publish("@me:x", "app.k", { v: 1 });
        const feed = fields.feed("@me:x", "app.k");
        feed.subscribe(() => {});
        await tick();
        assert.deepEqual(feed.get(), { v: 1 });
        assert.equal(reads.length, 0);
    });
});

describe("fake client profile fields", () => {
    it("round-trips our own field and refuses reserved keys", async () => {
        const client = createFakeChatClient();
        assert.equal(await client.profileFieldsSupported(), true);
        await client.setProfileField("app.tumult.activity", { v: 1 });
        assert.deepEqual(client.profileField("@demo:example.com", "app.tumult.activity").get(), { v: 1 });
        await client.setProfileField("app.tumult.activity", null);
        assert.equal(client.profileField("@demo:example.com", "app.tumult.activity").get(), null);
        await assert.rejects(client.setProfileField("displayname", "x"), /reserved/);
    });
});
