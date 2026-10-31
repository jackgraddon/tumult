import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { NotificationTracker } from "../src/notifications/tracker.ts";

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

async function waitFor(label: string, cond: () => boolean, timeoutMs = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (cond()) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await new Promise((r) => setTimeout(r, 500));
    }
}

/** Minimal Notification stub that records constructions. */
class TestNotification {
    public static permission = "granted";
    public static instances: { title: string; body: string; tag: string | undefined }[] = [];
    public static requestPermission(): Promise<string> {
        return Promise.resolve("granted");
    }
    constructor(title: string, options: { body?: string; tag?: string } = {}) {
        TestNotification.instances.push({ title, body: options.body ?? "", tag: options.tag });
    }
    static reset(): void {
        TestNotification.instances = [];
    }
}

/** Minimal window stub with fireable focus/blur. */
function installTestGlobals(): { fire(type: "focus" | "blur"): void; restore(): void } {
    const g = globalThis as Record<string, unknown>;
    const prevNotification = g["Notification"];
    const prevWindow = g["window"];
    g["Notification"] = TestNotification;
    const listeners = new Map<string, Set<() => void>>();
    g["window"] = {
        addEventListener(type: string, fn: () => void) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)?.add(fn);
        },
        removeEventListener(type: string, fn: () => void) {
            listeners.get(type)?.delete(fn);
        },
    };
    return {
        fire(type) {
            for (const fn of listeners.get(type) ?? []) fn();
        },
        restore() {
            g["Notification"] = prevNotification;
            g["window"] = prevWindow;
        },
    };
}

describe("notifications against real Synapse", () => {
    it("fires a browser notification for a new message while blurred", { timeout: 120000 }, async () => {
        const env = installTestGlobals();
        TestNotification.reset();
        try {
            const suffix = Date.now().toString(36);
            const alice = await register(`nalice-${suffix}`, "testtesttest");
            const bob = await register(`nbob-${suffix}`, "testtesttest");

            const roomId = (await api("POST", "/_matrix/client/v3/createRoom", alice.token, {
                name: "notif-room",
            }))["room_id"] as string;
            await api(
                "POST",
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
                alice.token,
                { user_id: bob.userId },
            );
            await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, bob.token, {});

            const client: MatrixClient = createClient({ baseUrl: BASE });
            await client.loginWithPassword(alice.userId, "testtesttest");
            await client.startClient({ initialSyncLimit: 10 });
            const tracker = new NotificationTracker(client);
            try {
                // Wait for the tracker to attach to the room.
                await waitFor("tracker to attach", () => {
                    const rooms = client.getRooms();
                    return rooms.some((r) => r.roomId === roomId);
                });
                // Force blur so notifications fire.
                env.fire("blur");

                // Bob sends a message via the raw API (his own client).
                await api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/notif-${suffix}`, bob.token, {
                    msgtype: "m.text",
                    body: "hello from bob",
                });

                await waitFor("notification to fire", () => TestNotification.instances.length >= 1);
                const notif = TestNotification.instances[0];
                assert.ok(notif);
                assert.equal(notif.title, bob.userId);
                assert.equal(notif.body, "hello from bob");
                assert.equal(notif.tag, roomId);
            } finally {
                tracker.detachAll();
                client.stopClient();
            }
        } finally {
            env.restore();
        }
    });
});
