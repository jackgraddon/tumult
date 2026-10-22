import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildBuiltinSource } from "../src/icons/emit.ts";
import { BUILTIN_ICON_NAMES } from "../src/icons/names.ts";
import { BUILTIN_ICON_PATHS } from "../src/icons/builtin.generated.ts";
import { IconRegistry, parseIconRef } from "../src/icons/registry.ts";
import { mdiPack } from "../src/icons/mdi.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("icon names", () => {
    it("parses bare and prefixed names, rejects everything else", () => {
        assert.deepEqual(parseIconRef("cog"), { pack: "mdi", name: "cog" });
        assert.deepEqual(parseIconRef("thumb-up"), { pack: "mdi", name: "thumb-up" });
        assert.deepEqual(parseIconRef("solar:home-2"), { pack: "solar", name: "home-2" });
        for (const literal of ["👍", "A", "Cog", "a b", "", "-x", "x-", "m:", ":x"]) {
            assert.equal(parseIconRef(literal), null, literal);
        }
    });
});

describe("built-in icons", () => {
    it("builtin.generated.ts matches the name list and @mdi/js", async () => {
        const expected = await buildBuiltinSource(BUILTIN_ICON_NAMES);
        const actual = readFileSync(join(here, "..", "src", "icons", "builtin.generated.ts"), "utf8");
        assert.equal(actual, expected, "run `pnpm --filter @tumult/ui emit:icons` and commit the result");
    });

    it("every icon the chrome names is in the built-in set", () => {
        const used = new Set<string>();
        const sources = [
            "rail/GuildRail.vue", "rail/DmsRailItem.vue", "rail/UserBar.vue", "rail/PaneRailItem.vue",
            "roomlist/RoomListPane.vue", "roomlist/SpaceCategory.vue", "members/MembersPane.vue",
            "rooms/UserPicker.vue", "shell/TumultShell.vue", "threads/ThreadList.vue",
            "threads/ThreadPanel.vue", "timeline/MessageComposer.vue", "timeline/SearchPanel.vue",
            "timeline/TimelinePane.vue", "timeline/TimelineRow.vue",
        ];
        for (const file of sources) {
            const text = readFileSync(join(here, "..", "src", file), "utf8");
            for (const m of text.matchAll(/(?<![:\w-])name="([a-z0-9:-]+)"/g)) used.add(m[1]!);
            for (const m of text.matchAll(/:name="[^"]*\? '([a-z0-9-]+)' : '([a-z0-9-]+)'/g)) {
                used.add(m[1]!);
                used.add(m[2]!);
            }
        }
        assert.ok(used.size > 10, "found the icon names");
        for (const name of used) assert.ok(name in BUILTIN_ICON_PATHS, `"${name}" is not in BUILTIN_ICON_NAMES`);
    });
});

describe("IconRegistry", () => {
    it("resolves built-ins synchronously and the rest of the library lazily", async () => {
        const registry = new IconRegistry();
        registry.addPack("mdi", mdiPack);
        const sync = registry.resolve("cog");
        assert.ok(sync && !(sync instanceof Promise));
        const lazy = await registry.resolve("rocket-launch");
        assert.ok(lazy?.path.startsWith("M"));
        assert.equal(await registry.resolve("not-a-real-icon-name"), undefined);
    });

    it("routes prefixed names to their pack and treats unknown packs and literals as unresolved", async () => {
        const registry = new IconRegistry();
        registry.addPack("mdi", mdiPack);
        const remove = registry.addPack("mine", { resolve: (name) => (name === "star" ? { path: "M0 0", viewBox: 16 } : undefined) });
        assert.deepEqual(registry.resolve("mine:star"), { path: "M0 0", viewBox: 16 });
        assert.equal(registry.resolve("mine:other"), undefined);
        assert.equal(registry.resolve("nope:star"), undefined);
        assert.equal(registry.resolve("👍"), undefined);
        remove();
        assert.equal(registry.resolve("mine:star"), undefined);
        assert.throws(() => registry.addPack("Bad Id", mdiPack));
    });
});
