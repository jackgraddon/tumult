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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { chromium, type Browser } from "playwright";

import {
    CAPTURE_REMOTE_TRACKS,
    HEARD,
    PEOPLE,
    STATS,
    colourOf,
    fakeCaptureArgs,
    seenScript,
    writeColour,
    writeTone,
    type Rgb,
} from "./support/media.ts";
import { api, createDmAs, enabled, openDevice, poll, register, saveArtifacts, serveRealApp, type Device, type RealApp } from "./support/real-app.ts";

const SEEN = seenScript(".tumult-voice-tile video");

const PORT = 4175;

interface Person extends Device {
    /** The pure tone this person's fake microphone plays, in Hz. */
    tone: number;
    /** The solid colour this person's fake camera shows. */
    colour: Rgb;
    userId: string;
    accessToken: string;
    browser: Browser;
}

describe("two-browser call media through the real app", { skip: !enabled && "set TEST_RTC=1 (tests/rtc/run.sh)" }, () => {
    let app: RealApp;
    let origin: string;
    let workDir: string;
    let roomId: string;
    const people: Person[] = [];
    let failed = false;

    before(async () => {
        // Fixture files (tones and colours) for the fake capture devices.
        workDir = mkdtempSync(join(tmpdir(), "tumult-rtc-media-"));
        // The REAL client with native voice on.
        app = await serveRealApp({ port: PORT, voice: true });
        origin = app.origin;

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
        roomId = await createDmAs(alice, bob.userId);
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, bob.accessToken, {});

        for (const [i, spec] of PEOPLE.entries()) {
            const account = accounts[i]!;
            const wav = join(workDir, `${spec.name}.wav`);
            const y4m = join(workDir, `${spec.name}.y4m`);
            writeTone(wav, spec.tone);
            writeColour(y4m, spec.colour);
            // One browser per person: the fake-capture files are browser-wide flags.
            const browser = await chromium.launch({ args: fakeCaptureArgs(wav, y4m) });
            const processingOff = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
            const device = await openDevice(browser, spec.name, account, {
                origin,
                permissions: ["microphone", "camera"],
                initScript: `localStorage.setItem("tumult.voice.settings", ${JSON.stringify(JSON.stringify(processingOff))});\n${CAPTURE_REMOTE_TRACKS}`,
            });
            people.push({ ...spec, ...device, userId: account.userId, accessToken: account.accessToken, browser });
        }
    });

    after(async () => {
        if (failed) {
            await saveArtifacts("rtc-media", people);
        }
        for (const p of people) await p.browser.close().catch(() => {});
        await app?.close();
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
