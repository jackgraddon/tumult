/**
 * Two people, one video call, real media: the built app (real client, native
 * voice) in two Chromium browsers against the MatrixRTC stack in `tests/rtc/`.
 *
 * Each browser's microphone is a WAV file of one pure tone and its camera a
 * Y4M file of one solid colour, each different per person (Chromium's fake
 * capture devices). Each side then checks that the OTHER side's tone is what
 * it hears and the other side's colour is what it sees. That makes the
 * assertion end to end and specific:
 *
 *  - It proves the media is the peer's, not silence or a test pattern.
 *  - Voice is always E2EE (frame encryption with MatrixRTC keys), so a wrong
 *    or missing key decrypts to garbage: no tone, no colour, test fails. A
 *    test that only counted received bytes would pass that.
 *
 * Audio is read off the remote `MediaStreamTrack`s themselves: an init script
 * records every track a peer connection receives (LiveKit keeps its `<audio>`
 * elements off the DOM, and this avoids depending on app internals). The track
 * carries decrypted audio, because the E2EE transform runs before decoding.
 * Video is read off the call tiles the user actually sees.
 *
 * Microphone processing is turned OFF through the app's own Voice settings:
 * noise suppression exists to remove steady tones, and would erase this one.
 *
 * Skips unless `TEST_RTC=1` (set by tests/rtc/run.sh, which starts the stack).
 * On failure it leaves screenshots and each browser's console log in
 * `apps/web/test-results/rtc-media/` (uploaded by the integration workflow).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";

import { createDm } from "../../../packages/core/src/rooms/lifecycle.ts";

const BASE = process.env["TEST_SYNAPSE_URL"] ?? "http://127.0.0.1:8018";
const enabled = process.env["TEST_RTC"] === "1";
const PORT = 4175;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
// matrix-js-sdk is core's dependency, not this app's (pnpm does not hoist):
// resolve it from core, which is also the copy lifecycle.ts imports.
const coreRoot = join(here, "..", "..", "..", "packages", "core");
const resultsDir = join(appRoot, "test-results", "rtc-media");

type Rgb = [number, number, number];

interface Person {
    name: string;
    /** The pure tone this person's fake microphone plays, in Hz. */
    tone: number;
    /** The solid colour this person's fake camera shows. */
    colour: Rgb;
    userId: string;
    deviceId: string;
    accessToken: string;
    browser: Browser;
    context: BrowserContext;
    page: Page;
    logs: string[];
}

// Far apart on both axes, so neither a codec nor a resampler can confuse them.
const PEOPLE = [
    { name: "alice", tone: 440, colour: [200, 40, 40] as Rgb },
    { name: "bob", tone: 1000, colour: [40, 40, 200] as Rgb },
];

/** A mono 16-bit 48 kHz WAV of one sine tone. Chromium loops the file. */
function writeTone(path: string, hz: number): void {
    const rate = 48000;
    const samples = rate * 2;
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.5 * 32767), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write("data", 36);
    header.writeUInt32LE(data.length, 40);
    writeFileSync(path, Buffer.concat([header, data]));
}

