import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type MatrixClient } from "matrix-js-sdk";

import { AuthStorage, type StoredSession } from "../src/auth/storage.ts";
import { OwnActivityController } from "../src/activity/own-activity-controller.ts";
import type { ClientContext } from "../src/client-context.ts";

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
        body: body === undefined ? null : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
}

async function register(username: string, password: string): Promise<AuthedUser> {
    const body = {
        username,
        password,
        device_id: `ACTIVITY-A-${username}`,
        initial_device_display_name: "activity integration test",
    };
    const first = await fetch(`${BASE}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (first.status !== 401) throw new Error(`register step 1 -> ${first.status}: ${await first.text()}`);
    const session = ((await first.json()) as Record<string, unknown>)["session"];
    const res = await api("POST", "/_matrix/client/v3/register", null, {
        ...body,
        auth: { type: "m.login.dummy", session },
    });
    return {
        userId: res["user_id"] as string,
        token: res["access_token"] as string,
        deviceId: res["device_id"] as string,
    };
}

/** A second device on the SAME account — the cross-device path under test. */
async function loginAgain(username: string, password: string): Promise<AuthedUser> {
    const res = await api("POST", "/_matrix/client/v3/login", null, {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: username },
        password,
        device_id: `ACTIVITY-B-${username}`,
    });
    return {
        userId: res["user_id"] as string,
        token: res["access_token"] as string,
        deviceId: res["device_id"] as string,
    };
}

function context(matrix: MatrixClient, user: AuthedUser): ClientContext {
    const data = new Map<string, string>();
    return {
        storage: new AuthStorage({
            getItem: (key) => data.get(key) ?? null,
            setItem: (key, value) => void data.set(key, value),
            removeItem: (key) => void data.delete(key),
        }),
        matrix: () => matrix,
        session: () => ({ ...user, homeserverUrl: BASE, clientId: "test", accessToken: user.token }) as StoredSession,
        selectedRoomId: () => null,
    };
}

function clientFor(user: AuthedUser): MatrixClient {
    return createClient({ baseUrl: BASE, userId: user.userId, accessToken: user.token, deviceId: user.deviceId });
}

async function waitFor(label: string, cond: () => boolean, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (cond()) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

describe("own activity account data", () => {
    it("delivers a document and an explicit clear to a second device on the same account", async () => {
        const username = `activity${Date.now()}`;
        const password = "integration-password";
        const a = await register(username, password);
        const b = await loginAgain(username, password);
        const matrixA = clientFor(a);
        const matrixB = clientFor(b);
        const ctlA = new OwnActivityController(context(matrixA, a));
        const ctlB = new OwnActivityController(context(matrixB, b));
        try {
            await matrixA.startClient({ initialSyncLimit: 1 });
            await matrixB.startClient({ initialSyncLimit: 1 });
            ctlA.start(matrixA);
            ctlB.start(matrixB);

            await ctlA.set({ v: 1, type: "listening", name: "Synced album" });
            await waitFor("device B to see the document", () => {
                const value = ctlB.feed.get()?.document as { name?: string } | null | undefined;
                return value?.name === "Synced album";
            });
            assert.equal(ctlB.feed.get()?.deviceId, a.deviceId);

            await ctlA.set(null);
            await waitFor("device B to see the explicit clear", () => {
                const view = ctlB.feed.get();
                return view !== null && view.document === null;
            });
        } finally {
            ctlA.stop();
            ctlB.stop();
            await matrixA.stopClient();
            await matrixB.stopClient();
        }
    });
});
