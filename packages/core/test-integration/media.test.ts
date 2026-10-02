import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "matrix-js-sdk";

import { MediaResolver } from "../src/media/resolver.ts";

const BASE = process.env["TEST_SYNAPSE_URL"] ?? "http://localhost:8008";

// 4x4 opaque red PNG — real image bytes, so Synapse's thumbnailer accepts it.
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC",
    "base64",
);

async function register(username: string): Promise<{ userId: string; token: string }> {
    const body = { username, password: "testtesttest" };
    const first = await fetch(`${BASE}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const session = ((await first.json()) as Record<string, unknown>)["session"];
    const res = await fetch(`${BASE}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, auth: { type: "m.login.dummy", session } }),
    });
    const json = (await res.json()) as Record<string, string>;
    return { userId: json["user_id"] as string, token: json["access_token"] as string };
}

describe("media against real Synapse", () => {
    it("resolves an uploaded avatar through authenticated media", { timeout: 120000 }, async () => {
        const user = await register(`umedia-${Date.now().toString(36)}`);
        const upload = await fetch(`${BASE}/_matrix/media/v3/upload?filename=a.png`, {
            method: "POST",
            headers: { "Content-Type": "image/png", Authorization: `Bearer ${user.token}` },
            body: PNG,
        });
        assert.equal(upload.status, 200, await upload.clone().text());
        const mxc = ((await upload.json()) as Record<string, string>)["content_uri"] as string;
        assert.ok(mxc.startsWith("mxc://"));

        const client = createClient({ baseUrl: BASE, userId: user.userId, accessToken: user.token });
        const resolver = new MediaResolver(client);
        try {
            const v111 = await client.isVersionSupported("v1.11");
            const url = await resolver.resolve(mxc, 48);
            if (v111) {
                assert.ok(url.startsWith("blob:"), `expected a blob URL, got ${url}`);
                const blob = await (await fetch(url)).blob();
                assert.ok(blob.size > 0);
                assert.match(blob.type, /^image\//);

                // And the authenticated endpoint really demands the token —
                // the reason <img src> can't do this alone.
                const [, server, id] = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxc) ?? [];
                const anon = await fetch(`${BASE}/_matrix/client/v1/media/thumbnail/${server}/${id}?width=48&height=48`);
                assert.equal(anon.status, 401);
            } else {
                assert.ok(url.startsWith("http"), `legacy fallback expected, got ${url}`);
            }
        } finally {
            resolver.dispose();
        }
    });
});
