import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenIDRequestState, SimpleObservable } from "matrix-widget-api";
import type { IOpenIDUpdate } from "matrix-widget-api";
import type { MatrixClient } from "matrix-js-sdk";

import { CallWidgetDriver } from "../src/call/driver.ts";

const ROOM = "!call:localhost";

/** Every SDK call the driver makes, in order, as `[method, ...args]`. */
type Calls = unknown[][];

function stub(overrides: Record<string, unknown> = {}): { client: MatrixClient; calls: Calls } {
    const calls: Calls = [];
    const record =
        (name: string, result: unknown = {}) =>
        (...args: unknown[]): Promise<unknown> => {
            calls.push([name, ...args]);
            return Promise.resolve(typeof result === "function" ? (result as () => unknown)() : result);
        };
    const client = {
        sendStateEvent: record("sendStateEvent", { event_id: "$state" }),
        sendEvent: record("sendEvent", { event_id: "$event" }),
        _unstable_sendDelayedStateEvent: record("sendDelayedStateEvent", { delay_id: "d-state" }),
        _unstable_sendDelayedEvent: record("sendDelayedEvent", { delay_id: "d-event" }),
        _unstable_sendStickyEvent: record("sendStickyEvent", { event_id: "$sticky" }),
        _unstable_sendStickyDelayedEvent: record("sendStickyDelayedEvent", { delay_id: "d-sticky" }),
        _unstable_updateDelayedEvent: record("updateDelayedEvent"),
        _unstable_getRTCTransports: record("getRTCTransports", [
            { type: "livekit", livekit_service_url: "https://jwt.example.com" },
        ]),
        _unstable_getLivekitToken: record("getLivekitToken", { jwt: "the.jwt" }),
        _unstable_delegateDelayedLeave: record("delegateDelayedLeave"),
        queueToDevice: record("queueToDevice"),
        getOpenIdToken: record("getOpenIdToken", { access_token: "oidc" }),
        checkTurnServers: record("checkTurnServers", true),
        getTurnServers: () => [{ urls: ["turn:t.example.com"], username: "u", credential: "p" }],
        getCrypto: () => undefined,
        getRoom: () => undefined,
        ...overrides,
    } as unknown as MatrixClient;
    return { client, calls };
}

