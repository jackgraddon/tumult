import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Component } from "vue";
import type { ChatClient, MessageView } from "@tumult/core";

import { TimelineRegistry } from "../src/timeline/registry.ts";
import { PluginRegistry } from "../src/plugins/registry.ts";
import type { ActionsContext } from "../src/actions.ts";
import type { SelectionContext } from "../src/selection.ts";
import type { Plugin, PluginManifest } from "../src/plugins/types.ts";

const Fallback = { name: "Fallback" } as unknown as Component;
const PluginComp = { name: "PluginComp" } as unknown as Component;
const BuiltinComp = { name: "BuiltinComp" } as unknown as Component;

function message(type: string): MessageView {
    return { type } as unknown as MessageView;
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return { id: "test.plugin", name: "Test", version: "1.0.0", permissions: [], ...overrides };
}

/** Fresh shell-shaped deps. Each call is an independent "shell". */
function makeDeps(timeline: TimelineRegistry = new TimelineRegistry()) {
    return {
        timeline,
        client: {} as ChatClient,
        selection: {} as SelectionContext,
        actions: {} as ActionsContext,
        media: {
            resolve: async () => "",
            resolveDownload: async () => "",
            resolveEncrypted: async () => "",
        },
    };
}

describe("TimelineRegistry.unregister", () => {
    it("removes exactly the given entry and bumps version", () => {
        const registry = new TimelineRegistry();
        const entry = { component: PluginComp, priority: 10 };
        registry.register("m.room.message", entry);
        const afterRegister = registry.version.value;

        assert.equal(registry.resolve(message("m.room.message"), Fallback), PluginComp);

        registry.unregister("m.room.message", entry);
        assert.equal(registry.resolve(message("m.room.message"), Fallback), Fallback);
        assert.ok(registry.version.value > afterRegister, "version must bump on unregister");
    });

    it("is a no-op for an unknown entry or unknown type", () => {
        const registry = new TimelineRegistry();
        const keep = { component: BuiltinComp, priority: 0 };
        registry.register("m.room.message", keep);
        const before = registry.version.value;

        registry.unregister("m.room.message", { component: PluginComp, priority: 10 });
        registry.unregister("m.nope", keep);
        assert.equal(registry.version.value, before, "no-op unregisters must not bump version");
        assert.equal(registry.resolve(message("m.room.message"), Fallback), BuiltinComp);
    });

    it("keeps higher-priority entries first", () => {
        const registry = new TimelineRegistry();
        registry.register("m.room.message", { component: BuiltinComp, priority: 0 });
        registry.register("m.room.message", { component: PluginComp, priority: 10 });
        assert.equal(registry.resolve(message("m.room.message"), Fallback), PluginComp);
    });
});

describe("PluginRegistry lifecycle", () => {
    it("install registers a renderer through the context; uninstall removes it", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
            },
        };

        plugins.install(renderer);
        assert.equal(plugins.has("test.plugin"), true);
        assert.equal(plugins.list().length, 1);
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), PluginComp);

        assert.equal(plugins.uninstall("test.plugin"), true);
        assert.equal(plugins.has("test.plugin"), false);
        assert.equal(plugins.list().length, 0);
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), Fallback);
    });

    it("bumps version on install and uninstall", () => {
        const plugins = new PluginRegistry(makeDeps());
        const before = plugins.version.value;
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
            },
        };
        plugins.install(renderer);
        assert.ok(plugins.version.value > before, "install bumps version");
        const installed = plugins.version.value;
        plugins.uninstall("test.plugin");
        assert.ok(plugins.version.value > installed, "uninstall bumps version");
    });

    it("refuses a duplicate install", () => {
        const plugins = new PluginRegistry(makeDeps());
        const renderer: Plugin = { manifest: manifest(), install() {} };
        plugins.install(renderer);
        assert.throws(() => plugins.install(renderer), /already installed/);
    });

    it("uninstall of an unknown id resolves false", () => {
        const plugins = new PluginRegistry(makeDeps());
        assert.equal(plugins.uninstall("nope"), false);
    });

    it("installing after a successful uninstall is allowed", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
            },
        };
        plugins.install(renderer);
        plugins.uninstall("test.plugin");
        plugins.install(renderer);
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), PluginComp);
    });

    it("runs the install teardown and plugin.uninstall on uninstall, disposables first", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const order: string[] = [];
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
                return () => order.push("teardown");
            },
            uninstall() {
                order.push("uninstall");
            },
        };
        plugins.install(renderer);
        // Swallow the renderer's removal order by watching resolution instead
        // of intercepting internals: disposables must have run by the time
        // uninstall() returns.
        plugins.uninstall("test.plugin");
        assert.deepEqual(order, ["teardown", "uninstall"]);
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), Fallback);
    });

    it("a thrown plugin.uninstall() does not break uninstall", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
            },
            uninstall() {
                throw new Error("boom");
            },
        };
        plugins.install(renderer);
        assert.equal(plugins.uninstall("test.plugin"), true);
        assert.equal(plugins.has("test.plugin"), false);
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), Fallback);
    });

    it("uninstallAll clears every installed plugin", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const make = (id: string): Plugin => ({
            manifest: manifest({ id, permissions: ["timeline-renderers"] }),
            install(ctx) {
                ctx.addRenderer(id, { component: PluginComp, priority: 10 });
            },
        });
        plugins.install(make("a"));
        plugins.install(make("b"));
        plugins.uninstallAll();
        assert.equal(plugins.list().length, 0);
        assert.equal(deps.timeline.resolve(message("a"), Fallback), Fallback);
        assert.equal(deps.timeline.resolve(message("b"), Fallback), Fallback);
    });
});