/** A Y4M (4:2:0, full-range BT.601) of one solid colour. Chromium loops it. */
function writeColour(path: string, [r, g, b]: Rgb): void {
    const width = 320;
    const height = 240;
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const u = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
    const v = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    const frame = Buffer.concat([
        Buffer.from("FRAME\n"),
        Buffer.alloc(width * height, y),
        Buffer.alloc((width / 2) * (height / 2), u),
        Buffer.alloc((width / 2) * (height / 2), v),
    ]);
    const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420jpeg\n`);
    writeFileSync(path, Buffer.concat([header, ...Array.from({ length: 15 }, () => frame)]));
}

async function api<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    assert.ok(res.ok, `${method} ${path} → ${res.status}: ${text}`);
    return JSON.parse(text) as T;
}

async function register(username: string): Promise<{ userId: string; deviceId: string; accessToken: string }> {
    const body = { username, password: "testtesttest" };
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

/**
 * Runs in the page before any app script: record every track a peer
 * connection receives. A plain string, not a function: tsx wraps named
 * functions in `__name()`, which does not exist in the page (see AGENTS.md).
 */
const CAPTURE_REMOTE_TRACKS = `
(() => {
    const Native = window.RTCPeerConnection;
    window.__tumultRemoteTracks = [];
    window.__tumultPeerConnections = [];
    function Recording(...args) {
        const pc = new Native(...args);
        window.__tumultPeerConnections.push(pc);
        pc.addEventListener("track", (event) => window.__tumultRemoteTracks.push(event.track));
        return pc;
    }
    Recording.prototype = Native.prototype;
    Object.setPrototypeOf(Recording, Native);
    window.RTCPeerConnection = Recording;
})();
`;

/**
 * The dominant frequency of each live remote audio track, after listening for
 * a moment. Each track is also played through a muted element: Chromium only
 * feeds a remote WebRTC track to Web Audio while something is playing it.
 */
const HEARD = `
(async () => {
    const tracks = window.__tumultRemoteTracks.filter((t) => t.kind === "audio" && t.readyState === "live");
    const ctx = new AudioContext();
    await ctx.resume();
    const probes = tracks.map((track) => {
        const stream = new MediaStream([track]);
        const element = new Audio();
        element.muted = true;
        element.srcObject = stream;
        element.play().catch(() => {});
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 8192;
        ctx.createMediaStreamSource(stream).connect(analyser);
        return analyser;
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const heard = probes.map((analyser) => {
        const bins = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(bins);
        const binHz = ctx.sampleRate / analyser.fftSize;
        let best = Math.ceil(100 / binHz);
        for (let i = best; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
        return { hz: Math.round(best * binHz), db: Math.round(bins[best]) };
    });
    await ctx.close();
    return heard;
})()
`;

/** The average colour of every call tile that is showing frames. */
const SEEN = `
(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    return [...document.querySelectorAll(".tumult-voice-tile video")]
        .filter((video) => video.videoWidth > 0)
        .map((video) => {
            g.drawImage(video, 0, 0, 16, 16);
            const px = g.getImageData(0, 0, 16, 16).data;
            const sum = [0, 0, 0];
            for (let i = 0; i < px.length; i += 4) {
                sum[0] += px[i];
                sum[1] += px[i + 1];
                sum[2] += px[i + 2];
            }
            return { rgb: sum.map((c) => Math.round(c / 256)), frames: video.getVideoPlaybackQuality().totalVideoFrames };
        });
})()
`;

/** What the peer connections say they received: the diagnosis when media is missing. */
const STATS = `
(async () => {
    const out = [];
    for (const pc of window.__tumultPeerConnections) {
        (await pc.getStats()).forEach((s) => {
            if (s.type === "inbound-rtp") {
                out.push({ kind: s.kind, bytes: s.bytesReceived, energy: s.totalAudioEnergy, decoded: s.framesDecoded, lost: s.packetsLost });
            }
        });
        out.push({ pc: pc.connectionState });
    }
    return out;
})()
`;

/**
 * Which of the two test colours this is, by dominant channel; null for neither.
 * Coarse on purpose: VP8 shifts a flat colour a little, and black (no frames
 * decoded) or E2EE garbage must not pass.
 */
function colourOf(rgb: readonly number[]): "red" | "blue" | null {
    const [r = 0, g = 0, b = 0] = rgb;
    if (r > g + 60 && r > b + 60) return "red";
    if (b > r + 60 && b > g + 60) return "blue";
    return null;
}

async function poll<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last = await read();
    while (!done(last)) {
        assert.ok(Date.now() < deadline, `${label}; last reading: ${JSON.stringify(last)}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        last = await read();
    }
    return last;
}

describe("two-browser call media through the real app", { skip: !enabled && "set TEST_RTC=1 (tests/rtc/run.sh)" }, () => {
    let server: PreviewServer;
    let origin: string;
    let workDir: string;
    let roomId: string;
    const people: Person[] = [];
    let failed = false;

    before(async () => {
        workDir = mkdtempSync(join(tmpdir(), "tumult-rtc-media-"));

        // The REAL client with native voice on. The client URI is only used by
        // the OIDC login this test skips (the session is injected), but the
        // build refuses to run without one.
        process.env["VITE_VOICE"] = "1";
        process.env["VITE_CLIENT_URI"] ??= "https://tumult.test";
        const outDir = join(workDir, "dist");
        await build({ root: appRoot, mode: "production", logLevel: "error", build: { outDir } });
        server = await preview({
            root: appRoot,
            mode: "production",
            logLevel: "error",
            build: { outDir },
            preview: { host: "127.0.0.1", port: PORT, strictPort: true },
        });
        origin = `http://127.0.0.1:${PORT}`;

        const suffix = Date.now().toString(36);
        const accounts = await Promise.all(PEOPLE.map((p) => register(`${p.name}-${suffix}`)));
        const [alice, bob] = accounts as [(typeof accounts)[0], (typeof accounts)[0]];
        // The room is made by Tumult's own createDm, the code behind "new DM",
        // so the call runs in the room the app really creates. Two things in it
        // matter here, and each broke this test before it was there:
        //  - Bob is a plain member (power 0), and joining is a `call.member`
        //    STATE event; createDm opens that to members (it used to be 50,
        //    and every member but the creator got M_FORBIDDEN).
        //  - Encrypted, as real DMs are: MatrixRTC sends media keys as
        //    encrypted to-device messages, and crypto only tracks the devices
        //    of ENCRYPTED rooms' members ("unknown device" otherwise).
        const sdk = (await import(pathToFileURL(createRequire(join(coreRoot, "package.json")).resolve("matrix-js-sdk")).href)) as {
            createClient: (opts: { baseUrl: string; userId: string; accessToken: string; deviceId: string }) => unknown;
        };
        const aliceSdk = sdk.createClient({ baseUrl: BASE, userId: alice.userId, accessToken: alice.accessToken, deviceId: alice.deviceId });
        roomId = await createDm(aliceSdk as Parameters<typeof createDm>[0], { userId: bob.userId, encrypted: true });
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, bob.accessToken, {});

        for (const [i, spec] of PEOPLE.entries()) {
            const account = accounts[i]!;
            const wav = join(workDir, `${spec.name}.wav`);
            const y4m = join(workDir, `${spec.name}.y4m`);
            writeTone(wav, spec.tone);
            writeColour(y4m, spec.colour);
            // One browser per person: the fake-capture files are browser-wide flags.
            const browser = await chromium.launch({
                args: [
                    "--use-fake-device-for-media-stream",
                    "--use-fake-ui-for-media-stream",
                    `--use-file-for-fake-audio-capture=${wav}`,
                    `--use-file-for-fake-video-capture=${y4m}`,
                    "--autoplay-policy=no-user-gesture-required",
                ],
            });
            const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
            await context.grantPermissions(["microphone", "camera"], { origin });
            const session = {
                homeserverUrl: BASE,
                userId: account.userId,
                deviceId: account.deviceId,
                clientId: "tumult-rtc-media-test",
                accessToken: account.accessToken,
            };
            const processingOff = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
            await context.addInitScript({
                content:
                    `localStorage.setItem("tumult.session", ${JSON.stringify(JSON.stringify(session))});\n` +
                    `localStorage.setItem("tumult.voice.settings", ${JSON.stringify(JSON.stringify(processingOff))});\n` +
                    CAPTURE_REMOTE_TRACKS,
            });
            const page = await context.newPage();
            const logs: string[] = [];
            page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
            page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
            people.push({ ...spec, ...account, browser, context, page, logs });
        }
    });

    after(async () => {
        if (failed) {
            mkdirSync(resultsDir, { recursive: true });
            for (const p of people) {
                await p.page.screenshot({ path: join(resultsDir, `${p.name}.png`) }).catch(() => {});
                writeFileSync(join(resultsDir, `${p.name}.console.log`), p.logs.join("\n"));
            }
        }
        for (const p of people) await p.browser.close().catch(() => {});
        await server?.close();
        if (workDir) rmSync(workDir, { recursive: true, force: true });
    });

    it("joins one video call from both browsers", { timeout: 180_000 }, async () => {
        try {
            for (const p of people) {
                await p.page.goto(`${origin}/dms/${encodeURIComponent(roomId)}`, { waitUntil: "load" });
                await p.page.waitForSelector(".tumult-shell", { timeout: 60_000 });
                await p.page.getByRole("button", { name: "Choose call type" }).click({ timeout: 60_000 });
                await p.page.getByRole("menuitem", { name: "Video" }).click();
                // On failure the bar shows the error instead (e.g. M_FORBIDDEN
                // when the room keeps call membership above a member's power),
                // and the screenshot in test-results/ shows which person.
                await p.page.locator(".tumult-voice").getByText("Voice connected").waitFor({ timeout: 60_000 });
            }
        } catch (error) {
            failed = true;
            throw error;
        }
    });

    it("each side sees the other's camera", { timeout: 120_000 }, async () => {
        try {
            for (const [i, p] of people.entries()) {
                const other = people[1 - i]!;
                const want = colourOf(other.colour);
                const seen = await poll(
                    `${p.name} never saw ${other.name}'s ${want} camera`,
                    async () => (await p.page.evaluate(SEEN)) as { rgb: number[]; frames: number }[],
                    (tiles) => tiles.some((t) => colourOf(t.rgb) === want),
                    60_000,
                );
                // Frames must keep coming: a frozen first frame is not a call.
                const remote = seen.find((t) => colourOf(t.rgb) === want)!;
                await new Promise((resolve) => setTimeout(resolve, 2000));
                const later = ((await p.page.evaluate(SEEN)) as { rgb: number[]; frames: number }[]).find((t) => colourOf(t.rgb) === want);
                assert.ok(later && later.frames > remote.frames, `${other.name}'s video froze at ${remote.frames} frames on ${p.name}'s screen`);
                // And our own preview is our own colour, so the two are not swapped.
                assert.ok(
                    seen.some((t) => colourOf(t.rgb) === colourOf(p.colour)),
                    `${p.name}'s own tile is not ${colourOf(p.colour)}: ${JSON.stringify(seen)}`,
                );
            }
        } catch (error) {
            failed = true;
            for (const p of people) p.logs.push(`[stats] ${JSON.stringify(await p.page.evaluate(STATS).catch(String))}`);
            throw error;
        }
    });

    it("each side hears the other's microphone", { timeout: 120_000 }, async () => {
        try {
            for (const [i, p] of people.entries()) {
                const other = people[1 - i]!;
                // Within two FFT bins of the peer's tone, and clearly above silence.
                await poll(
                    `${p.name} never heard ${other.name}'s ${other.tone} Hz tone`,
                    async () => (await p.page.evaluate(HEARD)) as { hz: number; db: number }[],
                    (heard) => heard.some((h) => Math.abs(h.hz - other.tone) <= 12 && h.db > -70),
                    60_000,
                );
            }
        } catch (error) {
            failed = true;
            for (const p of people) p.logs.push(`[stats] ${JSON.stringify(await p.page.evaluate(STATS).catch(String))}`);
            throw error;
        }
    });

    it("refuses a member a room keeps out of calls: a sentence, and no ghost on the SFU", { timeout: 120_000 }, async () => {
        const [alice, bob] = people as [Person, Person];
        try {
            // A room NOT made by createDm: call membership stays at the
            // preset's 50, so Alice (creator) may join and Bob (member) may not.
            const { room_id: closed } = await api<{ room_id: string }>("POST", "/_matrix/client/v3/createRoom", alice.accessToken, {
                name: "Admins only",
                preset: "private_chat",
                invite: [bob.userId],
                initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
            });
            await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(closed)}`, bob.accessToken, {});

            // Alice's call puts a focus in the room. That is what made the old
            // bug: Bob's refused join still found HER focus, fetched a token
            // and connected to the SFU as a ghost nobody could close.
            // Fresh pages: the init script resets the peer-connection record.
            for (const p of [alice, bob]) {
                await p.page.goto(`${origin}/dms/${encodeURIComponent(closed)}`, { waitUntil: "load" });
                await p.page.waitForSelector(".tumult-shell", { timeout: 60_000 });
            }
            await alice.page.getByRole("button", { name: "Choose call type" }).click({ timeout: 60_000 });
            await alice.page.getByRole("menuitem", { name: "Voice" }).click();
            await alice.page.locator(".tumult-voice").getByText("Voice connected").waitFor({ timeout: 60_000 });

            await bob.page.getByRole("button", { name: "Choose call type" }).click({ timeout: 60_000 });
            await bob.page.getByRole("menuitem", { name: "Voice" }).click();
            const bar = bob.page.locator(".tumult-voice");
            await bar.getByText("permission to join calls").waitFor({ timeout: 60_000 });
            const shown = (await bar.locator(".tumult-voice-status").textContent()) ?? "";
            assert.doesNotMatch(shown, /http|MatrixError|MembershipManager/, `raw error shown: ${shown}`);
            assert.equal(await bar.getByRole("button", { name: "Dismiss" }).count(), 1, "a failed session offers a way out");

            // The membership write and the SFU connect run in parallel, so the
            // refusal can land before the connect starts or mid-way through it
            // (both seen on CI). Either way nothing may STAY connected: give a
            // straggling join every chance, then no peer connection Bob's page
            // made may be live. The ghost was one left connected. An aborted
            // connect can leave a PC LiveKit created but never started (`new`:
            // no ICE, no transport, no participant) — LiveKit's abort path does
            // not close() it; that is a leaked object, not a ghost.
            await new Promise((resolve) => setTimeout(resolve, 8000));
            const states = (await bob.page.evaluate("window.__tumultPeerConnections.map((pc) => pc.connectionState)")) as string[];
            assert.ok(
                !states.some((s) => s === "connecting" || s === "connected"),
                `Bob's refused join left a connection to the SFU live: ${JSON.stringify(states)}`,
            );
            // And the SFU agrees: Alice's call still has only Alice in it.
            assert.match((await alice.page.locator(".tumult-voice-room").textContent()) ?? "", /· 1\b/, "a ghost Bob joined Alice's call");

            await bar.getByRole("button", { name: "Dismiss" }).click();
            await bob.page.waitForSelector(".tumult-voice", { state: "detached", timeout: 10_000 });
        } catch (error) {
            failed = true;
            throw error;
        }
    });
});
