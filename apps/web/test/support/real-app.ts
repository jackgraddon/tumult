/**
 * Shared harness for the browser tests that drive the REAL client against a
 * real homeserver (the stack in `tests/rtc/`, started by tests/rtc/run.sh):
 * rtc-media.test.ts (calls) and e2ee.test.ts (verification and recovery).
 *
 * The app is built once per test file with the real client, and each "device"
 * is a browser context with an injected session. Login is MAS-only, so the
 * session comes from a password registration or login against the test
 * Synapse, written to `tumult.session` before any app script runs — the shape
 * `AuthStorage` reads (packages/core/src/auth/storage.ts).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Browser, BrowserContext, Page } from "playwright";
import { build, preview } from "vite";

import { createDm } from "../../../../packages/core/src/rooms/lifecycle.ts";

export const BASE = process.env["TEST_SYNAPSE_URL"] ?? "http://127.0.0.1:8018";
/** Every test using this harness needs the stack; tests/rtc/run.sh sets it. */
export const enabled = process.env["TEST_RTC"] === "1";
export const PASSWORD = "testtesttest";

const here = dirname(fileURLToPath(import.meta.url));
export const appRoot = join(here, "..", "..");

export interface Account {
    userId: string;
    deviceId: string;
    accessToken: string;
}

export async function api<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    assert.ok(res.ok, `${method} ${path} → ${res.status}: ${text}`);
    return JSON.parse(text) as T;
}

/** A new account and its first device. */
export async function register(username: string): Promise<Account> {
    const body = { username, password: PASSWORD };
    const first = await fetch(`${BASE}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const session = ((await first.json()) as { session: string }).session;
    const out = await api<{ user_id: string; device_id: string; access_token: string }>("POST", "/_matrix/client/v3/register", null, {
        ...body,
        auth: { type: "m.login.dummy", session },
    });
    return { userId: out.user_id, deviceId: out.device_id, accessToken: out.access_token };
}

/** Another device for an existing account: what signing in on a new machine is. */
export async function login(userId: string): Promise<Account> {
    const out = await api<{ user_id: string; device_id: string; access_token: string }>("POST", "/_matrix/client/v3/login", null, {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: userId },
        password: PASSWORD,
    });
    return { userId: out.user_id, deviceId: out.device_id, accessToken: out.access_token };
}

/**
 * A DM made by Tumult's own `createDm` — the code behind "new DM" — so a test
 * runs in the room the app really creates (encrypted, calls open to members).
 * matrix-js-sdk is core's dependency, not this app's (pnpm does not hoist), so
 * it is resolved from core: the same copy lifecycle.ts imports.
 */
export async function createDmAs(creator: Account, otherUserId: string): Promise<string> {
    const coreRoot = join(here, "..", "..", "..", "..", "packages", "core");
    const sdk = (await import(pathToFileURL(createRequire(join(coreRoot, "package.json")).resolve("matrix-js-sdk")).href)) as {
        createClient: (opts: { baseUrl: string; userId: string; accessToken: string; deviceId: string }) => unknown;
    };
    const client = sdk.createClient({ baseUrl: BASE, userId: creator.userId, accessToken: creator.accessToken, deviceId: creator.deviceId });
    return createDm(client as Parameters<typeof createDm>[0], { userId: otherUserId, encrypted: true });
}

export interface RealApp {
    origin: string;
    close(): Promise<void>;
}

/**
 * Build the real client and serve it. The client URI is only used by the OIDC
 * login these tests skip, but the build refuses to run without one.
 */
export async function serveRealApp(options: { port: number; voice?: boolean; env?: Record<string, string> }): Promise<RealApp> {
    const workDir = mkdtempSync(join(tmpdir(), "tumult-real-app-"));
    const outDir = join(workDir, "dist");
    if (options.voice) process.env["VITE_VOICE"] = "1";
    // Build-time env (e.g. VITE_ELEMENT_CALL_URL). Each test file is its own
    // process, so this does not leak into another file's build.
    for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value;
    process.env["VITE_CLIENT_URI"] ??= "https://tumult.test";
    await build({ root: appRoot, mode: "production", logLevel: "error", build: { outDir } });
    const server = await preview({
        root: appRoot,
        mode: "production",
        logLevel: "error",
        build: { outDir },
        preview: { host: "127.0.0.1", port: options.port, strictPort: true },
    });
    return {
        origin: `http://127.0.0.1:${options.port}`,
        async close() {
            await server.close();
            rmSync(workDir, { recursive: true, force: true });
        },
    };
}

export interface Device {
    name: string;
    account: Account;
    context: BrowserContext;
    page: Page;
    logs: string[];
}

/**
 * A browser context signed in as `account`. `initScript` runs before any app
 * script too, after the session is written — a plain string, because tsx
 * wraps named functions in `__name()`, which does not exist in the page.
 */
export async function openDevice(
    browser: Browser,
    name: string,
    account: Account,
    options: { initScript?: string; permissions?: string[]; origin?: string } = {},
): Promise<Device> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (options.permissions && options.origin) await context.grantPermissions(options.permissions, { origin: options.origin });
    const session = {
        homeserverUrl: BASE,
        userId: account.userId,
        deviceId: account.deviceId,
        clientId: "tumult-browser-test",
        accessToken: account.accessToken,
    };
    await context.addInitScript({
        content: `localStorage.setItem("tumult.session", ${JSON.stringify(JSON.stringify(session))});\n${options.initScript ?? ""}`,
    });
    const page = await context.newPage();
    const logs: string[] = [];
    page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
    return { name, account, context, page, logs };
}

/** Screenshots and console logs for a failed run, under apps/web/test-results/<suite>/. */
export async function saveArtifacts(suite: string, devices: readonly Device[]): Promise<void> {
    const dir = join(appRoot, "test-results", suite);
    mkdirSync(dir, { recursive: true });
    for (const d of devices) {
        await d.page.screenshot({ path: join(dir, `${d.name}.png`) }).catch(() => {});
        writeFileSync(join(dir, `${d.name}.console.log`), d.logs.join("\n"));
    }
}

/** Re-read until `done` holds, failing with the last reading so a timeout says what was seen. */
export async function poll<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last = await read();
    while (!done(last)) {
        assert.ok(Date.now() < deadline, `${label}; last reading: ${JSON.stringify(last)}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        last = await read();
    }
    return last;
}
