import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computed } from "vue";
import type { Component } from "vue";
import type { MemberView } from "@tumult/core";

import { ContributionList } from "../src/plugins/contributions.ts";
import { ComposerActionsRegistry } from "../src/timeline/composer-actions.ts";
import { CommandsRegistry } from "../src/timeline/commands.ts";
import { MemberDecorationsRegistry } from "../src/members/decorations.ts";
import { SettingsTabsRegistry } from "../src/settings/tabs.ts";

const Comp = { name: "Comp" } as unknown as Component;

interface Entry {
    key: string;
    priority?: number;
}

/** Highest priority first, ties in insertion order (Array.sort is stable). */
function byPriority(a: Entry, b: Entry): number {
    return (b.priority ?? 0) - (a.priority ?? 0);
}

describe("ContributionList", () => {
    it("keeps the compare order and refuses a duplicate key", () => {
        const list = new ContributionList<Entry>((entry) => entry.key, byPriority);
        list.add({ key: "b" });
        list.add({ key: "a", priority: 10 });
        list.add({ key: "c" });

        assert.deepEqual(
            list.all().map((entry) => entry.key),
            ["a", "b", "c"],
        );
        assert.throws(() => list.add({ key: "a" }), /already registered/);
    });

    it("returns an idempotent disposer that removes only its own entry", () => {
        const list = new ContributionList<Entry>((entry) => entry.key, byPriority);
        const dispose = list.add({ key: "a" });

        dispose();
        dispose(); // no-op
        assert.equal(list.all().length, 0);

        // A stale disposer must not take a replacement with the same key down.
        const disposeFirst = list.add({ key: "a" });
        disposeFirst();
        list.add({ key: "a" });
        disposeFirst();
        assert.equal(list.all().length, 1);
    });

    it("rejects an empty key and reports misses from get/remove", () => {
        const list = new ContributionList<Entry>((entry) => entry.key, byPriority);
        assert.throws(() => list.add({ key: "" }), /non-empty key/);
        assert.equal(list.get("nope"), undefined);
        assert.equal(list.remove("nope"), false);
    });

    it("touches its version on every mutation so readers re-evaluate", () => {
        const list = new ContributionList<Entry>((entry) => entry.key, byPriority);
        const count = computed(() => list.all().length);

        assert.equal(count.value, 0); // populate the cache
        list.add({ key: "a" });
        assert.equal(count.value, 1);

        list.remove("a");
        assert.equal(count.value, 0);
    });
});

describe("CommandsRegistry", () => {
    it("normalizes names and refuses duplicates", () => {
        const commands = new CommandsRegistry();
        commands.add({ name: "/Shrug", run() {} });
        assert.deepEqual(
            commands.all().map((command) => command.name),
            ["shrug"],
        );
        assert.throws(() => commands.add({ name: "shrug", run() {} }), /already registered/);
    });

    it("refuses names that are not a single bare token", () => {
        const commands = new CommandsRegistry();
        assert.throws(() => commands.add({ name: "   ", run() {} }), /invalid command name/);
        assert.throws(() => commands.add({ name: "my cmd", run() {} }), /invalid command name/);
        assert.throws(() => commands.add({ name: "a/b", run() {} }), /invalid command name/);
    });

    it("resolves an exact /name with its args, and null for everything else", () => {
        const commands = new CommandsRegistry();
        commands.add({ name: "shrug", run() {} });
        commands.add({ name: "me", run() {} });

        assert.deepEqual(commands.resolve("shrug"), null, "no slash");
        assert.equal(commands.resolve("/nope"), null);
        assert.equal(commands.resolve("/shrugx hi"), null, "longer word is not a match");
        assert.equal(commands.resolve("//shrug"), null);

        const bare = commands.resolve("  /shrug  ");
        assert.ok(bare);
        assert.equal(bare.command.name, "shrug");
        assert.equal(bare.args, "");
        assert.equal(bare.raw, "/shrug");

        const withArgs = commands.resolve("/shrug   deal with it ");
        assert.ok(withArgs);
        assert.equal(withArgs.args, "deal with it");
        assert.equal(withArgs.raw, "/shrug   deal with it");

        const exact = commands.resolve("/me too");
        assert.ok(exact);
        assert.equal(exact.command.name, "me");
        assert.equal(exact.args, "too");
    });

    it("suggests alphabetical prefix matches, and every command for an empty prefix", () => {
        const commands = new CommandsRegistry();
        commands.add({ name: "shrug", run() {} });
        commands.add({ name: "shhh", run() {} });
        commands.add({ name: "me", run() {} });

        assert.deepEqual(
            commands.suggest("sh").map((command) => command.name),
            ["shhh", "shrug"],
        );
        assert.deepEqual(
            commands.suggest("").map((command) => command.name),
            ["me", "shhh", "shrug"],
        );
        assert.deepEqual(commands.suggest("z"), []);
        assert.deepEqual(
            commands.suggest("/ME").map((command) => command.name),
            ["me"],
        );
    });

    it("removes by normalized name", () => {
        const commands = new CommandsRegistry();
        commands.add({ name: "shrug", run() {} });
        assert.equal(commands.remove("/Shrug"), true);
        assert.equal(commands.remove("shrug"), false);
        assert.deepEqual(commands.all(), []);
    });
});

