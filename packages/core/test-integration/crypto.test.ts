import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";
import { EventType, MsgType, ClientEvent, SyncState } from "matrix-js-sdk";

const BASE = process.env["TEST_SYNAPSE_URL"] ?? "http://localhost:8008";

interface AuthedUser {
    userId: string;
    token: string;
    deviceId: string;
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
        body: body === undefined ? undefined : JSON.stringify(body),
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
    return {
        userId: res["user_id"] as string,
        token: res["access_token"] as string,
        deviceId: (res["device_id"] as string) ?? body.device_id,
    };
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
    return createClient({
        baseUrl: BASE,
        userId: user.userId,
        accessToken: user.token,
        deviceId: user.deviceId,
    });
}

/** Wait until the client has completed an initial sync. */
function waitForSync(client: MatrixClient): Promise<void> {
    return new Promise((resolve, reject) => {
        const onSync = (state: SyncState) => {
            if (state === SyncState.Syncing || state === SyncState.Prepared) {
                client.off(ClientEvent.Sync, onSync);
                resolve();
            }
        };
        client.on(ClientEvent.Sync, onSync);
        if (client.getSyncState() === SyncState.Syncing || client.getSyncState() === SyncState.Prepared) {
            client.off(ClientEvent.Sync, onSync);
            resolve();
        }
        // Guard against never-syncing.
        setTimeout(() => {
            client.off(ClientEvent.Sync, onSync);
            if (client.getSyncState()) resolve();
            else reject(new Error("client never reached syncing"));
        }, 30_000).unref?.();
    });
}

describe("end-to-end E2EE roundtrip against real Synapse", { timeout: 240000 }, () => {
    it("sends and decrypts an encrypted message between two clients", async () => {
        const suffix = Date.now().toString(36);
        const alice = await register(`calice-${suffix}`, "testtesttest");
        const bob = await register(`cbob-${suffix}`, "testtesttest");

        const aliceClient = clientFor(alice);
        const bobClient = clientFor(bob);

        try {
            // Rust crypto, memory-backed (Node has no IndexedDB).
            await aliceClient.initRustCrypto({ useIndexedDB: false });
            await bobClient.initRustCrypto({ useIndexedDB: false });

            await aliceClient.startClient({ initialSyncLimit: 10 });
            await bobClient.startClient({ initialSyncLimit: 10 });
            await waitForSync(aliceClient);
            await waitForSync(bobClient);

            // Alice creates an encrypted room and invites Bob.
            const room = await aliceClient.createRoom({
                name: "crypto-roundtrip",
                visibility: "private",
                initial_state: [
                    {
                        type: EventType.RoomEncryption,
                        state_key: "",
                        content: { algorithm: "m.megolm.v1.aes-sha2" },
                    },
                ],
            });
            const roomId = (room as any).room_id ?? (room as any);
            await aliceClient.invite(roomId, bob.userId!);

            // Bob accepts and both wait for the room + device keys to circulate.
            await waitFor("Bob's invite", () => Boolean(bobClient.getRoom(roomId)?.getMyMembership() === "invite"));
            await bobClient.joinRoom(roomId);
            await waitFor("Bob joined", () => bobClient.getRoom(roomId)?.getMyMembership() === "join");
            await waitFor("Alice sees Bob joined", () => aliceClient.getRoom(roomId)?.getMyMembership() === "join");

            // Give to-device room-key sharing a moment to land.
            await waitFor(
                "Bob's device keys",
                async () => {
                    const room = bobClient.getRoom(roomId);
                    return Boolean(room);
                },
                30_000,
            );
            await new Promise((r) => setTimeout(r, 3000));

            const body = `hello encrypted ${suffix}`;
            await aliceClient.sendTextMessage(roomId, body);

            const bobRoom = bobClient.getRoom(roomId);
            assert.ok(bobRoom, "Bob should see the room");

            await waitFor("Bob to decrypt Alice's message", () => {
                const events = bobRoom.getLiveTimeline().getEvents();
                return events.some(
                    (e) =>
                        e.getType() === EventType.RoomMessage &&
                        e.getContent()?.msgtype === MsgType.Text &&
                        e.getContent()?.body === body,
                );
            }, 60_000);

            const textEvent = bobRoom
                .getLiveTimeline()
                .getEvents()
                .find(
                    (e) =>
                        e.getType() === EventType.RoomMessage &&
                        e.getContent()?.msgtype === MsgType.Text &&
                        e.getContent()?.body === body,
                );
            assert.ok(textEvent, "Bob should have decrypted the message");
            assert.equal(textEvent.getContent().body, body);
            // The wire event is encrypted; the decrypted view carries the body.
            assert.equal(textEvent.isEncrypted(), true, "the message should be an encrypted event");

            // Sanity: Alice's own echoed copy is also encrypted on the wire.
            const aliceRoom = aliceClient.getRoom(roomId);
            const aliceEvent = aliceRoom
                ?.getLiveTimeline()
                .getEvents()
                .find((e) => e.getId() === textEvent.getId());
            assert.ok(aliceEvent, "Alice should see her own message");
            assert.equal(aliceEvent.isEncrypted(), true);
        } finally {
            aliceClient.stopClient();
            bobClient.stopClient();
        }
    });
});
