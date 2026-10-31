/**
 * The embedded Element Call path — calls without native voice — through the
 * real app against the MatrixRTC stack in `tests/rtc/`.
 *
 * Tumult has two call paths. Native voice (VITE_VOICE) is covered by
 * rtc-media.test.ts. This is the other: no VITE_VOICE, a VITE_ELEMENT_CALL_URL,
 * and the call app runs as a cross-origin widget iframe that our
 * CallWidgetDriver answers (packages/core/src/call/). It is the fallback for a
 * deployment without native voice, so it must work on its own.
 *
 * The call app is Element Call's published EMBEDDED package (the release
 * tarball, sha256-pinned, see EC_TARBALL_SHA256), served by a
 * small static server on its own origin — the iframe sandbox needs
 * allow-same-origin, which is only safe on a DIFFERENT origin from Tumult.
 * EC_VERSION is pinned; bump it deliberately.
 *
 * Same proof as the native test: each Chromium's fake mic plays one tone and
 * its fake camera shows one colour, and each side must hear the other's tone
 * and see the other's colour INSIDE the call iframe (Playwright's init script
 * runs in child frames too, so the peer-connection probe sees EC's tracks).
 *
 * Skips unless `TEST_RTC=1` (set by tests/rtc/run.sh). On failure, screenshots
 * and console logs land in `apps/web/test-results/element-call/`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { after, before, describe, it } from "node:test";

import { chromium, type Browser, type Frame } from "playwright";

import { CAPTURE_REMOTE_TRACKS, HEARD, PEOPLE, STATS, colourOf, fakeCaptureArgs, seenScript, writeColour, writeTone, type Rgb } from "./support/media.ts";
import { api, createDmAs, enabled, openDevice, poll, register, saveArtifacts, serveRealApp, type Device, type RealApp } from "./support/real-app.ts";

const PORT = 4178;
const EC_PORT = 4190;
/**
 * The release's `.sha256` asset is NOT a tarball checksum: it is a manifest
 * of every unpacked file. This pin was taken after all 157 files in the
 * v0.26.1 tarball checked out against that manifest (`shasum -c`), with none
 * extra. Bumping EC_VERSION means repeating that check.
 */
const EC_TARBALL_SHA256 = "e1c56f72bda6f8deb5015fbdaead57ea648b70c828c857306914c461dbcae1d7";
const EC_ORIGIN = `http://127.0.0.1:${EC_PORT}`;
/** Latest stable (non-rc) release when written; its token path (OpenID → lk-jwt /get_token, /sfu/get) matches tests/rtc. */
const EC_VERSION = "0.26.1";
const SEEN = seenScript("video");

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".webm": "video/webm",
};

/** Download the embedded package, check it against the pinned sha256, unpack it. */
async function fetchElementCall(dir: string): Promise<string> {
    const base = `https://github.com/element-hq/element-call/releases/download/v${EC_VERSION}`;
    const name = `element-call-embedded-${EC_VERSION}`;
    // curl, synchronously: an awaited fetch() here stalled the hook with an
    // empty event loop under node --test (locally and on CI), while the same
    // fetch in a plain script did not.
    const download = (url: string): Buffer => {
        const got = spawnSync("curl", ["-fsSL", "--retry", "3", url], { maxBuffer: 64 * 1024 * 1024 });
        assert.equal(got.status, 0, `could not download ${url}: ${got.stderr}`);
        return got.stdout;
    };
    const tarball = download(`${base}/${name}.tar.gz`);
    const actual = createHash("sha256").update(tarball).digest("hex");
    assert.equal(actual, EC_TARBALL_SHA256, `Element Call ${EC_VERSION} tarball does not match its pinned sha256`);
    const file = join(dir, `${name}.tar.gz`);
    writeFileSync(file, tarball);
    const out = join(dir, "ec");
    rmSync(out, { recursive: true, force: true });
    spawnSync("mkdir", ["-p", out]);
    const untar = spawnSync("tar", ["-xzf", file, "-C", out]);
    assert.equal(untar.status, 0, `could not unpack Element Call: ${untar.stderr}`);
    // The package may or may not wrap its files in a top directory.
    const find = (d: string): string | null => {
        if (existsSync(join(d, "index.html"))) return d;
        for (const entry of readdirSync(d)) {
            const sub = join(d, entry);
            if (statSync(sub).isDirectory()) {
                const hit = find(sub);
                if (hit) return hit;
            }
        }
        return null;
    };
    const root = find(out);
    assert.ok(root, "no index.html in the Element Call package");
    return root;
}

