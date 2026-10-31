import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { MessageView, RoomPowerLevelsView } from "@tumult/core";

import {
    QUICK_REACTIONS,
    buildMessageMenu,
    type MessageMenu,
    type MessageMenuOptions,
} from "../src/timeline/messageMenu.ts";
import { matrixEventLink } from "../src/links.ts";

/**
 * The menu is built as data so permission gating can be tested without a
 * virtualized row: every case below is "message + room power levels + which
 * handlers the row was given" in, item list out.
 */
const SELF = "@demo:example.com";
const ALICE = "@alice:example.com";

function message(overrides: Partial<MessageView> = {}): MessageView {
    return {
        id: "$event:example.com",
        type: "m.room.message",
        senderId: ALICE,
        senderName: "alice",
        senderAvatarUrl: null,
        body: "hello there",
        timestamp: 1_700_000_000_000,
        status: "sent",
        decryption: "ok",
        content: { msgtype: "m.text", body: "hello there" },
        edited: false,
        redacted: false,
        reply: null,
        reactions: [],
        readBy: [],
        ...overrides,
    };
}

function powerLevels(
    users: Record<string, number> = {},
    usersDefault = 0,
    myPowerLevel = 100,
): RoomPowerLevelsView {
    return {
        users,
        usersDefault,
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
    };
}

/** Everything the main timeline wires up, with our own message in hand. */
const FULL: MessageMenuOptions = {
    roomId: "!room:example.com",
    selfId: SELF,
    power: powerLevels(),
    threadReplyCount: 0,
    canReact: true,
    canReply: true,
    canEdit: true,
    canDeleteOwn: true,
    canDelete: true,
    canOpenThread: true,
};

/** Entry ids only, in render order. */
function ids(menu: MessageMenu): string[] {
    return menu.entries.filter((entry) => entry.kind !== "separator").map((entry) => entry.id);
}

/** Entry ids with group separators as "|", so grouping is assertable. */
function shape(menu: MessageMenu): string[] {
    return menu.entries.map((entry) => (entry.kind === "separator" ? "|" : entry.id));
}

function label(menu: MessageMenu, id: string): string | undefined {
    const entry = menu.entries.find((e) => e.kind === "item" && e.id === id);
    return entry?.kind === "item" ? entry.label : undefined;
}

