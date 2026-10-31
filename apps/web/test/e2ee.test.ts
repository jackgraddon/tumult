/**
 * Encryption trust flows through the real app, one account on three devices,
 * against the real homeserver in `tests/rtc/` (see support/real-app.ts):
 *
 *  1. Device A sets up recovery from the banner. Its recovery key is shown once,
 *     and A must end up part of a verified identity (cross-signing ready). A
 *     then sends a message in an encrypted room.
 *  2. Device B, a new sign-in, verifies against A by comparing emojis: both
 *     screens must show the same emojis, both confirm, and B must become part
 *     of the identity; A must list B as verified.
 *  3. Device C, another new sign-in, enters the recovery key: the backup must
 *     unlock, C must become verified, and A's earlier message — sent before C
 *     existed, so C was never sent its key — must decrypt.
 *
 * These were manual-only (AGENTS.md: "No crypto in Node: verification / 4S
 * paths are manual against matrix.jackg.cc"): the Rust crypto is WASM and only
 * runs in a browser.
 *
 * Skips unless `TEST_RTC=1` (set by tests/rtc/run.sh). On failure, screenshots
 * and console logs land in `apps/web/test-results/e2ee/`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { chromium, type Browser, type Page } from "playwright";

import { BASE, api, enabled, login, openDevice, poll, register, saveArtifacts, serveRealApp, type Device, type RealApp } from "./support/real-app.ts";

const PORT = 4176;
const IDENTITY_READY = "This device is part of your verified identity.";

async function openSettingsTab(page: Page, tab: string): Promise<void> {
    if (!(await page.locator(".tumult-settings").isVisible())) {
        await page.locator(".tumult-userbar-gear").click();
        await page.locator(".tumult-settings").waitFor({ timeout: 10_000 });
    }
    await page.getByRole("tab", { name: tab, exact: true }).click();
}

async function closeSettings(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await page.locator(".tumult-settings").waitFor({ state: "hidden", timeout: 10_000 });
}

/** The Security page's status rows, re-opened each read so a stale page cannot pass or fail us. */
async function securityRows(page: Page): Promise<string> {
    await openSettingsTab(page, "My Account");
    await openSettingsTab(page, "Security");
    const rows = page.locator(".tumult-security-rows");
    await rows.waitFor({ timeout: 10_000 });
    return (await rows.textContent()) ?? "";
}

