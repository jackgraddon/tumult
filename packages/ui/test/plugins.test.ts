import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Component } from "vue";
import type { ChatClient, MessageView } from "@tumult/core";

import { TimelineRegistry } from "../src/timeline/registry.ts";
import { ComposerActionsRegistry } from "../src/timeline/composer-actions.ts";
import { CommandsRegistry } from "../src/timeline/commands.ts";
import { MemberDecorationsRegistry } from "../src/members/decorations.ts";
import { SettingsTabsRegistry } from "../src/settings/tabs.ts";
import { WorkspacePanesRegistry } from "../src/panes/registry.ts";
import { PluginRegistry } from "../src/plugins/registry.ts";
import { PLUGIN_API_VERSION, compareVersions } from "../src/plugins/compat.ts";
import { CONTRACT_VERSION } from "@tumult/core/contract";
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
    const stylesheets: Array<{ css: string; owner: string }> = [];
    const removedStylesheets: string[] = [];
    return {
        timeline,
        composerActions: new ComposerActionsRegistry(),
        commands: new CommandsRegistry(),
        memberDecorations: new MemberDecorationsRegistry(),
        settingsTabs: new SettingsTabsRegistry(),
        panes: new WorkspacePanesRegistry(),
        client: {} as ChatClient,
        selection: {} as SelectionContext,
        actions: {} as ActionsContext,
        media: {
            resolve: async () => "",
            resolveDownload: async () => "",
            resolveEncrypted: async () => "",
        },
        /** Shell-side stand-ins for the real DOM injector (see styles.ts). */
        stylesheets,
        removedStylesheets,
        injectStylesheet(css: string, owner: string) {
            stylesheets.push({ css, owner });
            return () => removedStylesheets.push(owner);
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

describe("PluginRegistry compatibility (minUI / minCore)", () => {
    it("refuses an install whose minUI is newer than this build, with no residue", () => {
        const plugins = new PluginRegistry(makeDeps());
        const renderer: Plugin = {
            manifest: manifest({ minUI: "999.0.0" }),
            install() {
                assert.fail("an incompatible plugin must never reach install()");
            },
        };
        assert.throws(() => plugins.install(renderer), /requires plugin API 999\.0\.0\+.*\(minUI\)/);
        assert.equal(plugins.has("test.plugin"), false, "refused install must not be recorded");
        assert.equal(plugins.version.value, 0, "refused install must not bump version");
    });

    it("refuses an install whose minCore is newer than the core contract", () => {
        const plugins = new PluginRegistry(makeDeps());
        const renderer: Plugin = {
            manifest: manifest({ minCore: "999.0.0" }),
            install() {
                assert.fail("an incompatible plugin must never reach install()");
            },
        };
        assert.throws(
            () => plugins.install(renderer),
            /requires @tumult\/core contract 999\.0\.0\+.*\(minCore\)/,
        );
        assert.equal(plugins.has("test.plugin"), false);
        assert.equal(plugins.version.value, 0);
    });

    it("installs when requirements are satisfied (equal versions count)", () => {
        const plugins = new PluginRegistry(makeDeps());
        plugins.install({
            manifest: manifest({ minUI: PLUGIN_API_VERSION, minCore: CONTRACT_VERSION }),
            install() {},
        });
        assert.equal(plugins.has("test.plugin"), true);
    });

    it("compareVersions compares dotted numerics, not strings", () => {
        assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
        assert.ok(compareVersions("1.10.0", "1.9.0") > 0, "10 must beat 9");
        assert.ok(compareVersions("1.0", "1.0.1") < 0, "a missing segment counts as 0");
        assert.ok(compareVersions("2-beta", "1.99.99") > 0, "leading digits only");
    });
});

describe("PluginRegistry extension points", () => {
    it("installs contributions and disposes them on uninstall", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const renderer: Plugin = {
            manifest: manifest({
                permissions: [
                    "composer-actions",
                    "commands",
                    "member-decorations",
                    "settings-tabs",
                    "styles",
                    "workspace-panes",
                ],
            }),
            install(ctx) {
                ctx.addComposerAction({ id: "a1", label: "One", run() {} });
                ctx.addCommand({ name: "shrug", run() {} });
                ctx.addMemberDecoration({ id: "d1", component: PluginComp });
                ctx.addSettingsTab({ id: "s1", title: "One", component: PluginComp });
                ctx.injectStylesheet(".tumult-demo { color: red; }");
                ctx.addPane({ id: "p1", label: "One", content: PluginComp });
            },
        };

        plugins.install(renderer);
        assert.equal(deps.composerActions.all().length, 1);
        assert.equal(deps.commands.all().length, 1);
        assert.equal(deps.memberDecorations.resolve({} as never).length, 1);
        assert.equal(deps.settingsTabs.all().length, 1);
        assert.equal(deps.panes.all().length, 1);
        assert.deepEqual(deps.stylesheets, [
            { css: ".tumult-demo { color: red; }", owner: "test.plugin" },
        ]);

        plugins.uninstall("test.plugin");
        assert.equal(deps.composerActions.all().length, 0);
        assert.equal(deps.commands.all().length, 0);
        assert.equal(deps.memberDecorations.resolve({} as never).length, 0);
        assert.equal(deps.settingsTabs.all().length, 0);
        assert.equal(deps.panes.all().length, 0);
        // The stylesheet's disposer is tracked, not left to the plugin.
        assert.deepEqual(deps.removedStylesheets, ["test.plugin"]);
    });

    it("refuses each extension API without its declared permission, with no residue", () => {
        const cases: Array<[string, (ctx: Parameters<Plugin["install"]>[0]) => void]> = [
            ["composer-actions", (ctx) => ctx.addComposerAction({ id: "a1", label: "One", run() {} })],
            ["commands", (ctx) => ctx.addCommand({ name: "shrug", run() {} })],
            ["member-decorations", (ctx) => ctx.addMemberDecoration({ id: "d1", component: PluginComp })],
            ["settings-tabs", (ctx) => ctx.addSettingsTab({ id: "s1", title: "One", component: PluginComp })],
            ["styles", (ctx) => ctx.injectStylesheet(".tumult-demo { color: red; }")],
            ["workspace-panes", (ctx) => ctx.addPane({ id: "p1", label: "One", content: PluginComp })],
        ];

        for (const [permission, use] of cases) {
            const deps = makeDeps();
            const plugins = new PluginRegistry(deps);
            const plugin: Plugin = { manifest: manifest({ permissions: [] }), install: use };
            assert.throws(() => plugins.install(plugin), new RegExp(permission), permission);
            assert.equal(plugins.has("test.plugin"), false, permission);
            assert.equal(deps.composerActions.all().length, 0, permission);
            assert.equal(deps.commands.all().length, 0, permission);
            assert.equal(deps.memberDecorations.resolve({} as never).length, 0, permission);
            assert.equal(deps.settingsTabs.all().length, 0, permission);
            assert.equal(deps.panes.all().length, 0, permission);
            assert.equal(deps.stylesheets.length, 0, permission);
        }
    });

    it("exposes shell-level registration methods that are unpermissioned", () => {
        const deps = makeDeps();
        const plugins = new PluginRegistry(deps);
        const actionDispose = plugins.addComposerAction({ id: "a1", label: "One", run() {} });
        const commandDispose = plugins.addCommand({ name: "shrug", run() {} });
        const badgeDispose = plugins.addMemberDecoration({ id: "d1", component: PluginComp });
        const tabDispose = plugins.addSettingsTab({ id: "s1", title: "One", component: PluginComp });
        const stylesDispose = plugins.injectStylesheet(".tumult-demo { color: red; }");
        const paneDispose = plugins.addPane({ id: "p1", label: "One", content: PluginComp });

        assert.equal(deps.composerActions.all().length, 1);
        assert.equal(deps.commands.all().length, 1);
        assert.equal(deps.memberDecorations.resolve({} as never).length, 1);
        assert.equal(deps.settingsTabs.all().length, 1);
        assert.equal(deps.panes.all().length, 1);
        // Shell-level styles have no plugin manifest to borrow an id from.
        assert.deepEqual(deps.stylesheets, [
            { css: ".tumult-demo { color: red; }", owner: "shell" },
        ]);

        actionDispose();
        commandDispose();
        badgeDispose();
        tabDispose();
        stylesDispose();
        paneDispose();
        assert.equal(deps.composerActions.all().length, 0);
        assert.equal(deps.commands.all().length, 0);
        assert.equal(deps.memberDecorations.resolve({} as never).length, 0);
        assert.equal(deps.settingsTabs.all().length, 0);
        assert.equal(deps.panes.all().length, 0);
        assert.deepEqual(deps.removedStylesheets, ["shell"]);
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
