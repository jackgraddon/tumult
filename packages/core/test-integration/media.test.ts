import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "matrix-js-sdk";

import { MediaResolver } from "../src/media/resolver.ts";
import { isTerminalMediaError } from "../src/media/classify.ts";
import { TimelineFeed } from "../src/timeline/feed.ts";
import { snapshotRooms } from "../src/rooms/snapshot.ts";
import { sendMediaMessage } from "../src/rooms/media.ts";

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

    it("carries sender profiles on messages and a DM's fallback avatar", { timeout: 120000 }, async () => {
        const sfx = Date.now().toString(36);
        const alice = await register(`upa-${sfx}`);
        const bob = await register(`upb-${sfx}`);
        const call = async (method: string, path: string, token: string, body?: unknown) => {
            const res = await fetch(`${BASE}${path}`, {
                method,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            assert.ok(res.ok, `${method} ${path} -> ${res.status} ${await res.clone().text()}`);
            return (await res.json()) as Record<string, string>;
        };
        const up = await fetch(`${BASE}/_matrix/media/v3/upload?filename=b.png`, {
            method: "POST",
            headers: { "Content-Type": "image/png", Authorization: `Bearer ${bob.token}` },
            body: PNG,
        });
        const bobAvatar = ((await up.json()) as Record<string, string>)["content_uri"] as string;
        const enc = encodeURIComponent;
        await call("PUT", `/_matrix/client/v3/profile/${enc(bob.userId)}/displayname`, bob.token, { displayname: "Bob Builder" });
        await call("PUT", `/_matrix/client/v3/profile/${enc(bob.userId)}/avatar_url`, bob.token, { avatar_url: bobAvatar });

        // A 1:1 with no room avatar: the DM should borrow Bob's.
        const room = (await call("POST", "/_matrix/client/v3/createRoom", alice.token, { is_direct: true, invite: [bob.userId] }))["room_id"] as string;
        await call("POST", `/_matrix/client/v3/join/${enc(room)}`, bob.token, {});
        await call("PUT", `/_matrix/client/v3/rooms/${enc(room)}/send/m.room.message/t${sfx}`, bob.token, { msgtype: "m.text", body: "hi from bob" });

        const client = createClient({ baseUrl: BASE, userId: alice.userId, accessToken: alice.token });
        await client.startClient({ initialSyncLimit: 10 });
        const feed = new TimelineFeed(client);
        try {
            const timeline = feed.timeline(room);
            const deadline = Date.now() + 60000;
            while (!timeline.get().some((m) => m.body === "hi from bob") && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 300));
            }
            const msg = timeline.get().find((m) => m.body === "hi from bob");
            assert.equal(msg?.senderName, "Bob Builder");
            assert.equal(msg?.senderAvatarUrl, bobAvatar);

            const summary = snapshotRooms(client).find((r) => r.id === room);
            assert.equal(summary?.avatarUrl, bobAvatar);
        } finally {
            feed.detachAll();
            client.stopClient();
        }
    });

    it("sends an image message with upload and local echo", { timeout: 120000 }, async () => {
        const sfx = Date.now().toString(36);
        const alice = await register(`sma-${sfx}`);
        const bob = await register(`smb-${sfx}`);
        const roomRes = await fetch(`${BASE}/_matrix/client/v3/createRoom`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${alice.token}` },
            body: JSON.stringify({ invite: [bob.userId] }),
        });
        const room = ((await roomRes.json()) as Record<string, string>)["room_id"] as string;
        await fetch(`${BASE}/_matrix/client/v3/join/${encodeURIComponent(room)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${bob.token}` },
            body: "{}",
        });

        const client = createClient({ baseUrl: BASE, userId: alice.userId, accessToken: alice.token });
        await client.startClient({ initialSyncLimit: 10 });
        const feed = new TimelineFeed(client);
        try {
            const file = new File([PNG], "test.png", { type: "image/png" });
            await sendMediaMessage(client, room, file, "test image");

            const timeline = feed.timeline(room);
            const deadline = Date.now() + 60_000;
            while (!timeline.get().some((m) => m.content["url"]?.startsWith("mxc://")) && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 300));
            }
            const msg = timeline.get().find((m) => m.content["url"]?.startsWith("mxc://"));
            assert.ok(msg, "media message should appear in the timeline");
            assert.equal(msg?.content["msgtype"], "m.image");
            assert.equal(msg?.content["body"], "test image");
            assert.equal(msg?.status, "sent");
        } finally {
            feed.detachAll();
            client.stopClient();
        }
    });

    it("downloads a non-image attachment, which the thumbnailer refuses", { timeout: 120000 }, async () => {
        const user = await register(`dma-${Date.now().toString(36)}`);
        const upload = await fetch(`${BASE}/_matrix/media/v3/upload?filename=notes.txt`, {
            method: "POST",
            headers: { "Content-Type": "text/plain", Authorization: `Bearer ${user.token}` },
            body: "download me",
        });
        assert.equal(upload.status, 200, await upload.clone().text());
        const mxc = ((await upload.json()) as Record<string, string>)["content_uri"] as string;

        const client = createClient({ baseUrl: BASE, userId: user.userId, accessToken: user.token });
        const resolver = new MediaResolver(client);
        try {
            if (!(await client.isVersionSupported("v1.11"))) return; // legacy servers have no gate

            // Pins WHY non-image media must not use `resolve()`: the thumbnail
            // endpoint is an image pipeline and 400s on a text file.
            await assert.rejects(() => resolver.resolve(mxc, 256));

            const url = await resolver.resolveDownload(mxc);
            assert.ok(url.startsWith("blob:"), `expected a blob URL, got ${url}`);
            assert.equal(await (await fetch(url)).text(), "download me");
        } finally {
            resolver.dispose();
        }
    });

    it("reports purged media as a terminal failure, without re-fetching", { timeout: 120000 }, async () => {
        const user = await register(`dm-${Date.now().toString(36)}`);
        const client = createClient({ baseUrl: BASE, userId: user.userId, accessToken: user.token });
        const resolver = new MediaResolver(client);
        try {
            if (!(await client.isVersionSupported("v1.11"))) return;
            const gone = `mxc://${new URL(BASE).host}/does-not-exist-${Date.now().toString(36)}`;

            const first = await resolver.resolveDownload(gone).then(
                () => null,
                (error: unknown) => error,
            );
            assert.ok(first, "expected a rejection");
            assert.equal(isTerminalMediaError(first), true, `not terminal: ${String(first)}`);

            // The negative cache hands back the SAME stored error, so a later
            // render cannot re-hit the network for a URI the server already
            // said is gone.
            const second = await resolver.resolveDownload(gone).then(
                () => null,
                (error: unknown) => error,
            );
            assert.equal(second, first);
        } finally {
            resolver.dispose();
        }
    });
});
