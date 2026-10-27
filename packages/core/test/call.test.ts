import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Widget } from "matrix-widget-api";

import { callIntent, callUrlTemplate } from "../src/call/manager.ts";
import { createFakeChatClient } from "../src/fake/index.ts";

describe("callIntent", () => {
    it("maps video/voice and room/DM onto Element Call's intents", () => {
        assert.equal(callIntent(true, false), "start_call");
        assert.equal(callIntent(false, false), "start_call_voice");
        assert.equal(callIntent(true, true), "start_call_dm");
        assert.equal(callIntent(false, true), "start_call_dm_voice");
    });
});

describe("callUrlTemplate", () => {
    const widget = (url: string): Widget =>
        new Widget({ id: "w1", creatorUserId: "@me:example.com", type: "m.custom", url, waitForIframeLoad: true });

    it("fills every widget parameter Element Call requires, in the fragment", () => {
        const template = callUrlTemplate("https://call.example.com/", { origin: "https://app.example.com", intent: "start_call" });
        const url = widget(template).getCompleteUrl({
            widgetRoomId: "!room:example.com",
            currentUserId: "@me:example.com",
            deviceId: "DEV1",
            baseUrl: "https://matrix.example.com",
            clientTheme: "dark",
            clientLanguage: "en",
        });
        const [path, fragment] = url.split("#?");
        assert.equal(path, "https://call.example.com/");
        const params = new URLSearchParams(fragment);
        assert.equal(params.get("widgetId"), "w1");
        assert.equal(params.get("userId"), "@me:example.com");
        assert.equal(params.get("deviceId"), "DEV1");
        assert.equal(params.get("baseUrl"), "https://matrix.example.com");
        assert.equal(params.get("roomId"), "!room:example.com");
        assert.equal(params.get("parentUrl"), "https://app.example.com");
        assert.equal(params.get("intent"), "start_call");
        assert.equal(params.get("header"), "none");
        // An unsubstituted token would reach the call app as a literal `$…`.
        assert.ok(!url.includes("$"), url);
    });
});

describe("fake client calls", () => {
    it("joins and leaves a call, and rejects an unknown room", async () => {
        const client = createFakeChatClient();
        assert.equal(client.supportsCalls(), true);
        assert.equal(client.call.get(), null);
        const room = client.rooms.get()[0];
        assert.ok(room);
        await client.joinCall(room.id, { video: false });
        assert.equal(client.call.get()?.roomId, room.id);
        assert.equal(client.call.get()?.video, false);
        await client.leaveCall();
        assert.equal(client.call.get(), null);
        await assert.rejects(client.joinCall("!nope:fake", { video: true }));
    });
});

describe("fake client voice", () => {
    it("joins voice, mutes, and is replaced by a call (they share the device's membership)", async () => {
        const client = createFakeChatClient();
        const room = client.rooms.get()[0];
        assert.ok(room);
        assert.equal(client.supportsVoice(), true);
        await client.joinVoice(room.id);
        assert.equal(client.voice.get()?.state, "connected");
        await client.setVoiceMuted(true);
        assert.equal(client.voice.get()?.muted, true);
        assert.equal(client.voice.get()?.participants.find((p) => p.userId === "@demo:example.com")?.muted, true);
        await client.joinCall(room.id, { video: false });
        assert.equal(client.voice.get(), null, "starting a call must end voice");
        await client.joinVoice(room.id);
        assert.equal(client.call.get(), null, "joining voice must end the call");
        await client.leaveVoice();
        assert.equal(client.voice.get(), null);
        await assert.rejects(client.joinVoice("!nope:fake"));
    });
});
