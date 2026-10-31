/**
 * Desktop smoke test: the real Electron main process (`dist/main.cjs`) serving
 * a FAKE-mode desktop web build (`web-fake/`, built with `VITE_DESKTOP=1
 * --mode fake`) — no homeserver, no network beyond a loopback fake IdP.
 *
 * What it proves that unit tests cannot: the app:// scheme really serves the
 * build with vercel.json's headers, the meta CSP holds under app:// (no
 * violations, no console errors), the plugin sandbox frame boots opaque, the
 * navigation guard keeps the window on app:// and hands http(s) to the OS, the
 * permission handlers deny what they should, and the MAS redirect is caught
 * before the network and replayed into the app's callback route.
 *
 * Run: `pnpm --filter @tumult/desktop test:smoke` (its `pretest:smoke` builds
 * core, theme, the fake web build and the main process). Linux CI runs it under
 * xvfb.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { ElectronApplication, Page } from "playwright";
import { _electron as electron } from "playwright";

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
    const idpHits: string[] = [];
    const userData = mkdtempSync(join(tmpdir(), "tumult-desktop-smoke-"));
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

        app = await electron.launch({
            executablePath: electronPath,
            args: [appRoot],
            env: {
                ...process.env,
                TUMULT_WEB_ROOT: join(appRoot, "web-fake"),
                TUMULT_USER_DATA_DIR: userData,
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

    it("runs the MAS flow in a child window and replays the loopback redirect into the app", async () => {
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

    it("returns to the login page when the auth window is closed without finishing", async () => {
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
});