describe("encryption trust flows through the real app", { skip: !enabled && "set TEST_RTC=1 (tests/rtc/run.sh)" }, () => {
    let app: RealApp;
    let browser: Browser;
    let roomId: string;
    let secret: string;
    let recoveryKey = "";
    let a: Device;
    const devices: Device[] = [];
    let failed = false;

    /** Mark the run failed (for artifacts) and rethrow. */
    async function guard(run: () => Promise<void>): Promise<void> {
        try {
            await run();
        } catch (error) {
            failed = true;
            throw error;
        }
    }

    async function signInNew(name: string): Promise<Device> {
        const device = await openDevice(browser, name, await login(a.account.userId));
        devices.push(device);
        await device.page.goto(`${app.origin}/dms/${encodeURIComponent(roomId)}`, { waitUntil: "load" });
        await device.page.waitForSelector(".tumult-shell", { timeout: 60_000 });
        return device;
    }

    before(async () => {
        app = await serveRealApp({ port: PORT });
        browser = await chromium.launch();
        const suffix = Date.now().toString(36);
        secret = `before you arrived ${suffix}`;
        const carol = await register(`carol-${suffix}`);
        ({ room_id: roomId } = await api<{ room_id: string }>("POST", "/_matrix/client/v3/createRoom", carol.accessToken, {
            name: `Diary ${suffix}`,
            preset: "private_chat",
            initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
        }));
        a = await openDevice(browser, "device-a", carol);
        devices.push(a);
    });

    after(async () => {
        if (failed) await saveArtifacts("e2ee", devices);
        await browser?.close();
        await app?.close();
    });

    it("sets up recovery on the first device, which then holds the account's identity", { timeout: 180_000 }, () =>
        guard(async () => {
            await a.page.goto(`${app.origin}/dms/${encodeURIComponent(roomId)}`, { waitUntil: "load" });
            await a.page.waitForSelector(".tumult-shell", { timeout: 60_000 });

            await a.page.getByRole("button", { name: "Set up recovery" }).click({ timeout: 60_000 });
            await a.page.getByRole("button", { name: /Enter backup/ }).click();
            const key = a.page.locator(".tumult-recovery-key");
            await key.waitFor({ timeout: 60_000 });
            recoveryKey = ((await key.textContent()) ?? "").trim();
            assert.ok(recoveryKey.length > 40, `no recovery key shown: "${recoveryKey}"`);
            await a.page.getByRole("button", { name: "I've saved it" }).click();
            await a.page.locator(".tumult-security-banner").waitFor({ state: "detached", timeout: 60_000 });

            await poll(`device A never became part of a verified identity`, () => securityRows(a.page), (t) => t.includes(IDENTITY_READY), 60_000);
            await closeSettings(a.page);

            const composer = a.page.getByPlaceholder("Send a message");
            await composer.fill(secret);
            await composer.press("Enter");
            await a.page.locator(".tumult-timeline-pane").getByText(secret).waitFor({ timeout: 30_000 });

            // Device C must later open this message from the backup alone, and
            // backing a key up is asynchronous: the Rust crypto uploads in a
            // loop that starts after a random delay of up to 10 s (seen on CI:
            // C asked before A's upload and got 404). So wait until the
            // server's backup really holds a key for this room — read through
            // the backup API — and if it never does, that is the bug.
            const { version } = await api<{ version: string }>("GET", "/_matrix/client/v3/room_keys/version", a.account.accessToken);
            await poll(
                "device A never backed up the message's key",
                async () => {
                    const res = await fetch(
                        `${BASE}/_matrix/client/v3/room_keys/keys/${encodeURIComponent(roomId)}?version=${encodeURIComponent(version)}`,
                        { headers: { Authorization: `Bearer ${a.account.accessToken}` } },
                    );
                    if (!res.ok) return 0;
                    return Object.keys(((await res.json()) as { sessions?: Record<string, unknown> }).sessions ?? {}).length;
                },
                (sessions) => sessions > 0,
                60_000,
            );
        }),
    );

    it("verifies a second device by comparing emojis with the first", { timeout: 240_000 }, () =>
        guard(async () => {
            const b = await signInNew("device-b");
            await b.page.getByRole("button", { name: "Enter recovery key" }).click({ timeout: 60_000 });
            await b.page.getByRole("button", { name: /Use another device/ }).click();

            // A's app opens the request on its own: the user must not hunt for it.
            await a.page.getByText("Verification request").waitFor({ timeout: 60_000 });
            await a.page.getByRole("button", { name: "Accept" }).click();

            const emojiA = a.page.locator(".tumult-sas-emoji");
            const emojiB = b.page.locator(".tumult-sas-emoji");
            await emojiA.waitFor({ timeout: 60_000 });
            await emojiB.waitFor({ timeout: 60_000 });
            const shownA = ((await emojiA.textContent()) ?? "").trim();
            const shownB = ((await emojiB.textContent()) ?? "").trim();
            assert.ok(shownA.length > 0, "no emojis shown");
            assert.equal(shownB, shownA, "the two devices must show the same emojis");

            await a.page.getByRole("button", { name: "They match" }).click();
            await b.page.getByRole("button", { name: "They match" }).click();
            for (const d of [a, b]) await d.page.getByText("This device is now verified").waitFor({ timeout: 60_000 });
            for (const d of [a, b]) await d.page.getByRole("button", { name: "Done" }).click();

            await poll(`device B never became part of the verified identity`, () => securityRows(b.page), (t) => t.includes(IDENTITY_READY), 90_000);
            await closeSettings(b.page);

            // And the first device agrees: B is listed as verified.
            await poll(
                `device A does not list device B as verified`,
                async () => {
                    await openSettingsTab(a.page, "Security");
                    await openSettingsTab(a.page, "My Account");
                    // The status line alone: the row also holds the device name,
                    // which runs into it ("LXLBYUTSGXVerified · …").
                    const row = a.page.locator(".tumult-account-device", { hasText: b.account.deviceId }).first();
                    return ((await row.locator(".tumult-account-device-detail").textContent({ timeout: 10_000 })) ?? "").trim();
                },
                (detail) => detail.startsWith("Verified ·"),
                60_000,
            );
            await closeSettings(a.page);
        }),
    );

    it("restores encrypted history on a third device from the recovery key", { timeout: 240_000 }, () =>
        guard(async () => {
            assert.ok(recoveryKey, "needs the key from the first test");
            const c = await signInNew("device-c");

            await c.page.getByRole("button", { name: "Enter recovery key" }).click({ timeout: 60_000 });
            await c.page.getByRole("button", { name: /Enter backup/ }).click();
            await c.page.locator("#tumult-recovery-input").fill(recoveryKey);
            await c.page.getByRole("button", { name: "Unlock backup" }).click();
            const status = c.page.getByText(/Backup unlocked/);
            await status.waitFor({ timeout: 90_000 });
            assert.match((await status.textContent()) ?? "", /this device is now verified/, "the recovery key should also verify the device");
            await c.page.getByRole("button", { name: "Done" }).click();

            // The message predates this device, so only the backup can open it.
            await c.page.locator(".tumult-timeline-pane").getByText(secret).waitFor({ timeout: 90_000 });

            await poll(`device C never became part of the verified identity`, () => securityRows(c.page), (t) => t.includes(IDENTITY_READY), 60_000);
            await closeSettings(c.page);
        }),
    );
});
