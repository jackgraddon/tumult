import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { MembersTracker } from "../src/rooms/members.ts";
import { banMember, kickMember, PowerLevelsTracker, setMemberPowerLevel, unbanMember } from "../src/rooms/moderation.ts";

const BASE = process.env["TEST_SYNAPSE_URL"] ?? "http://localhost:8008";

interface AuthedUser {
    userId: string;
    token: string;
}

async function api(
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
): Promise<Record<string, unknown>> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? null : JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as Record<string, unknown>;
}

async function register(username: string, password: string): Promise<AuthedUser> {
    const body = {
        username,
        password,
        device_id: `TEST-${username.toUpperCase()}`,
        initial_device_display_name: "integration test",
    };
    const first = await fetch(`${BASE}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (first.status !== 401) {
        throw new Error(`register step 1 -> ${first.status}: ${await first.text()}`);
    }
    const session = ((await first.json()) as Record<string, unknown>)["session"];
    const res = await api("POST", "/_matrix/client/v3/register", null, {
        ...body,
        auth: { type: "m.login.dummy", session },
    });
    return { userId: res["user_id"] as string, token: res["access_token"] as string };
}

async function waitFor(
    label: string,
    cond: () => boolean | Promise<boolean>,
    timeoutMs = 60000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await cond()) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await new Promise((r) => setTimeout(r, 500));
    }
}

function clientFor(user: AuthedUser): MatrixClient {
    return createClient({ baseUrl: BASE, userId: user.userId, accessToken: user.token });
}

/** Create a room as `owner`, invite each joiner, and have every one join. */
async function sharedRoom(owner: AuthedUser, joiners: AuthedUser[]): Promise<string> {
    const roomId = (await api("POST", "/_matrix/client/v3/createRoom", owner.token, {
        name: "moderation fixture",
    }))["room_id"] as string;
    for (const user of joiners) {
        await api("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, owner.token, {
            user_id: user.userId,
        });
    }
    for (const user of joiners) {
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, user.token, {});
    }
    return roomId;
}

describe("moderation against real Synapse", () => {
    it("power levels, kick, ban and unban round-trip through the room feeds", { timeout: 240000 }, async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`kad-${suffix}`, "testtesttest");
        const bob = await register(`kbd-${suffix}`, "testtesttest");
        const carol = await register(`kcd-${suffix}`, "testtesttest");

        const roomId = await sharedRoom(alice, [bob, carol]);
        const client = clientFor(alice);
        await client.startClient({ initialSyncLimit: 10 });
        const members = new MembersTracker(client);
        const power = new PowerLevelsTracker(client);
        try {
            await waitFor("alice to see the room", () => client.getRoom(roomId) !== null);
            await members.loadMembers(roomId);

            // Creator owns the room: every threshold clears, spec defaults apply.
            const view = power.powerLevels(roomId);
            assert.equal(view, power.powerLevels(roomId), "same observable per room");
            assert.ok(view.get(), "power levels exist once the room is known");
            assert.equal(view.get()?.myPowerLevel, 100);
            assert.equal(view.get()?.canKick, true);
            assert.equal(view.get()?.canBan, true);
            assert.equal(view.get()?.canEditSettings, true);
            assert.equal(view.get()?.kick, 50, "spec default when the room overrides nothing");

            // Promote carol: the users override must reach both the power feed
            // and her roster row.
            await setMemberPowerLevel(client, roomId, carol.userId, 50);
            await waitFor("carol's promotion to land", () => view.get()?.users[carol.userId] === 50);
            await waitFor("carol's roster row to show 50", () =>
                members.members(roomId).get().find((m) => m.userId === carol.userId)?.powerLevel === 50,
            );

            // Kick carol with a reason: she leaves the roster (membership is
            // no longer join/invite) but is NOT banned.
            await kickMember(client, roomId, carol.userId, "spam");
            await waitFor("carol to drop off the roster", () =>
                !members.members(roomId).get().some((m) => m.userId === carol.userId),
            );
            assert.ok(
                !members.banned(roomId).get().some((m) => m.userId === carol.userId),
                "a kick is not a ban",
            );

            // Ban bob: he leaves the roster AND shows up in the banned feed.
            await banMember(client, roomId, bob.userId, "repeated spam");
            await waitFor("bob to drop off the roster", () =>
                !members.members(roomId).get().some((m) => m.userId === bob.userId),
            );
            await waitFor("bob to appear in the banned feed", () =>
                members.banned(roomId).get().some((m) => m.userId === bob.userId && m.membership === "ban"),
            );

            // Unban: membership returns to leave, so he drops off banned but
            // does NOT reappear in the roster until he rejoins.
            await unbanMember(client, roomId, bob.userId);
            await waitFor("bob to drop off the banned feed", () =>
                !members.banned(roomId).get().some((m) => m.userId === bob.userId),
            );
            assert.ok(
                !members.members(roomId).get().some((m) => m.userId === bob.userId),
                "an unbanned user stays out of the roster until they rejoin",
            );
        } finally {
            members.detachAll();
            power.detachAll();
            client.stopClient();
        }
    });
});
