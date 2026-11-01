import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { CallWidgetDriver } from "../src/call/driver.ts";

/**
 * The call widget driver against a real MatrixRTC-capable Synapse.
 *
 * Needs the stack in `tests/rtc/` (`tests/rtc/run.sh`): the default
 * `tests/synapse` server is pinned to v1.114.0 and has none of these MSCs, so
 * this file skips itself unless `TEST_RTC=1`. The token test additionally needs
 * the lk-jwt-service to reach the homeserver's federation OpenID endpoint, which
 * is the part of the stack most likely to need tuning; it is its own test so a
 * failure there does not hide the Synapse-only results.
 *
 * What this proves: the driver's calls are accepted by a real server (delayed
 * and sticky events, the delayed-event actions, the RTC transports endpoint, the
 * LiveKit token exchange). What it cannot: the iframe handshake and media — see
 * the two-browser test.
 */
const BASE = process.env["TEST_SYNAPSE_URL"] ?? "http://localhost:8018";
const enabled = process.env["TEST_RTC"] === "1";
const CALL_MEMBER = "org.matrix.msc3401.call.member";

async function register(username: string): Promise<{ client: MatrixClient; userId: string }> {
    const body = { username, password: "testtesttest", device_id: `RTC-${username.toUpperCase()}` };
    const first = await fetch(`${BASE}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    assert.equal(first.status, 401, `register step 1: ${await first.clone().text()}`);
    const session = ((await first.json()) as { session: string }).session;
    const res = await fetch(`${BASE}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, auth: { type: "m.login.dummy", session } }),
    });
    assert.ok(res.ok, `register step 2: ${await res.clone().text()}`);
    const out = (await res.json()) as { user_id: string; access_token: string; device_id: string };
    const client = createClient({ baseUrl: BASE, userId: out.user_id, accessToken: out.access_token, deviceId: out.device_id });
    return { client, userId: out.user_id };
}

async function setup(): Promise<{ client: MatrixClient; userId: string; roomId: string; driver: CallWidgetDriver }> {
    const { client, userId } = await register(`rtc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
    const { room_id: roomId } = await client.createRoom({ name: "call room" });
    return { client, userId, roomId, driver: new CallWidgetDriver(client, roomId) };
}

describe("call widget driver against a real MatrixRTC Synapse", { skip: !enabled && "set TEST_RTC=1 (tests/rtc/run.sh)" }, () => {
    it("advertises the MSCs a call needs", async () => {
        const res = await fetch(`${BASE}/_matrix/client/versions`);
        const { unstable_features: features } = (await res.json()) as { unstable_features: Record<string, boolean> };
        for (const flag of ["org.matrix.msc4140", "org.matrix.msc4354"]) {
            assert.equal(features[flag], true, `${flag} must be on`);
        }
    });

    it("serves the RTC transports the homeserver is configured with", { timeout: 30000 }, async () => {
        const { driver } = await setup();
        const { rtc_transports: transports } = await driver.getRtcTransports();
        const livekit = transports.find((t) => t.type === "livekit");
        assert.ok(livekit, `no livekit transport in ${JSON.stringify(transports)}`);
        assert.match(String(livekit.livekit_service_url ?? ""), /^https?:\/\//);
    });

    it("sends the call-membership state event and reads it back", { timeout: 30000 }, async () => {
        const { driver, client, roomId, userId } = await setup();
        const stateKey = `_${userId}_${client.getDeviceId() ?? ""}`;
        const sent = await driver.sendEvent(CALL_MEMBER, { "m.call.intent": "audio", foci_preferred: [], device_id: "D", expires: 60000 }, stateKey, roomId);
        assert.match(sent.eventId, /^\$/);
        const state = (await client.getStateEvent(roomId, CALL_MEMBER, stateKey)) as { device_id: string };
        assert.equal(state.device_id, "D");
    });

    it("schedules a delayed leave, restarts it, and cancels it", { timeout: 30000 }, async () => {
        const { driver, roomId, userId, client } = await setup();
        const stateKey = `_${userId}_${client.getDeviceId() ?? ""}`;
        const { delayId } = await driver.sendDelayedEvent(60000, CALL_MEMBER, {}, stateKey, roomId);
        assert.ok(delayId);
        await driver.restartScheduledDelayedEvent(delayId);
        await driver.cancelScheduledDelayedEvent(delayId);
        // A cancelled delayed event no longer exists, so acting on it fails.
        await assert.rejects(driver.restartScheduledDelayedEvent(delayId));
    });

    it("lets a delayed leave fire on demand", { timeout: 30000 }, async () => {
        const { driver, roomId, userId, client } = await setup();
        const stateKey = `_${userId}_${client.getDeviceId() ?? ""}`;
        await driver.sendEvent(CALL_MEMBER, { device_id: "D" }, stateKey, roomId);
        const { delayId } = await driver.sendDelayedEvent(60000, CALL_MEMBER, {}, stateKey, roomId);
        await driver.sendScheduledDelayedEvent(delayId);
        const state = (await client.getStateEvent(roomId, CALL_MEMBER, stateKey)) as Record<string, unknown>;
        assert.deepEqual(state, {}, "the leave (empty content) replaced the membership");
    });

    it("sends a sticky event (MSC4354) the server accepts", { timeout: 30000 }, async () => {
        const { driver, roomId } = await setup();
        const sent = await driver.sendStickyEvent(30000, "org.matrix.msc4143.rtc.member", { sticky_key: "k", application: { type: "m.call" } }, roomId);
        assert.match(sent.eventId, /^\$/);
    });

    it("delivers an unencrypted to-device message to the target device", { timeout: 30000 }, async () => {
        const a = await setup();
        const b = await register(`rtc-b-${Date.now().toString(36)}`);
        await a.driver.sendToDevice("io.element.call.keys", false, { [b.userId]: { [b.client.getDeviceId() ?? ""]: { hello: "world" } } });
        // Read it straight from /sync: no sync loop is running on this client.
        const deadline = Date.now() + 15000;
        for (;;) {
            const res = await fetch(`${BASE}/_matrix/client/v3/sync?timeout=1000`, { headers: { Authorization: `Bearer ${b.client.getAccessToken()}` } });
            const { to_device } = (await res.json()) as { to_device?: { events?: { type: string; content: unknown }[] } };
            const hit = to_device?.events?.find((e) => e.type === "io.element.call.keys");
            if (hit) return assert.deepEqual(hit.content, { hello: "world" });
            assert.ok(Date.now() < deadline, "to-device message never arrived");
        }
    });
});

describe("LiveKit token exchange", { skip: process.env["TEST_RTC_TOKEN"] !== "1" && "set TEST_RTC_TOKEN=1 once lk-jwt-service can reach the homeserver" }, () => {
    it("mints a JWT for a member of the room", { timeout: 30000 }, async () => {
        const { driver, roomId } = await setup();
        const { rtc_transports: transports } = await driver.getRtcTransports();
        const url = transports[0]?.livekit_service_url;
        assert.ok(url, "no transport advertised");
        // matrix-js-sdk 45 / matrix-widget-api 1.20 shape: the member by `member_id`.
        const { jwt } = await driver.getRtcLivekitToken({
            server_name: "localhost",
            url: "ws://localhost:7880",
            room_id: roomId,
            slot_id: "m.call#ROOM",
            member_id: "m1",
        });
        // A LiveKit access token is a JWT: three base64url segments.
        assert.match(jwt, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    });
});
