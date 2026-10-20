/**
 * Guards the sandbox protocol against silent drift.
 *
 * The bridge reflects `ChatClient` by NAME, so two things can rot without a
 * type error: the protocol's three name lists can fall behind the contract, and
 * the runtime's hand-built facade can fall behind those lists. The first is
 * compile-guarded in `protocol.ts` (`satisfies` against the real `ChatClient`);
 * this file checks the second, plus the structural rules the bridge relies on.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    CLIENT_FEED_METHODS,
    CLIENT_FEEDS,
    CLIENT_METHODS,
    CONTEXT_METHODS,
} from "../src/plugins/sandbox/protocol.ts";
import { createSandboxRuntime, type SandboxScope } from "../src/plugins/sandbox/worker/runtime.ts";
import type { Plugin, PluginContext, PluginManifest } from "../src/plugins/types.ts";

const MANIFEST: PluginManifest = {
    id: "acme.protocol",
    name: "Protocol Test",
    version: "1.0.0",
    minUI: "1.0.0",
    minCore: "1.0.0",
    permissions: [],
};

/** A scope that discards host-bound messages and serves `plugin` on import. */
function scopeFor(plugin: Plugin): SandboxScope {
    return {
        postMessage: () => undefined,
        addEventListener: () => undefined,
        close: () => undefined,
        createObjectUrl: () => "blob:test/1",
        revokeObjectUrl: () => undefined,
        importModule: () => Promise.resolve({ default: plugin }),
    };
}

/** Run one `init` and hand back the context the runtime built for the plugin. */
async function captureContext(): Promise<PluginContext> {
    let captured: PluginContext | null = null;
    const plugin: Plugin = {
        manifest: MANIFEST,
        install(ctx) {
            captured = ctx;
            return () => undefined;
        },
    };
    const runtime = createSandboxRuntime(scopeFor(plugin));
    runtime.handleMessage({
        kind: "init",
        protocol: 1,
        bundle: "// bundle",
        manifest: MANIFEST,
        capabilities: { supportsThreads: false, hasMoreRooms: false },
    });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    assert.ok(captured, "the plugin's install ran");
    return captured;
}

describe("sandbox protocol", () => {
    it("names every client method and feed exactly once", () => {
        const all = [...CLIENT_METHODS, ...CLIENT_FEED_METHODS, ...CLIENT_FEEDS];
        assert.equal(new Set(all).size, all.length, "no name may appear twice");
    });

    it("keeps the feed names disjoint from the method names", () => {
        const methods = new Set<string>([...CLIENT_METHODS, ...CLIENT_FEED_METHODS]);
        for (const feed of CLIENT_FEEDS) {
            assert.ok(!methods.has(feed), `"${feed}" is both a method and a feed`);
        }
    });

    it("namespaces the context RPCs so they cannot be confused with client ones", () => {
        for (const name of CONTEXT_METHODS) {
            assert.match(name, /^(selection|actions):/, `${name} must be namespaced`);
            assert.ok(
                !(CLIENT_METHODS as readonly string[]).includes(name),
                `${name} must not collide with a client method`,
            );
        }
    });

    it("builds a client facade carrying every name the protocol reflects", async () => {
        const ctx = await captureContext();
        const facade = ctx.client as unknown as Record<string, unknown>;

        for (const method of CLIENT_METHODS) {
            assert.equal(typeof facade[method], "function", `client.${method} must exist`);
        }
        for (const feed of CLIENT_FEEDS) {
            const value = facade[feed] as { get?: unknown; subscribe?: unknown } | undefined;
            assert.equal(typeof value?.get, "function", `client.${feed}.get must exist`);
            assert.equal(typeof value?.subscribe, "function", `client.${feed}.subscribe must exist`);
        }
        for (const method of CLIENT_FEED_METHODS) {
            assert.equal(typeof facade[method], "function", `client.${method}() must exist`);
        }
    });

    it("refuses the component extension points the sandbox lane cannot carry", async () => {
        const ctx = await captureContext();
        for (const [name, call] of Object.entries({
            addRenderer: () => ctx.addRenderer({} as never),
            addMemberDecoration: () => ctx.addMemberDecoration({} as never),
            addSettingsTab: () => ctx.addSettingsTab({} as never),
        })) {
            assert.throws(call, /trusted lane/, `${name} must refuse rather than no-op`);
        }
    });

    it("survives stray or pre-init messages without throwing", () => {
        const runtime = createSandboxRuntime(scopeFor({ manifest: MANIFEST, install: () => () => undefined }));
        assert.equal(typeof runtime.handleMessage, "function");
        runtime.handleMessage(null);
        runtime.handleMessage({ kind: "not-a-real-kind" });
        runtime.handleMessage({ kind: "result", id: 999, ok: true });
    });
});