describe("buildMessageMenu", () => {
    it("orders a fully-capable own message: react, conversation, copy, destructive", () => {
        const menu = buildMessageMenu(message({ senderId: SELF }), FULL);

        assert.deepEqual(shape(menu), [
            "add-reaction",
            "reply",
            "edit",
            "thread",
            "|",
            "copy-text",
            "copy-link",
            "copy-id",
            "view-source",
            "|",
            "delete",
        ]);
        assert.deepEqual(menu.quickReactions, QUICK_REACTIONS.slice(0, 4));
        assert.deepEqual(menu.reactions, QUICK_REACTIONS);
    });

    it("links to the canonical matrix.to event URL", () => {
        const menu = buildMessageMenu(message(), FULL);
        assert.equal(menu.matrixLink, "https://matrix.to/#/!room:example.com/$event:example.com");
        assert.equal(
            menu.matrixLink,
            matrixEventLink("!room:example.com", "$event:example.com"),
        );
    });

    it("flags only the destructive item as danger", () => {
        const menu = buildMessageMenu(message({ senderId: SELF }), FULL);
        for (const entry of menu.entries) {
            if (entry.kind !== "item") continue;
            assert.equal(entry.danger, entry.id === "delete", `wrong danger flag on ${entry.id}`);
        }
    });

    it("labels the thread item by whether replies already exist", () => {
        assert.equal(label(buildMessageMenu(message(), FULL), "thread"), "Create thread");
        assert.equal(
            label(buildMessageMenu(message(), { ...FULL, threadReplyCount: 3 }), "thread"),
            "View thread",
        );
    });

    it("lets a moderator delete a message from a sender strictly below them", () => {
        const menu = buildMessageMenu(message(), {
            ...FULL,
            canEdit: false,
            canDeleteOwn: false,
            power: powerLevels({ [ALICE]: 50 }),
        });
        assert.deepEqual(shape(menu), [
            "add-reaction",
            "reply",
            "thread",
            "|",
            "copy-text",
            "copy-link",
            "copy-id",
            "view-source",
            "|",
            "delete",
        ]);
    });

    it("refuses a moderation delete against an equal or higher sender", () => {
        const equal = buildMessageMenu(message(), {
            ...FULL,
            canEdit: false,
            canDeleteOwn: false,
            power: powerLevels({ [ALICE]: 100 }),
        });
        assert.ok(!ids(equal).includes("delete"), "an equal level must not offer delete");

        const higher = buildMessageMenu(message(), {
            ...FULL,
            canEdit: false,
            canDeleteOwn: false,
            power: powerLevels({ [ALICE]: 101 }),
        });
        assert.ok(!ids(higher).includes("delete"), "a higher level must not offer delete");
    });

    it("refuses a moderation delete when the sender is only covered by users_default above us", () => {
        const menu = buildMessageMenu(message(), {
            ...FULL,
            canEdit: false,
            canDeleteOwn: false,
            power: powerLevels({}, 100),
        });
        assert.ok(!ids(menu).includes("delete"));
    });

    it("refuses a moderation delete when we cannot redact at all", () => {
        const menu = buildMessageMenu(message(), {
            ...FULL,
            canEdit: false,
            canDeleteOwn: false,
            power: powerLevels({ [ALICE]: 0 }, 0, 0),
        });
        assert.ok(!ids(menu).includes("delete"));
    });

    it("refuses a moderation delete with no session to identify ourselves", () => {
        const menu = buildMessageMenu(message(), {
            ...FULL,
            canEdit: false,
            canDeleteOwn: false,
            selfId: null,
            power: powerLevels({ [ALICE]: 0 }),
        });
        assert.ok(!ids(menu).includes("delete"));
    });

    it("refuses a delete without a redact handler, even with the power for it", () => {
        const menu = buildMessageMenu(message(), {
            ...FULL,
            canEdit: false,
            canDeleteOwn: false,
            canDelete: false,
            power: powerLevels({ [ALICE]: 0 }),
        });
        assert.ok(!ids(menu).includes("delete"));
    });

    it("offers only server-side actions on a message awaiting decryption", () => {
        // A redact is addressed by event id, so moderation still reaches an
        // encrypted event — but nothing that reads its payload does.
        const menu = buildMessageMenu(
            message({ decryption: "pending" }),
            {
                ...FULL,
                canReply: false,
                canEdit: false,
                canDeleteOwn: false,
                power: powerLevels({ [ALICE]: 0 }),
            },
        );

        assert.deepEqual(shape(menu), ["delete"]);
        assert.deepEqual(menu.quickReactions, []);
        assert.deepEqual(menu.reactions, []);
        assert.equal(menu.matrixLink, null);
    });

    it("offers no moderation delete on an unsent echo, which has no server event", () => {
        const menu = buildMessageMenu(
            message({ status: "failed" }),
            { ...FULL, canEdit: false, canDeleteOwn: false, power: powerLevels({ [ALICE]: 0 }) },
        );
        assert.ok(!ids(menu).includes("delete"));
    });

    it("keeps a tombstone to conversation actions", () => {
        const menu = buildMessageMenu(
            message({ redacted: true, body: "Message deleted." }),
            { ...FULL, canEdit: false, canDeleteOwn: false, power: powerLevels({ [ALICE]: 0 }) },
        );

        assert.deepEqual(shape(menu), ["add-reaction", "reply", "thread"]);
        assert.equal(menu.matrixLink, null);
    });

    it("drops the reaction affordances when the client cannot react", () => {
        const menu = buildMessageMenu(message(), { ...FULL, canReact: false });
        assert.deepEqual(menu.quickReactions, []);
        assert.deepEqual(menu.reactions, []);
        assert.ok(!ids(menu).includes("add-reaction"));
    });

    it("still offers the reaction submenu on a message it cannot decrypt", () => {
        const menu = buildMessageMenu(message({ decryption: "failed" }), FULL);
        assert.deepEqual(menu.reactions, []);
        assert.ok(!ids(menu).includes("add-reaction"));
    });

    it("offers nothing but copy and inspect when no handlers are wired (thread panel)", () => {
        const menu = buildMessageMenu(message(), {
            ...FULL,
            canReact: false,
            canReply: false,
            canEdit: false,
            canDeleteOwn: false,
            canDelete: false,
            canOpenThread: false,
        });

        assert.deepEqual(shape(menu), ["copy-text", "copy-link", "copy-id", "view-source"]);
    });

    it("omits Copy text when there is no body to copy", () => {
        const menu = buildMessageMenu(
            message({ body: "", content: { msgtype: "m.image", url: "mxc://example.com/abc" } }),
            FULL,
        );
        assert.deepEqual(shape(menu), [
            "add-reaction",
            "reply",
            "edit",
            "thread",
            "|",
            "copy-link",
            "copy-id",
            "view-source",
            "|",
            "delete",
        ]);
    });

    it("copies text but not a link from an echo the server has not accepted", () => {
        const menu = buildMessageMenu(message({ status: "sending" }), {
            ...FULL,
            canDeleteOwn: false,
        });

        assert.deepEqual(shape(menu), [
            "add-reaction",
            "reply",
            "edit",
            "thread",
            "|",
            "copy-text",
            "view-source",
        ]);
        assert.equal(menu.matrixLink, null);
    });

    it("returns an empty menu when nothing applies at all", () => {
        const menu = buildMessageMenu(message({ decryption: "pending" }), {
            ...FULL,
            canReact: false,
            canReply: false,
            canEdit: false,
            canDeleteOwn: false,
            canDelete: false,
            canOpenThread: false,
        });

        assert.deepEqual(menu.entries, []);
        assert.equal(menu.matrixLink, null);
    });
});
