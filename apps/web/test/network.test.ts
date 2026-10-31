/**
 * Losing the network and getting it back, through the real app against the
 * real homeserver in `tests/rtc/` (see support/real-app.ts).
 *
 * AGENTS.md: "UI must show connection state, including network-kill +
 * reconnect." Nothing tested it. Here one device drops off the network
 * mid-session (Playwright `setOffline`, which fails every request the page
 * makes) and the test checks the four things a user relies on:
 *
 *  1. the app SAYS it is offline (the connection banner), and how quickly;
 *  2. the banner clears once the network is back;
 *  3. a message someone else sent during the outage arrives (catch-up);
 *  4. a message the user sent WHILE offline reaches the server afterwards —
 *     it is neither silently lost nor left looking sent when it was not.
 *
 * Skips unless `TEST_RTC=1` (set by tests/rtc/run.sh). On failure, screenshots
 * and console logs land in `apps/web/test-results/network/`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { chromium, type Browser } from "playwright";

import { api, enabled, openDevice, poll, register, saveArtifacts, serveRealApp, type Account, type Device, type RealApp } from "./support/real-app.ts";

const PORT = 4177;
const BANNER = ".tumult-banner";

/** Plain-text bodies in the room, oldest first, read from the server — the truth the UI must match. */
async function serverBodies(account: Account, roomId: string): Promise<string[]> {
    const page = await api<{ chunk: { type: string; content: { body?: string } }[] }>(
        "GET",
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`,
        account.accessToken,
    );
    return page.chunk.filter((e) => e.type === "m.room.message").map((e) => e.content.body ?? "").reverse();
}

describe("losing the network and getting it back", { skip: !enabled && "set TEST_RTC=1 (tests/rtc/run.sh)" }, () => {
    let app: RealApp;
    let browser: Browser;
    let roomId: string;
    let erin: Account;
    let device: Device;
    let suffix: string;
    let failed = false;

    async function guard(run: () => Promise<void>): Promise<void> {
        try {
            await run();
        } catch (error) {
            failed = true;
            throw error;
        }
    }

    before(async () => {
        app = await serveRealApp({ port: PORT });
        browser = await chromium.launch();
        suffix = Date.now().toString(36);
        const dana = await register(`dana-${suffix}`);
        erin = await register(`erin-${suffix}`);
        // Unencrypted on purpose: this is about the connection, and the server
        // must be able to read back what arrived (check 4).
        ({ room_id: roomId } = await api<{ room_id: string }>("POST", "/_matrix/client/v3/createRoom", dana.accessToken, {
            name: `Outage ${suffix}`,
            preset: "private_chat",
            invite: [erin.userId],
        }));
        await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, erin.accessToken, {});
        device = await openDevice(browser, "dana", dana);
        await device.page.goto(`${app.origin}/dms/${encodeURIComponent(roomId)}`, { waitUntil: "load" });
        await device.page.waitForSelector(".tumult-shell", { timeout: 60_000 });
        // Settled and online before the outage: something sent now shows up.
        await api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/before-${suffix}`, erin.accessToken, {
            msgtype: "m.text",
            body: `before the outage ${suffix}`,
        });
        await device.page.locator(".tumult-timeline-pane").getByText(`before the outage ${suffix}`).waitFor({ timeout: 60_000 });
        assert.equal(await device.page.locator(BANNER).count(), 0, "no connection banner while online");
    });

    after(async () => {
        if (failed) await saveArtifacts("network", [device].filter(Boolean));
        await browser?.close();
        await app?.close();
    });

    it("says so when the network drops, then recovers and catches up", { timeout: 300_000 }, () =>
        guard(async () => {
            const page = device.page;
            const offlineAt = Date.now();
            await device.context.setOffline(true);

            // 1. The app must notice. How fast is recorded either way: the sync
            //    long-poll's own local timeout is 110 s, so an app that only
            //    learns of the outage from that timeout leaves a user looking at
            //    "connected" for nearly two minutes.
            await page.locator(BANNER).waitFor({ timeout: 150_000 });
            const detectedS = Math.round((Date.now() - offlineAt) / 1000);
            console.log(`[network] offline noticed after ${detectedS} s: "${(await page.locator(BANNER).textContent())?.trim()}"`);

            // Meanwhile: Erin writes (catch-up), and Dana sends from the dead device.
            const missed = `while you were away ${suffix}`;
            await api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/away-${suffix}`, erin.accessToken, {
                msgtype: "m.text",
                body: missed,
            });
            const offlineSend = `sent with no network ${suffix}`;
            const composer = page.getByPlaceholder("Send a message");
            await composer.fill(offlineSend);
            await composer.press("Enter");
            // It may show as sending or failed, but it must be on screen —
            // typed text that just vanishes is a lost message.
            await page.locator(".tumult-timeline-pane").getByText(offlineSend).waitFor({ timeout: 10_000 });

            await page.waitForTimeout(5_000);
            const onlineAt = Date.now();
            await device.context.setOffline(false);

            // 2. Recovery: the banner goes away.
            await page.locator(BANNER).waitFor({ state: "detached", timeout: 120_000 });
            console.log(`[network] recovered ${Math.round((Date.now() - onlineAt) / 1000)} s after the network returned`);

            // 3. Catch-up: Erin's message from the outage arrives.
            await page.locator(".tumult-timeline-pane").getByText(missed).waitFor({ timeout: 60_000 });

            // 4. The offline send reaches the server — not just the screen.
            await poll(
                "the message sent while offline never reached the server",
                () => serverBodies(erin, roomId),
                (bodies) => bodies.includes(offlineSend),
                90_000,
            );
            // And it is sent exactly once (a retry must not duplicate it).
            const copies = (await serverBodies(erin, roomId)).filter((b) => b === offlineSend).length;
            assert.equal(copies, 1, `the offline message arrived ${copies} times`);

            // Detection must be prompt: a stale "connected" for most of a
            // minute is the bug this test exists to catch.
            assert.ok(detectedS <= 45, `the app took ${detectedS} s to notice the network was gone`);
        }),
    );
});