describe("PluginRegistry permissions", () => {
    it("refuses an undeclared permission and leaves no residue", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const renderer: Plugin = {
            manifest: manifest({ permissions: [] }), // no timeline-renderers
            install(ctx) {
                ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
            },
        };

        assert.throws(() => plugins.install(renderer), /timeline-renderers/);
        assert.equal(plugins.has("test.plugin"), false, "failed install must not be recorded");
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), Fallback);
        assert.equal(plugins.version.value, 0, "failed install must not bump version");
    });

    it("rolls back registrations made before install threw", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
                throw new Error("halfway failure");
            },
        };

        assert.throws(() => plugins.install(renderer), /halfway failure/);
        assert.equal(plugins.has("test.plugin"), false);
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), Fallback);
    });

    it("context exposes the shell's own objects (client, selection, actions, media)", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        let seen: Record<string, unknown> | null = null;
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                seen = {
                    client: ctx.client,
                    selection: ctx.selection,
                    actions: ctx.actions,
                    media: ctx.media,
                    id: ctx.manifest.id,
                };
            },
        };
        plugins.install(renderer);
        assert.ok(seen);
        assert.equal(seen["client"], deps.client);
        assert.equal(seen["selection"], deps.selection);
        assert.equal(seen["actions"], deps.actions);
        assert.equal(seen["media"], deps.media);
        assert.equal(seen["id"], "test.plugin");
    });
});

describe("PluginRegistry isolation", () => {
    it("two registries (shells) do not share install state", () => {
        const depsA = makeDeps();
        const depsB = makeDeps();
        const a = new PluginRegistry(depsA);
        const b = new PluginRegistry(depsB);
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
            },
        };

        a.install(renderer);
        b.install(renderer); // same id, different shell: allowed
        a.uninstall("test.plugin");

        assert.equal(a.has("test.plugin"), false);
        assert.equal(b.has("test.plugin"), true);
        assert.equal(depsA.timeline.resolve(message("m.room.message"), Fallback), Fallback);
        assert.equal(depsB.timeline.resolve(message("m.room.message"), Fallback), PluginComp);
    });

    it("shell-level addRenderer is unpermissioned and returns a working disposer", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const dispose = plugins.addRenderer("m.room.message", { component: BuiltinComp, priority: 0 });
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), BuiltinComp);
        dispose();
        dispose(); // idempotent
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), Fallback);
    });

    it("a plugin's own disposer can run before uninstall without double-unregistering", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        let kept: (() => void) | undefined;
        const renderer: Plugin = {
            manifest: manifest({ permissions: ["timeline-renderers"] }),
            install(ctx) {
                kept = ctx.addRenderer("m.room.message", { component: PluginComp, priority: 10 });
            },
        };
        plugins.install(renderer);
        kept?.();
        assert.equal(deps.timeline.resolve(message("m.room.message"), Fallback), Fallback);
        // Uninstall runs the tracked wrapper again — must stay harmless.
        assert.equal(plugins.uninstall("test.plugin"), true);
        assert.equal(plugins.has("test.plugin"), false);
    });
});
