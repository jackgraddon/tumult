import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineComponent } from "vue";

import type { MemberView } from "@tumult/core";

import { ProfileSectionsRegistry, type ProfileSection } from "../src/members/profileSections.ts";

const Comp = defineComponent({ render: () => null });

function section(overrides: Partial<ProfileSection> & { id: string }): ProfileSection {
    return { component: Comp, ...overrides };
}

function member(overrides: Partial<MemberView> = {}): MemberView {
    return {
        userId: "@bob:example.com",
        displayName: "Bob",
        avatarUrl: null,
        membership: "join",
        powerLevel: 0,
        isSelf: false,
        presence: "online",
        verification: "unknown",
        lastActiveTs: null,
        statusMessage: null,
        ...overrides,
    };
}

describe("ProfileSectionsRegistry.resolve", () => {
    it("resolves nothing when no section is registered", () => {
        const registry = new ProfileSectionsRegistry();
        assert.deepEqual(registry.resolve(member()), []);
    });

    it("a section with no match applies to every member", () => {
        const registry = new ProfileSectionsRegistry();
        registry.add(section({ id: "anyone" }));
        assert.deepEqual(
            registry.resolve(member({ userId: "@alice:example.com" })).map((r) => r.id),
            ["anyone"],
        );
    });

    it("sorts by priority, highest first", () => {
        const registry = new ProfileSectionsRegistry();
        registry.add(section({ id: "low", priority: 1 }));
        registry.add(section({ id: "mid", priority: 2 }));
        registry.add(section({ id: "high", priority: 3 }));
        assert.deepEqual(
            registry.resolve(member()).map((entry) => entry.id),
            ["high", "mid", "low"],
        );
    });

    it("excludes a section whose match returns false", () => {
        const registry = new ProfileSectionsRegistry();
        registry.add(section({ id: "joined", match: (member) => member.membership === "join" }));
        assert.deepEqual(
            registry.resolve(member({ membership: "join" })).map((entry) => entry.id),
            ["joined"],
        );
        assert.deepEqual(
            registry.resolve(member({ membership: "invite" })).map((entry) => entry.id),
            [],
        );
    });

    it("treats a throwing match as a refusal, not a crash", () => {
        const registry = new ProfileSectionsRegistry();
        registry.add(
            section({ id: "bad", priority: 9, match: () => {
                throw new Error("boom");
            } }),
        );
        registry.add(section({ id: "good" }));
        const originalError = console.error;
        console.error = () => {};
        try {
            assert.deepEqual(
                registry.resolve(member()).map((entry) => entry.id),
                ["good"],
            );
        } finally {
            console.error = originalError;
        }
    });

    it("refuses a second add under a live key", () => {
        const registry = new ProfileSectionsRegistry();
        registry.add(section({ id: "x" }));
        assert.throws(() => registry.add(section({ id: "x" })), /already registered/);
    });

    it("a disposed section's key is free for a re-registration, its disposer idempotent", () => {
        const registry = new ProfileSectionsRegistry();
        const dispose = registry.add(section({ id: "x" }));
        dispose();
        assert.deepEqual(registry.resolve(member()), []);

        const second = registry.add(section({ id: "x" }));
        assert.deepEqual(registry.resolve(member()).map((entry) => entry.id), ["x"]);

        dispose(); // the stale disposer must not take the replacement down
        assert.equal(registry.resolve(member()).length, 1);
        second();
        assert.deepEqual(registry.resolve(member()), []);
    });
});