describe("ComposerActionsRegistry", () => {
    it("orders by priority and disposes", () => {
        const actions = new ComposerActionsRegistry();
        actions.add({ id: "low", label: "Low", run() {} });
        actions.add({ id: "high", label: "High", priority: 5, run() {} });
        actions.add({ id: "mid", label: "Mid", priority: 1, run() {} });

        assert.deepEqual(
            actions.all().map((action) => action.id),
            ["high", "mid", "low"],
        );

        assert.equal(actions.remove("mid"), true);
        assert.deepEqual(
            actions.all().map((action) => action.id),
            ["high", "low"],
        );
    });

    it("refuses a duplicate id", () => {
        const actions = new ComposerActionsRegistry();
        actions.add({ id: "a", label: "A", run() {} });
        assert.throws(() => actions.add({ id: "a", label: "Other", run() {} }), /already registered/);
    });
});

describe("MemberDecorationsRegistry", () => {
    function member(overrides: Partial<MemberView> = {}): MemberView {
        return { userId: "@a:example.com", powerLevel: 0, membership: "join", ...overrides } as MemberView;
    }

    it("filters by match and orders by priority", () => {
        const decorations = new MemberDecorationsRegistry();
        decorations.add({ id: "everyone", component: Comp });
        decorations.add({
            id: "admins",
            component: Comp,
            priority: 10,
            match: (m) => m.powerLevel >= 100,
        });

        assert.deepEqual(
            decorations.resolve(member({ powerLevel: 100 })).map((decoration) => decoration.id),
            ["admins", "everyone"],
        );
        assert.deepEqual(
            decorations.resolve(member()).map((decoration) => decoration.id),
            ["everyone"],
        );
    });

    it("removes and rejects duplicates", () => {
        const decorations = new MemberDecorationsRegistry();
        decorations.add({ id: "d", component: Comp });
        assert.throws(() => decorations.add({ id: "d", component: Comp }), /already registered/);
        assert.equal(decorations.remove("d"), true);
        assert.deepEqual(decorations.resolve(member()), []);
    });
});

describe("SettingsTabsRegistry", () => {
    it("orders by priority and disposes", () => {
        const tabs = new SettingsTabsRegistry();
        tabs.add({ id: "plugins", title: "Plugins", component: Comp });
        tabs.add({ id: "first", title: "First", component: Comp, priority: 10 });
        tabs.add({ id: "middle", title: "Middle", component: Comp, priority: 5 });

        assert.deepEqual(
            tabs.all().map((tab) => tab.id),
            ["first", "middle", "plugins"],
        );

        assert.equal(tabs.remove("middle"), true);
        assert.deepEqual(
            tabs.all().map((tab) => tab.id),
            ["first", "plugins"],
        );
    });

    it("refuses a duplicate id and an empty id", () => {
        const tabs = new SettingsTabsRegistry();
        tabs.add({ id: "plugins", title: "Plugins", component: Comp });
        assert.throws(
            () => tabs.add({ id: "plugins", title: "Other", component: Comp }),
            /already registered/,
        );
        assert.throws(() => tabs.add({ id: "", title: "Nameless", component: Comp }), /non-empty key/);
    });
});
