import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineComponent } from "vue";
import type { ChatClient } from "@tumult/core";

import { ActivityRenderersRegistry, type ActivityRenderer } from "../src/members/activity.ts";

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
