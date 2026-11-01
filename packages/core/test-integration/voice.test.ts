import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { discoverFoci, getSfuConfig } from "../src/voice/sfu.ts";

/**
 * Native voice's server half against the real MatrixRTC stack (`tests/rtc/`):
 * the same `discoverFoci` → `getSfuConfig` calls `VoiceManager.join()` makes,
 * with nothing stubbed. Fails fast and by name when the token exchange is what
 * is broken, before the two-browser media test (apps/web/test/rtc-media.test.ts)
 * spends a minute discovering the same thing as "no audio arrived".
 *
 * Skips unless `TEST_RTC=1` (set by tests/rtc/run.sh).
 */
const BASE = process.env["TEST_SYNAPSE_URL"] ?? "http://127.0.0.1:8018";
const enabled = process.env["TEST_RTC"] === "1";

async function register(username: string): Promise<MatrixClient> {
    const body = { username, password: "testtesttest", device_id: `VOICE-${username.toUpperCase()}` };
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
    return createClient({ baseUrl: BASE, userId: out.user_id, accessToken: out.access_token, deviceId: out.device_id });
}

describe("native voice token exchange against a real MatrixRTC stack", { skip: !enabled && "set TEST_RTC=1 (tests/rtc/run.sh)" }, () => {
    it("discovers the LiveKit focus from the homeserver", async () => {
        const client = await register(`voice-${Date.now().toString(36)}`);
        const { foci, attempts } = await discoverFoci(client);
        assert.ok(foci.length > 0, `no focus discovered: ${JSON.stringify(attempts)}`);
        assert.equal(foci[0]?.livekit_service_url, "http://127.0.0.1:8090");
    });

    it("trades an OpenID token for the SFU url and a LiveKit JWT", { timeout: 30000 }, async () => {
        const client = await register(`voice-${Date.now().toString(36)}-b`);
        const { room_id: roomId } = await client.createRoom({ name: "voice room" });
        const { foci } = await discoverFoci(client);
        const serviceUrl = foci[0]?.livekit_service_url;
        assert.ok(serviceUrl, "no focus to ask");
        // This is the round trip that needs lk-jwt-service to reach Synapse's
        // federation listener (OpenID userinfo); a failure names the service's
        // answer, which says which half broke.
        const sfu = await getSfuConfig(client, serviceUrl, roomId, client.getDeviceId() ?? "");
        assert.equal(sfu.url, "ws://127.0.0.1:7880", "the SFU url the service hands browsers");
        assert.match(sfu.jwt, /^[\w-]+\.[\w-]+\.[\w-]+$/, "a LiveKit access token is a JWT");
        const claims = JSON.parse(Buffer.from(sfu.jwt.split(".")[1] ?? "", "base64url").toString()) as {
            sub?: string;
            video?: { room?: string; roomJoin?: boolean };
        };
        // Compatibility-mode identity: `<user_id>:<device_id>`, the scheme the
        // SFU uses to tell members apart (see sfu.ts).
        assert.equal(claims.sub, `${client.getUserId()}:${client.getDeviceId()}`);
        assert.equal(claims.video?.roomJoin, true);
    });
});