/** A static server for the call app: files as they are, index.html for anything else (SPA). */
function serveStatic(root: string, port: number): Promise<Server> {
    const server = createServer((req, res) => {
        const path = decodeURIComponent((req.url ?? "/").split(/[?#]/)[0] ?? "/");
        const file = normalize(join(root, path));
        const inside = file === root || file.startsWith(root + sep);
        const target = inside && existsSync(file) && statSync(file).isFile() ? file : join(root, "index.html");
        res.writeHead(200, { "Content-Type": MIME[extname(target)] ?? "application/octet-stream" });
        res.end(readFileSync(target));
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server));
    });
}

interface Person extends Device {
    tone: number;
    colour: Rgb;
    browser: Browser;
}

describe("embedded Element Call through the real app", { skip: !enabled && "set TEST_RTC=1 (tests/rtc/run.sh)" }, () => {
    let app: RealApp;
    let callServer: Server;
    let workDir: string;
    let roomId: string;
    const people: Person[] = [];
    let failed = false;

    async function guard(run: () => Promise<void>): Promise<void> {
        try {
            await run();
        } catch (error) {
            failed = true;
            for (const p of people) {
                const frame = callFrame(p);
                p.logs.push(`[stats] ${JSON.stringify(frame ? await frame.evaluate(STATS).catch(String) : "no call frame")}`);
            }
            throw error;
        }
    }

    /** The call app's iframe in this person's page, once it exists. */
    function callFrame(p: Person): Frame | undefined {
        return p.page.frames().find((f) => f.url().startsWith(EC_ORIGIN));
    }

    before(async () => {
        workDir = mkdtempSync(join(tmpdir(), "tumult-element-call-"));
        console.log("[element-call] fetching the call app");
        const root = await fetchElementCall(workDir);
        console.log(`[element-call] serving ${root} on ${EC_ORIGIN}`);
        callServer = await serveStatic(root, EC_PORT);
        console.log("[element-call] building and serving the real app");
        // No VITE_VOICE: the call menu takes the embedded path. The build puts
        // this origin in the CSP's frame-src.
        app = await serveRealApp({ port: PORT, env: { VITE_ELEMENT_CALL_URL: EC_ORIGIN } });

        console.log(`[element-call] app on ${app.origin}; registering`);
        const suffix = Date.now().toString(36);
        const accounts = await Promise.all(PEOPLE.map((p) => register(`ec-${p.name}-${suffix}`)));
        const [alice, bob] = accounts as [(typeof accounts)[0], (typeof accounts)[0]];
        roomId = await createDmAs(alice, bob.userId);
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, bob.accessToken, {});

        console.log(`[element-call] DM ${roomId}; opening browsers`);
        for (const [i, spec] of PEOPLE.entries()) {
            const wav = join(workDir, `${spec.name}.wav`);
            const y4m = join(workDir, `${spec.name}.y4m`);
            writeTone(wav, spec.tone);
            writeColour(y4m, spec.colour);
            const browser = await chromium.launch({ args: fakeCaptureArgs(wav, y4m) });
            const device = await openDevice(browser, `ec-${spec.name}`, accounts[i]!, { initScript: CAPTURE_REMOTE_TRACKS });
            // Both origins: the app asks, and so does the call app in its frame.
            for (const origin of [app.origin, EC_ORIGIN]) await device.context.grantPermissions(["microphone", "camera"], { origin });
            people.push({ ...spec, ...device, browser });
        }
    });

    after(async () => {
        if (failed) await saveArtifacts("element-call", people);
        for (const p of people) await p.browser.close().catch(() => {});
        await app?.close();
        await new Promise((resolve) => callServer?.close(resolve));
        if (workDir) rmSync(workDir, { recursive: true, force: true });
    });

    it("joins one video call through the embedded call app from both browsers", { timeout: 240_000 }, () =>
        guard(async () => {
            for (const p of people) {
                await p.page.goto(`${app.origin}/dms/${encodeURIComponent(roomId)}`, { waitUntil: "load" });
                await p.page.waitForSelector(".tumult-shell", { timeout: 60_000 });
                await p.page.getByRole("button", { name: "Choose call type" }).click({ timeout: 60_000 });
                await p.page.getByRole("menuitem", { name: "Video" }).click();
                await poll(`${p.name}'s call frame never loaded`, async () => Boolean(callFrame(p)), (ok) => ok, 60_000);
                // The panel says "joined" only once the call app reports it
                // joined (io.element.join), so this is the widget handshake.
                // Until this asserted it, a frame showing the call app's own
                // home page (no handshake at all) passed as "joined".
                await p.page.locator(".tumult-call").waitFor({ timeout: 60_000 });
                await poll(
                    `${p.name}'s call never reported joined`,
                    async () => {
                        // A lobby, if the app shows one, wants a click.
                        const join = callFrame(p)?.getByRole("button", { name: /^join/i });
                        if (join && (await join.count().catch(() => 0)) > 0) await join.first().click().catch(() => {});
                        return (await p.page.locator(".tumult-call-state").textContent())?.trim() ?? "";
                    },
                    (state) => state === "In call",
                    90_000,
                );
            }
        }),
    );

    it("each side sees the other's camera inside the call app", { timeout: 150_000 }, () =>
        guard(async () => {
            for (const [i, p] of people.entries()) {
                const other = people[1 - i]!;
                const want = colourOf(other.colour);
                await poll(
                    `${p.name} never saw ${other.name}'s ${want} camera in the call app`,
                    async () => ((await callFrame(p)?.evaluate(SEEN)) ?? []) as { rgb: number[]; frames: number }[],
                    (tiles) => tiles.some((t) => colourOf(t.rgb) === want),
                    90_000,
                );
            }
        }),
    );

    it("each side hears the other's microphone inside the call app", { timeout: 150_000 }, () =>
        guard(async () => {
            for (const [i, p] of people.entries()) {
                const other = people[1 - i]!;
                await poll(
                    `${p.name} never heard ${other.name}'s ${other.tone} Hz tone in the call app`,
                    async () => ((await callFrame(p)?.evaluate(HEARD)) ?? []) as { hz: number; db: number }[],
                    (heard) => heard.some((h) => Math.abs(h.hz - other.tone) <= 12 && h.db > -70),
                    90_000,
                );
            }
        }),
    );
    it("hanging up inside the call app ends the call in the app around it", { timeout: 60_000 }, () =>
        guard(async () => {
            // The call app sends im.vector.hangup and then io.element.close on a
            // normal leave: hang-up alone only marks the call ended (an error
            // screen may still need reading), close takes the frame down.
            const alice = people[0]!;
            const frame = callFrame(alice);
            assert.ok(frame, "alice has no call frame to hang up from");
            await frame.getByRole("button", { name: /end call|leave|hang ?up/i }).first().click({ timeout: 20_000 });
            await alice.page.locator(".tumult-call").waitFor({ state: "detached", timeout: 30_000 });
        }),
    );
});