describe("CallWidgetDriver", () => {
    it("approves the capabilities the call app asks for", async () => {
        const driver = new CallWidgetDriver(stub().client, ROOM);
        const asked = new Set(["org.matrix.msc2762.send.state_event:org.matrix.msc3401.call.member"]);
        assert.deepEqual([...(await driver.validateCapabilities(asked))], [...asked]);
    });

    it("only knows the call's own room", () => {
        assert.deepEqual(new CallWidgetDriver(stub().client, ROOM).getKnownRooms(), [ROOM]);
    });

    describe("sending", () => {
        it("sends a state event when a state key is given (even an empty one)", async () => {
            const { client, calls } = stub();
            const driver = new CallWidgetDriver(client, ROOM);
            const sent = await driver.sendEvent("org.matrix.msc3401.call.member", { a: 1 }, "", ROOM);
            assert.deepEqual(calls, [["sendStateEvent", ROOM, "org.matrix.msc3401.call.member", { a: 1 }, ""]]);
            assert.deepEqual(sent, { roomId: ROOM, eventId: "$state" });
        });

        it("sends a timeline event when the state key is null, defaulting to the call's room", async () => {
            const { client, calls } = stub();
            const driver = new CallWidgetDriver(client, ROOM);
            const sent = await driver.sendEvent("m.rtc.notification", { b: 2 }, null, null);
            assert.deepEqual(calls, [["sendEvent", ROOM, "m.rtc.notification", { b: 2 }]]);
            assert.equal(sent.eventId, "$event");
        });

        it("refuses any other room, before touching the SDK", async () => {
            const { client, calls } = stub();
            const driver = new CallWidgetDriver(client, ROOM);
            await assert.rejects(driver.sendEvent("m.room.message", {}, null, "!other:localhost"), /only use/);
            await assert.rejects(driver.sendStickyEvent(1000, "m.rtc.member", {}, "!other:localhost"), /only use/);
            await assert.rejects(driver.readRoomState("!other:localhost", "m.room.member", undefined), /only use/);
            assert.deepEqual(calls, []);
        });

        it("schedules a delayed state event with the requested delay", async () => {
            const { client, calls } = stub();
            const details = await new CallWidgetDriver(client, ROOM).sendDelayedEvent(8000, "org.matrix.msc3401.call.member", {}, "@me:localhost_DEV");
            assert.deepEqual(calls, [["sendDelayedStateEvent", ROOM, { delay: 8000 }, "org.matrix.msc3401.call.member", {}, "@me:localhost_DEV"]]);
            assert.deepEqual(details, { roomId: ROOM, delayId: "d-state" });
        });

        it("schedules a delayed timeline event when there is no state key", async () => {
            const { client, calls } = stub();
            const details = await new CallWidgetDriver(client, ROOM).sendDelayedEvent(500, "m.rtc.notification", {}, null);
            assert.deepEqual(calls, [["sendDelayedEvent", ROOM, { delay: 500 }, null, "m.rtc.notification", {}]]);
            assert.equal(details.delayId, "d-event");
        });

        it("sends sticky and delayed-sticky events with their durations", async () => {
            const { client, calls } = stub();
            const driver = new CallWidgetDriver(client, ROOM);
            await driver.sendStickyEvent(60000, "m.rtc.member", { c: 3 });
            await driver.sendDelayedStickyEvent(8000, 60000, "m.rtc.member", { c: 4 });
            assert.deepEqual(calls, [
                ["sendStickyEvent", ROOM, 60000, null, "m.rtc.member", { c: 3 }],
                ["sendStickyDelayedEvent", ROOM, 60000, { delay: 8000 }, null, "m.rtc.member", { c: 4 }],
            ]);
        });

        it("maps cancel / restart / send onto the delayed-event actions the server speaks", async () => {
            const { client, calls } = stub();
            const driver = new CallWidgetDriver(client, ROOM);
            await driver.cancelScheduledDelayedEvent("d1");
            await driver.restartScheduledDelayedEvent("d2");
            await driver.sendScheduledDelayedEvent("d3");
            assert.deepEqual(
                calls.map(([name, id, action]) => [name, id, action]),
                [
                    ["updateDelayedEvent", "d1", "cancel"],
                    ["updateDelayedEvent", "d2", "restart"],
                    ["updateDelayedEvent", "d3", "send"],
                ],
            );
        });
    });

    describe("to-device", () => {
        const contentMap = { "@a:localhost": { DEV1: { k: 1 }, DEV2: { k: 2 } }, "@b:localhost": { DEV3: { k: 3 } } };

        it("queues an unencrypted message to every listed device in one batch", async () => {
            const { client, calls } = stub();
            await new CallWidgetDriver(client, ROOM).sendToDevice("io.element.call.keys", false, contentMap);
            assert.equal(calls.length, 1);
            const [name, batch] = calls[0] as [string, { eventType: string; batch: unknown[] }];
            assert.equal(name, "queueToDevice");
            assert.equal(batch.eventType, "io.element.call.keys");
            assert.deepEqual(batch.batch, [
                { userId: "@a:localhost", deviceId: "DEV1", payload: { k: 1 } },
                { userId: "@a:localhost", deviceId: "DEV2", payload: { k: 2 } },
                { userId: "@b:localhost", deviceId: "DEV3", payload: { k: 3 } },
            ]);
        });

        it("encrypts per device through the crypto API, then queues what it returned", async () => {
            const seen: unknown[] = [];
            const crypto = {
                encryptToDeviceMessages: (eventType: string, devices: unknown[], payload: unknown) => {
                    seen.push([eventType, devices, payload]);
                    return Promise.resolve({
                        eventType: "m.room.encrypted",
                        batch: [{ userId: (devices[0] as { userId: string }).userId, deviceId: (devices[0] as { deviceId: string }).deviceId, payload: { ct: "x" } }],
                    });
                },
            };
            const { client, calls } = stub({ getCrypto: () => crypto });
            await new CallWidgetDriver(client, ROOM).sendToDevice("io.element.call.keys", true, contentMap);
            assert.equal(seen.length, 3, "one encrypt call per device, so each gets its own payload");
            assert.deepEqual(seen[0], ["io.element.call.keys", [{ userId: "@a:localhost", deviceId: "DEV1" }], { k: 1 }]);
            const [, queued] = calls[0] as [string, { eventType: string; batch: unknown[] }];
            assert.equal(queued.eventType, "m.room.encrypted", "the queued type is the encrypted wrapper, not the call type");
            assert.equal(queued.batch.length, 3);
        });

        it("refuses to send encrypted messages without crypto, rather than sending in the clear", async () => {
            const { client, calls } = stub();
            await assert.rejects(new CallWidgetDriver(client, ROOM).sendToDevice("io.element.call.keys", true, contentMap), /without crypto/);
            assert.deepEqual(calls, []);
        });
    });

    describe("reading", () => {
        function roomWithState(events: Record<string, Record<string, unknown>>) {
            const wrap = (raw: unknown) => ({ getEffectiveEvent: () => raw });
            return {
                currentState: {
                    getStateEvents: (type: string, key?: string) => {
                        const byKey = events[type] ?? {};
                        if (key !== undefined) return byKey[key] ? wrap(byKey[key]) : null;
                        return Object.values(byKey).map(wrap);
                    },
                },
                _unstable_getStickyEvents: () => [{ event: { type: "m.rtc.member", content: { s: 1 } } }],
            };
        }

        it("reads one state event by key, or all of a type, as raw events", async () => {
            const room = roomWithState({ "m.rtc.slot": { a: { id: "a" }, b: { id: "b" } } });
            const driver = new CallWidgetDriver(stub({ getRoom: () => room }).client, ROOM);
            assert.deepEqual(await driver.readRoomState(ROOM, "m.rtc.slot", "a"), [{ id: "a" }]);
            assert.deepEqual(await driver.readRoomState(ROOM, "m.rtc.slot", undefined), [{ id: "a" }, { id: "b" }]);
            assert.deepEqual(await driver.readRoomState(ROOM, "m.rtc.slot", "missing"), []);
        });

        it("returns nothing for a room it does not hold yet", async () => {
            const driver = new CallWidgetDriver(stub().client, ROOM);
            assert.deepEqual(await driver.readRoomState(ROOM, "m.rtc.slot", undefined), []);
            assert.deepEqual(await driver.readStickyEvents(ROOM), []);
        });

        it("honours the room filter and the limit on readStateEvents", async () => {
            const room = roomWithState({ "m.rtc.slot": { a: { id: "a" }, b: { id: "b" } } });
            const driver = new CallWidgetDriver(stub({ getRoom: () => room }).client, ROOM);
            assert.deepEqual(await driver.readStateEvents("m.rtc.slot", undefined, 1, [ROOM]), [{ id: "a" }]);
            assert.deepEqual(await driver.readStateEvents("m.rtc.slot", undefined, 10, ["!other:localhost"]), []);
            assert.equal((await driver.readStateEvents("m.rtc.slot", undefined, 10, ["*"])).length, 2);
        });

        it("reads sticky events as raw events", async () => {
            const room = roomWithState({});
            const driver = new CallWidgetDriver(stub({ getRoom: () => room }).client, ROOM);
            assert.deepEqual(await driver.readStickyEvents(ROOM), [{ type: "m.rtc.member", content: { s: 1 } }]);
        });
    });

    describe("services", () => {
        it("answers an OpenID request with the token, or blocks when the server refuses", async () => {
            const ok = new SimpleObservable<IOpenIDUpdate>();
            const first = new Promise<IOpenIDUpdate>((resolve) => ok.onUpdate(resolve));
            new CallWidgetDriver(stub().client, ROOM).askOpenID(ok);
            const allowed = await first;
            assert.equal(allowed.state, OpenIDRequestState.Allowed);

            const refusing = new SimpleObservable<IOpenIDUpdate>();
            const second = new Promise<IOpenIDUpdate>((resolve) => refusing.onUpdate(resolve));
            new CallWidgetDriver(stub({ getOpenIdToken: () => Promise.reject(new Error("no")) }).client, ROOM).askOpenID(refusing);
            assert.equal((await second).state, OpenIDRequestState.Blocked);
        });

        it("yields TURN servers in the widget API's field names", async () => {
            const driver = new CallWidgetDriver(stub().client, ROOM);
            const servers = [];
            for await (const server of driver.getTurnServers()) servers.push(server);
            assert.deepEqual(servers, [{ uris: ["turn:t.example.com"], username: "u", password: "p" }]);
        });

        it("passes the homeserver's RTC transports straight through", async () => {
            const result = await new CallWidgetDriver(stub().client, ROOM).getRtcTransports();
            assert.deepEqual(result, { rtc_transports: [{ type: "livekit", livekit_service_url: "https://jwt.example.com" }] });
        });

        it("forwards a LiveKit token request field-for-field and returns only the jwt", async () => {
            const { client, calls } = stub();
            const member = { id: "m1", claimed_user_id: "@me:localhost", claimed_device_id: "DEV" };
            const out = await new CallWidgetDriver(client, ROOM).getRtcLivekitToken({
                server_name: "localhost",
                url: "wss://sfu.example.com",
                room_id: ROOM,
                slot_id: "m.call#ROOM",
                member,
            } as never);
            assert.deepEqual(out, { jwt: "the.jwt" });
            assert.deepEqual(calls[0], [
                "getLivekitToken",
                { url: "wss://sfu.example.com", room_id: ROOM, slot_id: "m.call#ROOM", member, server_name: "localhost" },
            ]);
        });

        it("delegates a delayed leave with exactly the request the call app made, SFU url included", async () => {
            const { client, calls } = stub();
            const request = { url: "wss://sfu.example.com", room_id: ROOM, slot_id: "s", member: { id: "m1" }, delay_id: "d9" };
            const out = await new CallWidgetDriver(client, ROOM).delegateRtcLivekitDelayedLeave(request as never);
            assert.deepEqual(out, {});
            // Not the JWT service url from the RTC transports: the server rejects
            // a url that is not one of its SFUs.
            assert.deepEqual(calls, [["delegateDelayedLeave", request]]);
        });
    });
});
