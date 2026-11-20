/**
 * Desktop smoke test: the real Electron main process (`dist/main.cjs`) serving
 * a FAKE-mode desktop web build (`web-fake/`, built with `VITE_DESKTOP=1
 * --mode fake`) — no homeserver, no network beyond a loopback fake IdP.
 *
 * What it proves that unit tests cannot: the app:// scheme really serves the
 * build with vercel.json's headers, the meta CSP holds under app:// (no
 * violations, no console errors), the plugin sandbox frame boots opaque, a
 * native push (and a Discord-style IPC `SET_ACTIVITY`) travels through the
 * shell-owned activity surface into the user bar (even with the released Rich
 * Presence plugin installed), a Settings click runs a real update check through
 * the updater bridge against a loopback feed, native activity outranks a manual
 * one and its draft returns on clear, the navigation guard keeps the window on app:// and
 * hands http(s) to the OS, the permission handlers deny what they should, and
 * the MAS redirect is caught before the network and replayed into the app's
 * callback route.
 *
 * Run: `pnpm --filter @tumult/desktop test:smoke` (its `pretest:smoke` builds
 * core, theme, the fake web build and the main process). Linux CI runs it under
 * xvfb.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { ElectronApplication, Page } from "playwright";
import { _electron as electron } from "playwright";

import { DISCORD_OP, DiscordFrameFramer, encodeDiscordFrame } from "../src/discord-ipc.ts";
import type { DiscordFrame } from "../src/discord-ipc.ts";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const electronPath = require("electron") as unknown as string;

const SESSION = {
    homeserverUrl: "https://fake.invalid",
    userId: "@self:fake.invalid",
    deviceId: "FAKEDESKTOPTEST",
    clientId: "fake-desktop-test",
    accessToken: "fake-token",
};

const vercel = JSON.parse(readFileSync(join(appRoot, "..", "web", "vercel.json"), "utf8")) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
};
const SANDBOX_CSP = vercel.headers.find((r) => r.source === "/sandbox.html")?.headers.find((h) => h.key === "Content-Security-Policy")?.value;

describe("desktop app (fake mode)", { timeout: 180_000 }, () => {
    let app: ElectronApplication;
    let page: Page;
    let idp: Server;
    let idpOrigin = "";
    // A loopback generic update feed. The real electron-updater checks it in
    // dev (forceDevUpdateConfig + TUMULT_UPDATE_URL), so a UI click exercises
    // the whole bridge rather than a stub pretending an update was found.
    let updateFeed: Server;
    let updateOrigin = "";
    // The loopback port the app's native-activity RPC server binds (the bridge a
    // co-located native app could reach); the test drives it to relay a SET.
    let nativePort = 0;
    const idpHits: string[] = [];
    const userData = mkdtempSync(join(tmpdir(), "tumult-desktop-smoke-"));
    // A dedicated Discord IPC endpoint for this run: a Unix socket in the fresh
    // profile, or a uniquely named pipe on Windows. The app binds exactly this
    // path, so the test can act as a Discord-style producer without touching a
    // real Discord install.
    const discordIpcPath =
        process.platform === "win32"
            ? `\\\\.\\pipe\\tumult-smoke-discord-${randomUUID()}`
            : join(userData, "discord-ipc.sock");
    const consoleErrors: string[] = [];

    before(async () => {
        // A loopback "IdP": /authorize answers like MAS does on consent — a
        // redirect to the registered redirect URI with the code in the fragment.
        // /ping is a stand-in for a homeserver on this machine.
        idp = createServer((req, res) => {
            idpHits.push(req.url ?? "");
            const url = new URL(req.url ?? "/", "http://localhost");
            if (url.pathname === "/authorize") {
                const redirect = url.searchParams.get("redirect_uri") ?? "";
                res.writeHead(303, { Location: `${redirect}#code=smoke-code&state=${url.searchParams.get("state") ?? ""}` });
                res.end();
                return;
            }
            if (url.pathname === "/login-page") {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<!doctype html><title>IdP</title><p>Sign in</p>");
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end('{"ok":true}');
        });
        await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
        idpOrigin = `http://localhost:${(idp.address() as AddressInfo).port}`;

        // `latest-linux.yml` is the channel file electron-updater asks a generic
        // Linux feed for. Only the check is driven here — downloading would
        // replace a real AppImage, which no test should do.
        const updateBytes = Buffer.from("a tiny stand-in for an AppImage");
        const updateSha512 = createHash("sha512").update(updateBytes).digest("base64");
        const updateAsset = "Tumult-99.0.0-x86_64.AppImage";
        const updateYaml = [
            "version: 99.0.0",
            "files:",
            `  - url: ${updateAsset}`,
            `    sha512: ${updateSha512}`,
            `    size: ${updateBytes.length}`,
            `path: ${updateAsset}`,
            `sha512: ${updateSha512}`,
            "releaseDate: '2026-11-20T00:00:00.000Z'",
            "",
        ].join("\n");
        updateFeed = createServer((req, res) => {
            const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
            if (path === "/latest-linux.yml") {
                res.writeHead(200, { "Content-Type": "text/yaml" });
                res.end(updateYaml);
                return;
            }
            if (path === `/${updateAsset}`) {
                res.writeHead(200, { "Content-Type": "application/octet-stream" });
                res.end(updateBytes);
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise<void>((resolve) => updateFeed.listen(0, "127.0.0.1", resolve));
        updateOrigin = `http://127.0.0.1:${(updateFeed.address() as AddressInfo).port}`;

        // A loopback port a co-located native app could reach: the test drives
        // the app's native-activity RPC server through it. A throwaway server
        // picks a free ephemeral port; the app's server binds the same number.
        const prober = createServer();
        await new Promise<void>((resolve) => prober.listen(0, "127.0.0.1", resolve));
        nativePort = (prober.address() as AddressInfo).port;
        await new Promise<void>((resolve, reject) =>
            prober.close((error) => (error ? reject(error) : resolve())),
        );

        app = await electron.launch({
            executablePath: electronPath,
            args: [appRoot],
            env: {
                ...process.env,
                TUMULT_WEB_ROOT: join(appRoot, "web-fake"),
                TUMULT_USER_DATA_DIR: userData,
                TUMULT_NATIVE_ACTIVITY_PORT: String(nativePort),
                TUMULT_DISCORD_IPC_PATH: discordIpcPath,
                TUMULT_UPDATE_URL: `${updateOrigin}/`,
            },
        });

        // Record what the shell hands the OS instead of opening a browser.
        await app.evaluate(({ shell }) => {
            const opened: string[] = [];
            (globalThis as unknown as { __opened: string[] }).__opened = opened;
            shell.openExternal = async (url: string) => {
                opened.push(url);
            };
        });

        page = await app.firstWindow();
        page.on("console", (message) => {
            if (message.type() !== "error") return;
            // Chromium's own refusal of the test's deliberate window.open(file:).
            if (message.text() === "Not allowed to load local resource: file:///etc/passwd") return;
            consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
        await page.waitForLoadState("load");
    });

    after(async () => {
        await app?.close();
        await new Promise<void>((resolve) => (idp ? idp.close(() => resolve()) : resolve()));
        await new Promise<void>((resolve) => (updateFeed ? updateFeed.close(() => resolve()) : resolve()));
        rmSync(userData, { recursive: true, force: true });
    });

    async function watchCsp(target: Page): Promise<void> {
        await target.evaluate(() => {
            const w = window as unknown as { __csp: string[] };
            w.__csp = [];
            document.addEventListener("securitypolicyviolation", (event) => {
                w.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
            });
        });
    }

    async function cspViolations(target: Page): Promise<string[]> {
        return target.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    }

    /** Remove exactly one console error a test deliberately caused; fail if it never appeared. */
    function dropExpected(pattern: RegExp): void {
        const index = consoleErrors.findIndex((text) => pattern.test(text));
        assert.notEqual(index, -1, `expected a console error matching ${pattern}; got ${JSON.stringify(consoleErrors)}`);
        consoleErrors.splice(index, 1);
    }

    async function opened(): Promise<string[]> {
        return app.evaluate(() => [...(globalThis as unknown as { __opened: string[] }).__opened]);
    }

    /** The main window's preload bridge — the one native feed a plugin gets. */
    async function nativeSnapshot(): Promise<unknown> {
        return page.evaluate(() =>
            (window as unknown as { tumultNative?: { snapshot(): unknown } }).tumultNative?.snapshot() ?? null,
        );
    }

    /** The main window's updater bridge — the second narrow native surface. */
    async function updaterSnapshot(): Promise<{ phase: string; version?: string; message?: string }> {
        return page.evaluate(() =>
            (window as unknown as { tumultUpdater?: { snapshot(): { phase: string; version?: string; message?: string } } })
                .tumultUpdater?.snapshot() ?? { phase: "missing" },
        );
    }

    /** Open a loopback client to the app's RPC, retrying until the server is up. */
    async function connectNative(): Promise<Socket> {
        const deadline = Date.now() + 10_000;
        for (;;) {
            try {
                return await new Promise((resolve, reject) => {
                    const socket = connect(nativePort, "127.0.0.1");
                    socket.once("error", reject);
                    socket.once("connect", () => resolve(socket));
                });
            } catch {
                if (Date.now() >= deadline) throw new Error("the native activity RPC server never accepted a connection");
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
    }

    /** Open the dedicated Discord IPC endpoint the app was told to bind. */
    async function connectDiscordIpc(): Promise<Socket> {
        const deadline = Date.now() + 10_000;
        for (;;) {
            try {
                return await new Promise((resolve, reject) => {
                    const socket = connect(discordIpcPath);
                    socket.once("error", reject);
                    socket.once("connect", () => resolve(socket));
                });
            } catch {
                if (Date.now() >= deadline) throw new Error("the Discord IPC sink never accepted a connection");
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
    }

    /** Poll a page-side or in-test condition with the same deadline as other waits. */
    async function until(condition: () => boolean, message: string): Promise<void> {
        const deadline = Date.now() + 10_000;
        while (!condition()) {
            if (Date.now() >= deadline) throw new Error(message);
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    it("loads app://tumult/ and renders the login page on a fresh profile", async () => {
        await page.waitForURL("app://tumult/login", { timeout: 20_000 });
        await page.locator(".tumult-page-title", { hasText: "Tumult" }).waitFor({ timeout: 10_000 });
        assert.equal(await page.evaluate(() => window.isSecureContext), true, "app:// must be a secure context");
        assert.equal(await page.evaluate(() => typeof crypto.subtle?.digest), "function");
        assert.deepEqual(consoleErrors, [], "the login page logged errors");
    });

    it("enforces the build's meta CSP under app://, with no 'unsafe-eval'", async () => {
        const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "");
        assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' blob:/);
        assert.match(csp, /worker-src 'self' blob:/);
        assert.match(csp, /media-src 'self' blob:/);
        assert.match(csp, /frame-src 'self'/);
        assert.doesNotMatch(csp, /(^|\s)'unsafe-eval'/);
        // The policy is live, not just present. Probed from a blob: script (which
        // script-src allows) because Playwright's own evaluate runs as DevTools
        // code, which CSP does not govern: string eval is refused there, and an
        // injected inline script never runs.
        const probe = await page.evaluate(async () => {
            const w = window as unknown as { __evalOk?: boolean; __inline?: boolean };
            const inline = document.createElement("script");
            inline.textContent = "window.__inline = true";
            document.head.append(inline);
            const url = URL.createObjectURL(
                new Blob(["try { new Function('return 1')(); window.__evalOk = true; } catch (e) { window.__evalOk = false; }"], { type: "text/javascript" }),
            );
            await new Promise<void>((resolve) => {
                const script = document.createElement("script");
                script.src = url;
                script.onload = () => resolve();
                script.onerror = () => resolve();
                document.head.append(script);
            });
            return { evalOk: w.__evalOk ?? null, inline: w.__inline ?? false };
        });
        assert.deepEqual(probe, { evalOk: false, inline: false }, "eval and inline script must both be blocked");
        // The refusal of that deliberate inline script is the one console error
        // this test causes; take it off the list the final check reads.
        dropExpected(/^Executing inline script violates the following Content Security Policy directive 'script-src/);
        // …and WebAssembly compiles ('wasm-unsafe-eval').
        const wasm = await page.evaluate(async () => {
            const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
            try {
                await WebAssembly.compile(bytes);
                return "ok";
            } catch (error) {
                return String(error);
            }
        });
        assert.equal(wasm, "ok");
    });

    it("serves vercel.json's headers per path, and 404s unknown /api paths", async () => {
        // Anonymous callbacks only: a named helper dies in the page (`__name`).
        const paths = ["/", "/g/x/y", "/sandbox.html", "/sandbox.js", "/api/nope", "/api/plugin-asset?owner=-bad&repo=x&tag=v1&name=a.js"];
        const [root, deep, sandbox, sandboxJs, api, badAsset] = await page.evaluate(
            async (list) =>
                Promise.all(
                    list.map(async (path) => {
                        const response = await fetch(path, { cache: "no-store" });
                        return {
                            status: response.status,
                            csp: response.headers.get("content-security-policy"),
                            type: response.headers.get("content-type"),
                            nosniff: response.headers.get("x-content-type-options"),
                        };
                    }),
                ),
            paths,
        );
        assert.ok(root && deep && sandbox && sandboxJs && api && badAsset);
        const result = { root, deep, sandbox, sandboxJs, api, badAsset };
        assert.equal(result.root.status, 200);
        assert.equal(result.root.csp, "frame-ancestors 'none'");
        assert.equal(result.root.nosniff, "nosniff");
        assert.match(result.deep.type ?? "", /text\/html/, "SPA fallback");
        assert.equal(result.sandbox.status, 200);
        assert.equal(result.sandbox.csp, SANDBOX_CSP);
        assert.match(result.sandboxJs.type ?? "", /javascript/);
        assert.equal(result.api.status, 404);
        assert.equal(result.badAsset.status, 400);
        dropExpected(/^Failed to load resource: the server responded with a status of 404/);
        dropExpected(/^Failed to load resource: the server responded with a status of 400/);
    });

    it("renders the shell from a stored session", async () => {
        await page.evaluate((session) => localStorage.setItem("tumult.session", JSON.stringify(session)), SESSION);
        await page.goto("app://tumult/dms");
        await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
        await watchCsp(page);
        await page.waitForTimeout(800);
        assert.ok((await page.locator(".tumult-rail").count()) > 0, "the rail did not render");
    });

    it("relays a native SET and CLEAR through the main window's window.tumultNative", async () => {
        // The main window's preload is the one bridge the shell breaks its
        // bridge-less stance for: a context-isolated contextBridge (NOT a page
        // script, so the app CSP is untouched) surfaces the native feed as
        // window.tumultNative, the value a plugin gets from ctx.nativeActivity().
        // It is empty until a native app pushes.
        const bridge = await page.evaluate(() => {
            const target = window as unknown as {
                tumultNative?: {
                    snapshot(): unknown;
                    onActivity(callback: (activity: unknown) => void): () => void;
                };
            };
            return {
                has: "tumultNative" in target,
                snapshot: typeof target.tumultNative?.snapshot,
                onActivity: typeof target.tumultNative?.onActivity,
            };
        });
        assert.ok(bridge.has, "the main window must expose window.tumultNative");
        assert.equal(bridge.snapshot, "function", "the bridge must expose snapshot()");
        assert.equal(bridge.onActivity, "function", "the bridge must expose onActivity()");

        // A web tab with no native signal: the bridge starts null.
        assert.equal(await nativeSnapshot(), null);

        // Open the loopback RPC like a co-located native app would, then drive a
        // SET followed by a CLEAR through it. main relays each to every window
        // over NATIVE_ACTIVITY_IPC; the preload turns it into a feed change the
        // page reads back through snapshot(). (The auth child window loads no
        // preload, so it never sees one.)
        const socket = await connectNative();
        const set = { type: "playing", name: "VLC", details: "Test" };
        await socket.write(JSON.stringify({ op: "set", value: set }) + "\n");
        const setJson = JSON.stringify(set);
        let snapshot = await nativeSnapshot();
        const deadline = Date.now() + 10_000;
        while (JSON.stringify(snapshot) !== setJson && Date.now() < deadline) {
            await page.waitForTimeout(100);
            snapshot = await nativeSnapshot();
        }
        assert.deepEqual(snapshot, set, "a native SET must reach the bridge's snapshot");

        await socket.write(JSON.stringify({ op: "clear" }) + "\n");
        snapshot = "not cleared yet";
        while (JSON.stringify(snapshot) !== "null" && Date.now() < deadline) {
            await page.waitForTimeout(100);
            snapshot = await nativeSnapshot();
        }
        assert.equal(snapshot, null, "a native CLEAR must clear the bridge");
        socket.destroy();
    });

    it("runs a real update check from Settings through the desktop bridge", async () => {
        // The second declared bridge. The main process owns electron-updater;
        // the preload forwards a snapshot/change event and three commands. Here
        // the feed is a loopback generic provider, but everything else is real:
        // UI click → IPC → electron-updater → snapshot → UI.
        const bridge = await page.evaluate(() => {
            const target = window as unknown as {
                tumultUpdater?: {
                    snapshot(): unknown;
                    onUpdate(callback: (snapshot: unknown) => void): () => void;
                    check(): Promise<unknown>;
                    download(): Promise<unknown>;
                    install(): void;
                };
            };
            return {
                has: "tumultUpdater" in target,
                methods: target.tumultUpdater
                    ? [target.tumultUpdater.snapshot, target.tumultUpdater.onUpdate, target.tumultUpdater.check, target.tumultUpdater.download, target.tumultUpdater.install].map((fn) => typeof fn)
                    : [],
            };
        });
        assert.ok(bridge.has, "the main window must expose window.tumultUpdater");
        assert.deepEqual(bridge.methods, ["function", "function", "function", "function", "function"]);
        assert.deepEqual(await updaterSnapshot(), { phase: "idle" }, "a feed-configured dev build starts idle, not unsupported");

        await page.locator(".tumult-userbar-gear").click();
        await page.locator(".tumult-settings").waitFor({ timeout: 10_000 });
        await page.locator('button[role="tab"][id$="trigger-cc.jackg.tumult.updates"]').click();
        await page.locator('[data-testid="updater-check"]').click();

        let snapshot = await updaterSnapshot();
        const deadline = Date.now() + 15_000;
        while (snapshot.phase !== "available" && Date.now() < deadline) {
            await page.waitForTimeout(100);
            snapshot = await updaterSnapshot();
        }
        assert.deepEqual(snapshot, { phase: "available", version: "99.0.0" });
        assert.match(await page.locator('[data-testid="updater-status"]').innerText(), /99\.0\.0/);
        assert.equal(await page.locator('[data-testid="updater-error"]').count(), 0);
        assert.equal(await page.locator('[data-testid="updater-download"]').count(), 1);
        // Deliberately do not click Download: replacing the running AppImage is
        // what a real release does, not what a smoke test should do.
        await page.keyboard.press("Escape");
        await page.locator(".tumult-settings").waitFor({ state: "hidden", timeout: 5_000 });
    });

    it("gives native activity priority over a manual one, even with the released plugin installed", async () => {
        // The last link the bridge test cannot prove: a native push reaches the
        // shell-owned document, its first-party renderer wins the user bar even
        // though the old plugin is installed, and a manual draft returns when
        // the producer clears. Use the exact released bundle, checked against
        // its manifest's hash, so compatibility is tested against the artifact
        // users actually install — not a stand-in with the same API.
        const fixtureDir = join(appRoot, "smoke", "fixtures", "rich-presence");
        const bundle = readFileSync(join(fixtureDir, "plugin.js"), "utf8");
        const manifestText = readFileSync(join(fixtureDir, "tumult.plugin.json"), "utf8");
        const manifest = JSON.parse(manifestText) as { id: string; integrity: string };
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bundle));
        assert.equal(
            `sha256-${Buffer.from(digest).toString("base64")}`,
            manifest.integrity,
            "the Rich Presence fixture does not match its released manifest",
        );

        // Same two-legged stub as the sandbox install test: the release API is
        // fetched by the page, the two assets by the main process's proxy.
        await page.route(`https://api.github.com/repos/jackgraddon/${manifest.id}/releases/latest`, (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ tag_name: "v0.2.0", assets: [{ name: "tumult.plugin.json" }, { name: "plugin.js" }] }),
            }),
        );
        await app.evaluate(({ net }, payload) => {
            net.fetch = async (input: string | Request) => {
                const url = typeof input === "string" ? input : input.url;
                if (url.endsWith("/tumult.plugin.json")) return new Response(payload.manifest, { headers: { "content-type": "application/json" } });
                if (url.endsWith("/plugin.js")) return new Response(payload.bundle, { headers: { "content-type": "text/javascript" } });
                return new Response("not found", { status: 404 });
            };
        }, { manifest: manifestText, bundle });

        await page.locator(".tumult-userbar-gear").click();
        await page.getByRole("tab", { name: "Installed" }).click();
        await page.locator("#tumult-plugin-url").fill(`https://github.com/jackgraddon/${manifest.id}`);
        await page.getByRole("button", { name: "Check" }).click();
        await page.locator(".tumult-consent").waitFor({ timeout: 10_000 });
        await page.getByRole("button", { name: "Install" }).click();
        // Component permissions force the trusted, in-page lane: a sandboxed
        // worker could not hand the shell a live Vue renderer.
        await page
            .locator(".tumult-plugin", { hasText: "Rich Presence" })
            .filter({ has: page.locator(".tumult-plugin-lane-trusted") })
            .waitFor({ timeout: 10_000 });
        await page.keyboard.press("Escape");

        const activityLine = page.locator(".tumult-userbar .tumult-activity--self");
        const waitForText = async (expected: string): Promise<void> => {
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline) {
                if ((await activityLine.count()) > 0 && (await activityLine.innerText()).includes(expected)) return;
                await page.waitForTimeout(100);
            }
            assert.fail(`the user bar never showed "${expected}": ${await activityLine.allInnerTexts()}`);
        };
        const openActivitySettings = async (): Promise<void> => {
            // A failed assertion above must not leave the full-screen dialog
            // covering the gear for every later test.
            if (await page.locator(".tumult-settings").count()) {
                await page.keyboard.press("Escape");
                await page.locator(".tumult-settings").waitFor({ state: "hidden", timeout: 5_000 });
            }
            await page.locator(".tumult-userbar-gear").click();
            await page.locator(".tumult-settings").waitFor({ timeout: 10_000 });
            // The released plugin also contributes a tab called "Activity".
            // Target ours by the id Reka carries in the trigger's generated id.
            await page.locator('button[role="tab"][id$="trigger-cc.jackg.tumult.activity"]').click();
        };
        const closeSettings = async (): Promise<void> => {
            await page.keyboard.press("Escape");
            await page.locator(".tumult-settings").waitFor({ state: "hidden", timeout: 5_000 });
        };

        // Save a manual document first: it is the one a producer must outrank,
        // and the one that must come back when the producer stops.
        await openActivitySettings();
        await page.locator("#tumult-activity-name").fill("Saved Album");
        await page.getByRole("button", { name: "Save activity" }).click();
        await waitForText("Saved Album");
        await closeSettings();

        // Push like a co-located native app would. The renderer only mounts
        // when the profile field holds a valid activity document, so seeing
        // "Playing VLC" proves the whole chain: RPC → bridge → shell controller
        // → extended profile → first-party activity slot → DOM.
        const socket = await connectNative();
        await socket.write(JSON.stringify({ op: "set", value: { type: "playing", name: "VLC", details: "Test" } }) + "\n");
        await waitForText("Playing VLC");
        assert.equal(await activityLine.getAttribute("data-activity-type"), "playing");
        assert.equal(await page.locator(".tumult-rp-activity--self").count(), 0, "the old plugin's renderer must not shadow ours");

        await socket.write(JSON.stringify({ op: "clear" }) + "\n");
        await waitForText("Saved Album");
        socket.destroy();

        // Leave no manual activity behind for the IPC test that follows.
        await openActivitySettings();
        await page.getByRole("button", { name: "Clear", exact: true }).click();
        await activityLine.waitFor({ state: "detached", timeout: 10_000 });
        await closeSettings();
    });

    it("mirrors Discord IPC SET_ACTIVITY through the shell's native feed into the user bar", async () => {
        // The second producer feeding the same native activity bridge: a
        // Discord-style app handshakes over our dedicated IPC endpoint and sends
        // SET_ACTIVITY. The first-party controller consumes the shared feed; the
        // released plugin installed above is deliberately kept out of it.
        const socket = await connectDiscordIpc();
        const framer = new DiscordFrameFramer();
        const received: DiscordFrame[] = [];
        socket.on("data", (chunk) => received.push(...framer.push(chunk)));

        socket.write(encodeDiscordFrame(DISCORD_OP.HANDSHAKE, { v: 1, client_id: "smoke-producer" }));
        await until(
            () => received.some((frame) => frame.payload?.evt === "READY"),
            "the Discord IPC sink never completed a handshake",
        );

        const now = Date.now();
        socket.write(
            encodeDiscordFrame(DISCORD_OP.FRAME, {
                cmd: "SET_ACTIVITY",
                nonce: "smoke-set",
                args: {
                    pid: 1,
                    activity: {
                        type: 2,
                        name: "Cider",
                        details: "IPC Song",
                        state: "IPC Artist",
                        timestamps: { start: now - 30_000, end: now + 90_000 },
                        assets: {
                            large_image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23646ffb'/%3E%3C/svg%3E",
                            large_text: "Album art",
                            small_image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Ccircle cx='32' cy='32' r='28' fill='%23f0b232'/%3E%3C/svg%3E",
                            small_text: "Cider badge",
                        },
                        buttons: [
                            { label: "Listen on Cider", url: "https://music.example.com/ipc-song" },
                            { label: "Open album", url: "https://music.example.com/ipc-album" },
                        ],
                    },
                },
            }),
        );
        await until(
            () => received.some((frame) => frame.payload?.nonce === "smoke-set"),
            "the Discord IPC sink never acknowledged SET_ACTIVITY",
        );

        const line = page.locator(".tumult-userbar .tumult-activity--self");
        await line.waitFor({ timeout: 10_000 });
        assert.match(await line.innerText(), /Listening to IPC Song/);
        assert.equal(await line.getAttribute("data-activity-type"), "listening");

        // The same native document reaches the profile card for our own member:
        // Discord artwork and start/end times are not dropped on the way in.
        const selfMember = page.locator(".tumult-member", { has: page.locator(".tumult-member-name", { hasText: /^Demo/ }) }).first();
        await selfMember.locator(".tumult-member-main").click();
        const card = page.locator(".tumult-profile-card", { has: page.locator(".tumult-profile-card-id", { hasText: "@demo:example.com" }) }).first();
        await card.waitFor({ state: "visible", timeout: 10_000 });
        const cardActivity = card.locator(".tumult-profile-card-activity");
        await cardActivity.waitFor({ timeout: 10_000 });
        assert.equal(await cardActivity.getAttribute("data-activity-renderer"), "cc.jackg.tumult.activity");
        assert.equal(await cardActivity.locator("img[data-activity-media]").count(), 2);
        assert.equal(await cardActivity.locator("[data-activity-progress]").count(), 1);
        const links = cardActivity.locator("a[data-activity-button]");
        assert.deepEqual(await links.allTextContents(), ["Listen on Cider", "Open album"]);
        assert.equal(await links.first().getAttribute("href"), "https://music.example.com/ipc-song");

        // A link is still an outbound link: Electron hands it to the OS browser
        // and the app window stays on app://tumult.
        await app.evaluate(() => {
            (globalThis as unknown as { __opened: string[] }).__opened.length = 0;
        });
        await links.first().click();
        await page.waitForTimeout(250);
        const opened = await app.evaluate(() => [...(globalThis as unknown as { __opened: string[] }).__opened]);
        assert.deepEqual(opened, ["https://music.example.com/ipc-song"]);
        assert.match(page.url(), /^app:\/\/tumult\//);

        await page.keyboard.press("Escape");
        await card.waitFor({ state: "hidden", timeout: 5_000 });

        socket.write(
            encodeDiscordFrame(DISCORD_OP.FRAME, {
                cmd: "SET_ACTIVITY",
                nonce: "smoke-clear",
                args: { pid: 1, activity: null },
            }),
        );
        await until(
            () => received.some((frame) => frame.payload?.nonce === "smoke-clear"),
            "the Discord IPC sink never acknowledged the clear",
        );
        await line.waitFor({ state: "detached", timeout: 10_000 });
        socket.destroy();
    });

    it("installs a sandboxed plugin through app://…/api/plugin-asset, and its frame is opaque", async () => {
        const bundle = `export const plugin = { manifest: { id: "cc.example.probe", name: "Probe", version: "1.0.0", permissions: ["styles"] }, async install(ctx) {
  ctx.injectStylesheet(":root { --desktop-probe: " + JSON.stringify(JSON.stringify({ origin: globalThis.origin })) + "; }");
} };\n`;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bundle));
        const integrity = `sha256-${Buffer.from(digest).toString("base64")}`;
        const manifest = { id: "cc.example.probe", name: "Probe", version: "1.0.0", author: "Someone", description: "Probe.", permissions: ["styles"], entry: "plugin.js", integrity };

        // GitHub's release API is fetched by the PAGE (CORS-open on the real
        // thing): fulfil it at the browser layer. The two release assets are
        // fetched by the MAIN process's /api/plugin-asset proxy via net.fetch:
        // stub that, recording the URLs it was asked for.
        await page.route("https://api.github.com/repos/example/probe/releases/latest", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({
                    tag_name: "v1.0.0",
                    assets: [{ name: "tumult.plugin.json" }, { name: "plugin.js" }],
                }),
            }),
        );
        await app.evaluate(({ net }, payload) => {
            const fetched: string[] = [];
            (globalThis as unknown as { __assetFetches: string[] }).__assetFetches = fetched;
            net.fetch = async (input: string | Request) => {
                const url = typeof input === "string" ? input : input.url;
                fetched.push(url);
                if (url.endsWith("/tumult.plugin.json")) return new Response(payload.manifest, { headers: { "content-type": "application/json" } });
                if (url.endsWith("/plugin.js")) return new Response(payload.bundle, { headers: { "content-type": "text/javascript" } });
                return new Response("not found", { status: 404 });
            };
        }, { manifest: JSON.stringify(manifest), bundle });

        await page.locator(".tumult-userbar-gear").click();
        await page.getByRole("tab", { name: "Installed" }).click();
        await page.locator("#tumult-plugin-url").fill("https://github.com/example/probe");
        await page.getByRole("button", { name: "Check" }).click();
        await page.locator(".tumult-consent").waitFor({ timeout: 10_000 });
        await page.getByRole("button", { name: "Install" }).click();
        await page.locator(".tumult-plugin", { has: page.locator(".tumult-plugin-lane-sandbox") }).waitFor({ timeout: 10_000 });
        await page.keyboard.press("Escape");

        const fetched = await app.evaluate(() => (globalThis as unknown as { __assetFetches: string[] }).__assetFetches);
        assert.deepEqual(fetched, [
            "https://github.com/example/probe/releases/download/v1.0.0/tumult.plugin.json",
            "https://github.com/example/probe/releases/download/v1.0.0/plugin.js",
        ]);

        let reported = "";
        const deadline = Date.now() + 10_000;
        while (!reported && Date.now() < deadline) {
            reported = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--desktop-probe").trim());
            if (!reported) await page.waitForTimeout(100);
        }
        assert.ok(reported, "the sandboxed plugin never ran");
        assert.deepEqual(JSON.parse(JSON.parse(reported)), { origin: "null" });

        const frameElement = page.locator("iframe[data-tumult-plugin-sandbox]");
        assert.equal(await frameElement.getAttribute("sandbox"), "allow-scripts");
        assert.equal(await frameElement.getAttribute("src"), "/sandbox.html");
        const frame = await (await frameElement.elementHandle())?.contentFrame();
        assert.ok(frame);
        const inside = (await frame.evaluate(`(() => {
            const out = { origin: self.origin, url: location.href };
            try { localStorage.getItem("tumult.session"); out.localStorage = "reachable"; } catch (e) { out.localStorage = "throws"; }
            return out;
        })()`)) as { origin: string; url: string; localStorage: string };
        assert.equal(inside.origin, "null");
        assert.equal(inside.url, "app://tumult/sandbox.html");
        assert.equal(inside.localStorage, "throws");
    });

    it("keeps the window on app:// and hands http(s) links to the OS browser", async () => {
        // Earlier activity-link clicks also use this hook; this test pins only
        // the navigations it performs itself.
        await app.evaluate(() => {
            (globalThis as unknown as { __opened: string[] }).__opened.length = 0;
        });
        const before = page.url();
        await page.evaluate(() => {
            window.location.assign("https://example.org/navigated");
        });
        await page.waitForTimeout(500);
        assert.equal(page.url(), before, "the app window left app://");

        const popup = await page.evaluate(() => {
            const a = window.open("https://example.org/popup");
            const b = window.open("file:///etc/passwd");
            const c = window.open("app://tumult/dms");
            return [a, b, c].map((w) => w === null);
        });
        assert.deepEqual(popup, [true, true, true], "window.open must never create a window");
        await page.waitForTimeout(300);
        assert.deepEqual(await opened(), ["https://example.org/navigated", "https://example.org/popup"]);
        assert.equal(app.windows().length, 1, "no extra window was opened");
    });

    it("denies permissions outside the allow-list (geolocation) and grants notifications", async () => {
        const result = await page.evaluate(async () => {
            const geo = await navigator.permissions.query({ name: "geolocation" });
            const notifications = await navigator.permissions.query({ name: "notifications" });
            const position = await new Promise<string>((resolve) => {
                navigator.geolocation.getCurrentPosition(
                    () => resolve("granted"),
                    (error) => resolve(`error ${error.code}`),
                    { timeout: 5000 },
                );
            });
            return { geo: geo.state, notifications: notifications.state, position };
        });
        assert.equal(result.geo, "denied");
        assert.equal(result.position, "error 1", "PERMISSION_DENIED");
        assert.equal(result.notifications, "granted");
    });

    it("can reach a homeserver on this machine (loopback http)", async () => {
        const status = await page.evaluate(async (origin) => {
            try {
                return (await fetch(`${origin}/ping`)).status;
            } catch (error) {
                return String(error);
            }
        }, idpOrigin);
        assert.equal(status, 200);
    });

    it("has no CSP violations or console errors so far", async () => {
        assert.deepEqual(await cspViolations(page), []);
        assert.deepEqual(consoleErrors, []);
    });

    // A login starts on the app's /login route; only there may an
    // authorization request open the (chromeless) sign-in window.
    async function toLoginPage(): Promise<void> {
        // Signed out, as a real login starts (an earlier test stored a session,
        // and the router sends a signed-in app from /login to /dms).
        // The previous test may have left a navigation in flight (closing the
        // sign-in window reloads /login), so retry a context lost to it.
        for (let attempt = 0; ; attempt++) {
            try {
                await page.waitForLoadState("load");
                await page.evaluate(() => localStorage.removeItem("tumult.session"));
                await page.evaluate(() => window.location.assign("app://tumult/login"));
                break;
            } catch (error) {
                if (attempt >= 5 || !String(error).includes("Execution context was destroyed")) throw error;
                await page.waitForTimeout(200);
            }
        }
        await page.waitForURL("app://tumult/login", { timeout: 10_000, waitUntil: "load" });
        await page.waitForTimeout(300);
        // A signed-in app redirects /login away, and then no sign-in window may open.
        assert.equal(page.url(), "app://tumult/login", "the app must be signed out on its login page to start a login");
    }

    it("does not open a sign-in window for an authorization URL outside the login page", async () => {
        await page.evaluate(() => window.location.assign("app://tumult/dms"));
        await page.waitForURL(/^app:\/\/tumult\/dms/, { timeout: 10_000, waitUntil: "load" });
        await page.waitForTimeout(300);
        const before = (await opened()).length;
        const authorize = new URL(`${idpOrigin}/authorize`);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("redirect_uri", "http://127.0.0.1/auth/callback");
        await page.evaluate((url) => window.location.assign(url), authorize.href);
        await page.waitForTimeout(1_000);
        assert.equal(app.windows().length, 1, "a look-alike sign-in window was opened from /dms");
        assert.deepEqual((await opened()).slice(before), [authorize.href], "it goes to the system browser instead, like any other link");
        assert.match(page.url(), /^app:\/\/tumult\/dms/);
    });

    it("returns to the login page when the auth window is closed without finishing", async () => {
        await toLoginPage();
        const authorize = new URL(`${idpOrigin}/login-page`);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("redirect_uri", "http://127.0.0.1/auth/callback");
        const child = app.waitForEvent("window");
        await page.evaluate((url) => window.location.assign(url), authorize.href);
        const authPage = await child;
        await authPage.waitForLoadState("load");
        // An IdP page gets no permissions: its top-level origin is not the app's.
        const notifications = await authPage.evaluate(async () => (await navigator.permissions.query({ name: "notifications" })).state);
        assert.equal(notifications, "denied");
        await authPage.close();
        await page.waitForURL(/^app:\/\/tumult\/(login|dms)/, { timeout: 10_000 });
    });

    it("runs the MAS flow in a child window and replays the loopback redirect into the app", async () => {
        await toLoginPage();
        const navigations: string[] = [];
        page.on("framenavigated", (frame) => {
            if (frame === page.mainFrame()) navigations.push(frame.url());
        });
        const authorize = new URL(`${idpOrigin}/authorize`);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("client_id", "smoke");
        authorize.searchParams.set("redirect_uri", "http://127.0.0.1/auth/callback");
        authorize.searchParams.set("state", "smoke-state");
        authorize.searchParams.set("response_mode", "fragment");

        // The fake client's completeLogin() writes no session (the real one
        // does), so stand one in now — after we are on /login, which is what
        // lets the sign-in window open — or the router bounces /dms to /login.
        await page.evaluate((session) => localStorage.setItem("tumult.session", JSON.stringify(session)), SESSION);
        const child = app.waitForEvent("window");
        await page.evaluate((url) => window.location.assign(url), authorize.href);
        const authPage = await child;
        if (!authPage.isClosed()) await authPage.waitForEvent("close", { timeout: 10_000 });

        // The callback route loads, the (fake) completeLogin finishes, and the
        // app drops the code from history and moves on to /dms.
        const target = "app://tumult/auth/callback#code=smoke-code&state=smoke-state";
        const deadline = Date.now() + 10_000;
        while (!navigations.includes(target) && Date.now() < deadline) await page.waitForTimeout(100);
        await page.waitForURL("app://tumult/dms", { timeout: 10_000 });
        assert.ok(
            navigations.includes("app://tumult/auth/callback#code=smoke-code&state=smoke-state"),
            `the callback route never loaded: ${JSON.stringify(navigations)}`,
        );
        assert.ok(idpHits.some((hit) => hit.startsWith("/authorize?")), "the IdP was never asked");
        assert.equal(app.windows().length, 1);
    });

});
