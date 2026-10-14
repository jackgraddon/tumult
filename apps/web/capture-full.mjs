/** Temporary visual-review capture harness (NOT part of the build; delete after). */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { firefox } from "playwright";
import { build, preview } from "vite";

const appRoot = dirname(fileURLToPath(import.meta.url));
const outDir = "dist/browser-test";
const PORT = 4185;
const OUT = process.env.OUT_DIR || "/tmp/tumult-review";
const VIEWPORT = { width: 1440, height: 900 };

const SESSION = {
    homeserverUrl: "https://fake.invalid",
    userId: "@self:fake.invalid",
    deviceId: "FAKECAPTURE",
    clientId: "fake-capture",
    accessToken: "fake-token",
};

mkdirSync(OUT, { recursive: true });
await build({ root: appRoot, mode: "fake", logLevel: "error", build: { outDir } });
const server = await preview({
    root: appRoot,
    mode: "fake",
    logLevel: "error",
    build: { outDir },
    preview: { port: PORT, strictPort: true },
});
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");

const browser = await firefox.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await context.addInitScript((session) => {
    localStorage.setItem("tumult.session", JSON.stringify(session));
}, SESSION);

const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

const shot = async (name, target) => {
    const file = join(OUT, `${name}.png`);
    if (target) await target.screenshot({ path: file });
    else await page.screenshot({ path: file });
    console.log("captured", file);
};

// --- boot ------------------------------------------------------------------
await page.goto(`${origin}/dms`, { waitUntil: "load" });
await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
await page.waitForTimeout(900);
await shot("01-dms-default");

// --- density: compact/spacious ---------------------------------------------
await page.locator("#tumult-theme-density").selectOption("compact");
await page.waitForTimeout(400);
await shot("02-density-compact");

await page.locator("#tumult-theme-density").selectOption("spacious");
await page.waitForTimeout(400);
await shot("03-density-spacious");

// return to cozy
await page.locator("#tumult-theme-density").selectOption("cozy");
await page.waitForTimeout(400);

// --- navigate to room ------------------------------------------------------
await page.locator("a.tumult-guild-item").first().click();
await page.waitForSelector(".tumult-room-item", { timeout: 10_000 });
await page.locator(".tumult-room-item").first().click();
await page.waitForSelector(".tumult-row", { timeout: 10_000 });
await page.waitForTimeout(700);
await shot("04-channel-cozy");

// --- Capture all dialogs ---------------------------------------------------

// 1. Create Space (Rail)
await page.locator("button[aria-label='Add a server']").click();
await page.waitForSelector(".tumult-dialog", { timeout: 5_000 });
await shot("05-dialog-create-space");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-dialog", { state: "hidden" });

// 2. Create Channel (Room List)
await page.locator("button[aria-label='Create a channel']").click();
await page.waitForSelector(".tumult-dialog", { timeout: 5_000 });
await shot("06-dialog-create-channel");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-dialog", { state: "hidden" });

// 3. Join Room (Room List)
await page.locator("button[aria-label='Join a room']").click();
await page.waitForSelector(".tumult-dialog", { timeout: 5_000 });
await shot("07-dialog-join-room");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-dialog", { state: "hidden" });

// 4. Create DM (Room List)
await page.locator("button[aria-label='New message']").click();
await page.waitForSelector(".tumult-dialog", { timeout: 5_000 });
await shot("08-dialog-create-dm");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-dialog", { state: "hidden" });

// 5. Room Settings (Header)
await page.locator("button[aria-label='Room settings']").click();
await page.waitForSelector(".tumult-dialog", { timeout: 5_000 });
await shot("09-dialog-room-settings");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-dialog", { state: "hidden" });

// 6. Invite (from member list)
await page.locator(".tumult-member-item").first().click();
await page.locator("button[aria-label='Invite']").click();
await page.waitForSelector(".tumult-dialog", { timeout: 5_000 });
await shot("10-dialog-invite");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-dialog", { state: "hidden" });

// 7. Leave (from room list)
await page.locator(".tumult-room-item").first().click();
await page.locator("button[aria-label='Leave']").click();
await page.waitForSelector(".tumult-dialog", { timeout: 5_000 });
await shot("11-dialog-leave-confirm");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-dialog", { state: "hidden" });

// 8. Moderation (from member list)
await page.locator(".tumult-member-item").first().click();
await page.locator("button[aria-label='Kick']").click();
await page.waitForSelector(".tumult-dialog", { timeout: 5_000 });
await shot("12-dialog-moderation-confirm");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-dialog", { state: "hidden" });

// 9. Profile (from account menu)
await page.locator(".tumult-account").click();
await page.locator(".tumult-menu-item", { hasText: "Settings" }).click();
await page.waitForSelector(".tumult-settings", { timeout: 5_000 });
await page.getByRole("tab", { name: "Appearance" }).click();
await page.waitForTimeout(300);
await shot("13-appearance-tab-final");

// 10. Settings Dialog (from profile menu toggle)
await page.locator(".tumult-account").click();
await page.locator(".tumult-menu-item", { hasText: "Settings" }).click();
await page.waitForSelector(".tumult-settings", { timeout: 5_000 });
await shot("14-settings-dialog");
await page.keyboard.press("Escape");
await page.waitForSelector(".tumult-settings", { state: "hidden" });

console.log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
await server.close();
