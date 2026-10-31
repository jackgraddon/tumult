import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { MemberView, RoomPowerLevelsView } from "@tumult/core";

import { buildMemberMenu, type MemberMenu } from "../src/members/memberMenu.ts";

const ALICE = "@alice:example.com";

function member(overrides: Partial<MemberView> = {}): MemberView {
    return {
        userId: ALICE,
        displayName: "alice",
        avatarUrl: null,
        membership: "join",
        powerLevel: 0,
        isSelf: false,
        presence: "online",
        verification: "unknown",
        lastActiveTs: null,
        ...overrides,
    };
}

function powerLevels(myPowerLevel = 100, overrides: Partial<RoomPowerLevelsView> = {}): RoomPowerLevelsView {
    return {
        users: {},
        usersDefault: 0,
        eventsDefault: 0,
        stateDefault: 50,
        ban: 50,
        kick: 50,
        redact: 50,
        invite: 0,
        events: {},
        myPowerLevel,
        canKick: myPowerLevel >= 50,
        canBan: myPowerLevel >= 50,
        canSetPowerLevel: myPowerLevel >= 50,
        canEditSettings: myPowerLevel >= 50,
        ...overrides,
    };
}

/** Entry ids with group separators as "|", so grouping is assertable. */
function shape(menu: MemberMenu): string[] {
    return menu.entries.map((entry) => (entry.kind === "separator" ? "|" : entry.id));
}

describe("buildMemberMenu", () => {
    it("always offers the copy pair, before any moderation", () => {
        assert.deepEqual(shape(buildMemberMenu(member(), { power: powerLevels() })), [
            "copy-id",
            "copy-link",
            "|",
            "set-power",
            "kick",
            "ban",
        ]);
    });

    it("links a user and their id, with no permission needed", () => {
        const menu = buildMemberMenu(member(), { power: null });
        assert.equal(menu.userLink, "https://matrix.to/#/@alice:example.com");
        assert.deepEqual(shape(menu), ["copy-id", "copy-link"]);
    });

    it("offers unban (not kick/ban) to a banned member", () => {
        const menu = buildMemberMenu(member({ membership: "ban" }), { power: powerLevels() });
        assert.deepEqual(shape(menu), ["copy-id", "copy-link", "|", "unban"]);
    });

    it("offers no kick/ban to an invited member, but still lets permissions change", () => {
        const menu = buildMemberMenu(member({ membership: "invite" }), { power: powerLevels() });
        assert.deepEqual(shape(menu), ["copy-id", "copy-link", "|", "set-power"]);
    });

    it("refuses everything against ourselves, whatever our rank", () => {
        const menu = buildMemberMenu(member({ isSelf: true, powerLevel: 100 }), {
            power: powerLevels(100),
        });
        assert.deepEqual(shape(menu), ["copy-id", "copy-link"]);
    });

    it("refuses everything against an equal or higher member", () => {
        for (const level of [50, 100]) {
            const menu = buildMemberMenu(member({ powerLevel: level }), { power: powerLevels(50) });
            assert.deepEqual(shape(menu), ["copy-id", "copy-link"], `level ${level} must be out of reach`);
        }
    });

    it("honours each can* flag independently", () => {
        const kickOnly = buildMemberMenu(member(), {
            power: powerLevels(100, { canBan: false, canSetPowerLevel: false }),
        });
        assert.deepEqual(shape(kickOnly), ["copy-id", "copy-link", "|", "kick"]);

        const noneAtAll = buildMemberMenu(member(), {
            power: powerLevels(100, { canKick: false, canBan: false, canSetPowerLevel: false }),
        });
        assert.deepEqual(shape(noneAtAll), ["copy-id", "copy-link"]);
    });

    it("marks kick and ban destructive, and nothing else", () => {
        const entries = buildMemberMenu(member(), { power: powerLevels() }).entries;
        const danger = entries.filter((entry) => entry.kind === "item" && entry.danger);
        assert.deepEqual(
            danger.map((entry) => (entry.kind === "item" ? entry.id : "")),
            ["kick", "ban"],
        );
    });

    it("names the target in the moderation labels", () => {
        const menu = buildMemberMenu(member(), { power: powerLevels() });
        const labels = menu.entries
            .filter((entry) => entry.kind === "item")
            .map((entry) => (entry.kind === "item" ? entry.label : ""));
        assert.ok(labels.includes("Kick alice"), "kick should name the member");
        assert.ok(labels.includes("Ban alice"), "ban should name the member");
    });
});
