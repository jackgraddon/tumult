import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Page } from "playwright";
import { firefox } from "playwright";
import type { PreviewServer } from "vite";
import { build, preview } from "vite";

/**
 * Browser smoke test for the shell, run against a `--mode fake` build.
 *
 * The fake client makes this deterministic (seed 1337, no homeserver, no
 * crypto) and the mode switch means the build carries no matrix-js-sdk at all,
 * so nothing here can accidentally depend on a live server. What it covers that
 * node tests cannot: that the app actually boots and paints in a browser, that
 * the shell's DOM survives real navigation, and that light mode really flips
 * every colour through the emitted CSS — the token pipeline end to end.
 *
 * Needs Firefox once: `pnpm exec playwright install firefox`, plus built
 * dependencies (`pnpm --filter @tumult/core build && pnpm --filter @tumult/theme
 * build`) for the theme CSS and the fake client's dist. Both are wired into the
 * package's `pretest:browser`.
 *
 * Run with: `pnpm --filter @tumult/web test:browser`.
 */

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = "dist/browser-test";
const PORT = 4183;
const VIEWPORT = { width: 1440, height: 900 };

/** A persisted session, so the router guard opens the shell rather than /login. */
const SESSION = {
    homeserverUrl: "https://fake.invalid",
    userId: "@self:fake.invalid",
    deviceId: "FAKEBROWSERTEST",
    clientId: "fake-browser-test",
    accessToken: "fake-token",
};

/** Semantic colour tokens: every one of these must differ between the two modes. */
const COLOUR_TOKENS = [
    "--surface-base",
    "--surface-pane",
    "--surface-rail",
    "--surface-hover",
    "--surface-active",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--border-default",
];

/** Mode-independent by design — brand colour and geometry. */
const STABLE_TOKENS = ["--accent", "--layout-guild-rail-width", "--layout-roomlist-width"];

/** The theme documents the Appearance-tab tests install and assert on. */
const THEME_NAME = "browser-theme";
const THEME_ACCENT = "#12ab34";
const MODES_NAME = "browser-modes";
const LIGHT_ACCENT = "#abcdef";
const DRAFT_NAME = "browser-draft";

async function readState(page: Page) {
    return page.evaluate(
        ({ colour, stable }: { colour: string[]; stable: string[] }) => {
            const root = getComputedStyle(document.documentElement);
            const tokens: Record<string, string> = {};
            for (const name of [...colour, ...stable]) {
                tokens[name] = root.getPropertyValue(name).trim();
            }

            const rail = document.querySelector(".tumult-rail");
            const shell = document.querySelector(".tumult-shell");

            return {
                theme: document.documentElement.dataset.theme ?? null,
                mode: document.documentElement.dataset.mode ?? null,
                tokens,
                railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : null,
                shellBackground: shell ? getComputedStyle(shell).backgroundColor : null,
                counts: {
                    guilds: document.querySelectorAll("a.tumult-guild-item").length,
                    dms: document.querySelectorAll(".tumult-dmlist li").length,
                    channels: document.querySelectorAll(".tumult-room-item").length,
                    messages: document.querySelectorAll(".tumult-row").length,
                    composer: Boolean(document.querySelector(".tumult-composer-input")),
                },
                overflow: {
                    scroll: document.documentElement.scrollWidth,
                    client: document.documentElement.clientWidth,
                },
            };
        },
        { colour: COLOUR_TOKENS, stable: STABLE_TOKENS },
    );
}

/** sRGB relative luminance of a resolved `rgb(...)`/`rgba(...)` colour. */
function luminance(colour: string | null): number {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colour ?? "");
    assert.ok(match, `not a resolved colour: ${colour}`);
    const [r, g, b] = [match[1], match[2], match[3]].map((channel) => {
        const value = Number(channel) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    assert.ok(r !== undefined && g !== undefined && b !== undefined);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("browser smoke test (fake client)", () => {
    let browser: Browser;
    let context: BrowserContext;
    let server: PreviewServer;
    let origin: string;
    let page: Page;
    const consoleErrors: string[] = [];

    before(async () => {
        // A build, not the dev server: dev serves unminified modules through the
        // dep optimizer, and the dep optimizer is a documented dev-only hazard
        // for the crypto WASM. `mode: "fake"` picks the fake client in
        // vite.config.ts, so this build links no matrix-js-sdk.
        await build({ root: appRoot, mode: "fake", logLevel: "error", build: { outDir } });

        server = await preview({
            root: appRoot,
            mode: "fake",
            logLevel: "error",
            build: { outDir },
            preview: { port: PORT, strictPort: true },
        });

        const local = server.resolvedUrls?.local?.[0];
        assert.ok(local, "vite preview reported no local URL");
        origin = local.replace(/\/$/, "");

        browser = await firefox.launch();
        context = await browser.newContext({ viewport: VIEWPORT });
        await context.addInitScript((session) => {
            localStorage.setItem("tumult.session", JSON.stringify(session));
        }, SESSION);

        page = await context.newPage();
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

        await page.goto(`${origin}/dms`, { waitUntil: "load" });
        await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
        // Let the fake feed publish rooms and the virtualized lists settle.
        await page.waitForTimeout(800);
    });

    after(async () => {
        await browser?.close();
        await server?.close();
    });

    it("keeps matrix-js-sdk out of the fake build", () => {
        const assets = join(appRoot, outDir, "assets");
        const chunks = readdirSync(assets)
            .filter((name) => name.endsWith(".js"))
            .map((name) => ({ name, bytes: statSync(join(assets, name)).size }))
            .sort((a, b) => b.bytes - a.bytes);

        assert.ok(chunks.length > 0, "the build produced no JS chunks");
        const biggest = chunks[0];
        assert.ok(biggest, "the build produced no JS chunks");
        // The SDK is ~890 kB raw. Anything that links it lands far past this,
        // which is how a stray all-type import from matrix-js-sdk gets caught
        // even though it leaves no runtime trace. The shell chunk legitimately
        // carries the token registry + theme editor (~30 kB) since the theming
        // surface lives in the settings dialog; the entry chunk is the one that
        // has to stay registry-free (`@tumult/theme/runtime` at boot).
        assert.ok(
            biggest.bytes < 400_000,
            `largest chunk ${biggest.name} is ${biggest.bytes} bytes — matrix-js-sdk leaked into the fake build`,
        );
    });

    it("boots the shell: rail, room list, timeline and composer", async () => {
        const state = await readState(page);
        assert.equal(state.theme, "default", "index.html should scope the default theme");
        assert.equal(state.mode, null, "dark is the default, so no data-mode attribute");
        assert.ok(state.counts.guilds > 0, "no guilds in the rail");
        assert.ok(state.counts.dms > 0, "no DM rows in the room list");
        assert.ok(state.counts.composer, "composer did not render");
        assert.equal(state.overflow.scroll, state.overflow.client, "the shell should not overflow horizontally");
    });

    it("navigates guild -> channels -> room with a timeline", async () => {
        await page.locator("a.tumult-guild-item").first().click();
        await page.waitForSelector(".tumult-room-item", { timeout: 10_000 });
        const inGuild = await readState(page);
        assert.ok(inGuild.counts.channels > 0, "selecting a guild showed no channels");
        assert.equal(inGuild.counts.dms, 0, "the DM list should give way to the guild's channels");

        await page.locator(".tumult-room-item").first().click();
        await page.waitForSelector(".tumult-row", { timeout: 10_000 });
        const inRoom = await readState(page);
        assert.ok(inRoom.counts.messages > 0, "opening a channel rendered no messages");
    });

    it("renders the demo poll through the app-installed plugin", async () => {
        // The fake timeline carries a `cc.jackg.tumult.demo.poll` event per room.
        // Its `.tumult-poll` root only exists when AppView's plugin installed
        // through PluginRegistry (manifest -> permission -> addRenderer) and the
        // timeline registry resolved it — the plugin seam end to end in a real
        // browser, not just the node tests.
        await page.waitForSelector(".tumult-poll", { timeout: 10_000 });
        const question = await page.locator(".tumult-poll-question").first().textContent();
        assert.match(question ?? "", /Lunch\?/, "the demo poll rendered without its question");
    });

    it("renders a composer action contributed by an app-installed plugin", async () => {
        // The react-last plugin registers this button through PluginRegistry's
        // `composer-actions` permission, so it only exists when the composer
        // read the per-shell ComposerActionsRegistry.
        const action = page.locator('.tumult-composer-action[aria-label="React to the last message"]');
        assert.equal(await action.count(), 1, "the composer action button did not render");
    });

    it("runs an installed slash command instead of sending it as text", async () => {
        const input = page.locator(".tumult-composer-input");

        // `/shrug` alone opens the suggestion list built from the plugin's command.
        await input.fill("/shrug");
        await page.waitForSelector(".tumult-command-suggestion", { timeout: 5_000 });
        assert.equal(await page.locator(".tumult-command-name").first().textContent(), "/shrug");

        // With args, submitting runs the command: the row carries the shrug.
        await input.fill("/shrug hi there");
        await input.press("Enter");
        const row = page.locator(".tumult-row", { hasText: "hi there ¯\\_(ツ)_/¯" });
        await row.first().waitFor({ timeout: 10_000 });
        assert.equal(await input.inputValue(), "", "the composer should clear after a command runs");
        assert.equal(
            await page.locator(".tumult-command-suggestion").count(),
            0,
            "the suggestion list should close once the command is submitted",
        );
    });

    it("runs the composer action: reacting to the newest message", async () => {
        // Wait out the fake's local echo settling `sending -> sent`, so the
        // action's filters accept the message we just sent.
        await page.waitForTimeout(600);
        await page.locator('.tumult-composer-action[aria-label="React to the last message"]').click();
        await page
            .locator(".tumult-row", { hasText: "hi there" })
            .locator('.tumult-reaction-chip[data-own="true"]')
            .first()
            .waitFor({ timeout: 10_000 });
    });

    it("renders a member decoration from an app-installed plugin", async () => {
        // Alice seeds power level 100, so the admin badge's `match` accepts her.
        await page.waitForSelector(".tumult-members", { timeout: 10_000 });
        await page.waitForSelector(".tumult-admin-badge", { timeout: 10_000 });
    });

    it("renders a plugin settings tab, styled by the plugin's injected stylesheet", async () => {
        // Two extension points in one flow. The account menu opens the shell's
        // settings dialog: the built-in "Plugins" tab (the shell registering
        // through its own host) plus the plugin's tab via `settings-tabs`. The
        // note inside that tab is styled by CSS the plugin injected via
        // `styles` — a marker custom property only resolves if that stylesheet
        // actually landed in the document.
        await page.locator(".tumult-account").click();
        await page.locator(".tumult-menu-item", { hasText: "Settings" }).click();

        const dialog = page.locator(".tumult-settings");
        await dialog.waitFor({ timeout: 10_000 });

        const tabNames = await page.locator(".tumult-settings-tab").allTextContents();
        assert.deepEqual(
            tabNames.map((name) => name.trim()),
            ["Appearance", "Plugins", "Plugin demo"],
            "the tab strip is not the shell's tabs plus the plugin's",
        );

        // The built-in tab lists what PluginRegistry actually installed. It is
        // not the first tab any more (Appearance sorts ahead of it), so it has
        // to be selected explicitly.
        await page.getByRole("tab", { name: "Plugins" }).click();
        assert.match(
            (await dialog.textContent()) ?? "",
            /cc\.jackg\.tumult\.shrug/,
            "the built-in tab did not list the installed plugins",
        );

        await page.getByRole("tab", { name: "Plugin demo" }).click();
        const note = page.locator('[data-showcase="note"]');
        await note.waitFor({ timeout: 5_000 });

        const styles = await note.evaluate((element) => {
            const computed = getComputedStyle(element);
            return {
                marker: computed.getPropertyValue("--tumult-showcase-style").trim(),
                background: computed.backgroundColor,
                radius: computed.borderTopLeftRadius,
            };
        });
        assert.equal(styles.marker, "applied", "the injected stylesheet did not apply");
        assert.notEqual(styles.background, "rgba(0, 0, 0, 0)", "injected CSS set no background");
        assert.notEqual(styles.radius, "0px", "injected CSS set no radius");

        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    });

    it("takes the guild rail width from its layout token", async () => {
        const state = await readState(page);
        const token = state.tokens["--layout-guild-rail-width"];
        assert.ok(token, "--layout-guild-rail-width is not emitted");
        assert.equal(state.railWidth, Number.parseInt(token, 10), "the rail is not sized by the token");
    });

    it("flips every colour token for light mode, and flips back", async () => {
        const dark = await readState(page);

        await page.evaluate(() => {
            document.documentElement.dataset.mode = "light";
        });
        await page.waitForTimeout(200);
        const light = await readState(page);

        assert.equal(light.mode, "light");
        for (const name of COLOUR_TOKENS) {
            assert.notEqual(light.tokens[name], dark.tokens[name], `${name} did not change in light mode`);
        }
        for (const name of STABLE_TOKENS) {
            assert.equal(light.tokens[name], dark.tokens[name], `${name} must not be mode-dependent`);
        }

        // Not just different values — actually inverted. If a surface stayed
        // dark under light mode, its luminance would not have moved.
        const darkLuminance = luminance(dark.shellBackground);
        const lightLuminance = luminance(light.shellBackground);
        assert.ok(lightLuminance > 0.5, `light mode surface is not light (luminance ${lightLuminance})`);
        assert.ok(darkLuminance < 0.1, `dark mode surface is not dark (luminance ${darkLuminance})`);

        // Reversible: no one-way state anywhere in the flip.
        await page.evaluate(() => {
            delete document.documentElement.dataset.mode;
        });
        await page.waitForTimeout(200);
        const restored = await readState(page);
        assert.deepEqual(restored.tokens, dark.tokens, "dropping data-mode did not restore dark");
    });

    // --- Appearance tab (the theme loader + UX) ------------------------------

    /** Open Settings and switch to the Appearance tab. */
    async function openAppearance(): Promise<void> {
        await page.locator(".tumult-account").click();
        await page.locator(".tumult-menu-item", { hasText: "Settings" }).click();
        await page.locator(".tumult-settings").waitFor({ timeout: 10_000 });
        await page.getByRole("tab", { name: "Appearance" }).click();
        await page.locator("#tumult-theme-active").waitFor({ timeout: 5_000 });
    }

    async function closeSettings(): Promise<void> {
        await page.keyboard.press("Escape");
        await page.locator(".tumult-settings").waitFor({ state: "hidden", timeout: 5_000 });
    }

    /** Paste a document into the Install box and submit it. */
    async function installTheme(document: unknown): Promise<void> {
        await page.locator("#tumult-theme-install").fill(JSON.stringify(document));
        await page.locator('[data-testid="theme-install"]').click();
        await page.waitForTimeout(150);
    }

    /** What the current document says about advanced CSS and its slots. */
    function readAdvanced() {
        return page.evaluate(() => {
            const rail = document.querySelector(".tumult-rail");
            return {
                marker: rail ? getComputedStyle(rail).getPropertyValue("--tumult-advanced-marker").trim() : "",
                slots: document.querySelectorAll('style[data-tumult-theme="advanced"]').length,
                allSlots: document.querySelectorAll("style[data-tumult-theme]").length,
            };
        });
    }

    it("installs a theme from the Appearance tab and applies it live", async () => {
        await openAppearance();
        await installTheme({ version: 1, name: THEME_NAME, tokens: { accent: THEME_ACCENT } });

        const installed = await readState(page);
        assert.equal(installed.theme, THEME_NAME, "data-theme did not follow the install");
        assert.equal(installed.tokens["--accent"], THEME_ACCENT, "the installed token did not take effect");
        // A sparse theme is a diff, not a blank canvas: base.css carries every
        // structural default, so tokens the theme omits still resolve.
        assert.ok(installed.tokens["--surface-base"], "--surface-base lost its fallback");

        assert.equal(
            await page.locator(`.tumult-appearance-row[data-theme-name="${THEME_NAME}"]`).count(),
            1,
            "the installed theme is not listed",
        );
        assert.equal(await page.locator("#tumult-theme-install").inputValue(), "", "the install box was not consumed");

        // The editor previews a draft without storing it, and abandoning the
        // draft restores the stored theme — nothing half-applied survives.
        await page.locator(`[data-theme-edit="${THEME_NAME}"]`).click();
        await page.locator("#tumult-theme-name").waitFor({ timeout: 5_000 });
        await page.locator('input[data-token="accent"]').fill("#ff8800");
        await page.waitForTimeout(150);
        assert.equal((await readState(page)).tokens["--accent"], "#ff8800", "the draft did not preview live");

        await page.locator("#tumult-theme-name").fill(DRAFT_NAME);
        await page.waitForTimeout(150);
        assert.equal((await readState(page)).theme, DRAFT_NAME, "the draft's name did not preview");

        await page.locator(".tumult-dialog-actions button", { hasText: "Cancel" }).click();
        await page.waitForTimeout(150);
        const abandoned = await readState(page);
        assert.equal(abandoned.theme, THEME_NAME, "cancelling did not restore the stored theme");
        assert.equal(abandoned.tokens["--accent"], THEME_ACCENT, "the abandoned draft left its tokens behind");
    });

    it("switches mode on a theme that declares one", async () => {
        await installTheme({
            version: 1,
            name: MODES_NAME,
            tokens: { accent: THEME_ACCENT },
            modes: { light: { accent: LIGHT_ACCENT } },
        });

        const options = await page.locator("#tumult-theme-mode option").allTextContents();
        assert.deepEqual(
            options.map((option) => option.trim()),
            ["dark", "light"],
            "the mode menu should offer exactly what the theme implements",
        );

        await page.locator("#tumult-theme-mode").selectOption("light");
        await page.waitForTimeout(150);
        const light = await readState(page);
        assert.equal(light.mode, "light");
        assert.equal(light.tokens["--accent"], LIGHT_ACCENT, "the light override did not apply");

        // Base mode means no attribute at all — it is the theme's `tokens` map.
        await page.locator("#tumult-theme-mode").selectOption("dark");
        await page.waitForTimeout(150);
        const dark = await readState(page);
        assert.equal(dark.mode, null);
        assert.equal(dark.tokens["--accent"], THEME_ACCENT);

        // Leave it on light: the reload test asserts the mode persisted too.
        await page.locator("#tumult-theme-mode").selectOption("light");
        await page.waitForTimeout(150);
    });

    it("restores the stored theme at boot, before the shell renders", async () => {
        await closeSettings();
        await page.goto(`${origin}/dms`, { waitUntil: "domcontentloaded" });

        // index.html hardcodes `data-theme="default"`, so a non-default value
        // here can only come from main.ts's boot path — the theme slot is a
        // <style> it appended, and the registry-free boot does not need the UI.
        const early = await page.evaluate(() => ({
            theme: document.documentElement.dataset.theme ?? null,
            mode: document.documentElement.dataset.mode ?? null,
            slot: document.querySelector('style[data-tumult-theme="active"]')?.textContent ?? "",
        }));
        assert.equal(early.theme, MODES_NAME, "the boot path did not apply the stored theme");
        assert.equal(early.mode, "light", "the boot path did not apply the stored mode");
        assert.match(early.slot, /data-theme="browser-modes"/, "the cached CSS was not applied at boot");

        await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
        await page.waitForTimeout(400);
        const settled = await readState(page);
        assert.equal(settled.theme, MODES_NAME);
        assert.equal(settled.tokens["--accent"], LIGHT_ACCENT);
    });

    it("applies advanced CSS behind an opt-in, and refuses external references", async () => {
        await openAppearance();
        const marker = "applied";

        await page.locator('[data-testid="theme-advanced"]').check();
        await page.locator("#tumult-theme-advanced-css").fill(`.tumult-rail { --tumult-advanced-marker: ${marker}; }`);
        await page.locator('[data-testid="theme-advanced-apply"]').click();
        await page.waitForTimeout(150);
        const applied = await readAdvanced();
        assert.equal(applied.marker, marker, "advanced CSS did not apply");
        assert.equal(applied.slots, 1, "advanced CSS should be exactly one dedicated slot");

        // A remote fetch is refused: it would be a third-party request from CSS
        // the app cannot audit, so it never reaches the document — and it does
        // not silently replace the CSS that is already applied.
        await page.locator("#tumult-theme-advanced-css").fill("@import url(https://evil.invalid/t.css);");
        await page.locator('[data-testid="theme-advanced-apply"]').click();
        await page.waitForTimeout(150);
        assert.ok(await page.locator(".tumult-dialog-error").count() > 0, "the refusal was not explained");
        assert.equal((await readAdvanced()).marker, marker, "refused CSS replaced the applied CSS");

        // Turning the opt-in off takes it out of the document immediately.
        await page.locator('[data-testid="theme-advanced"]').uncheck();
        await page.waitForTimeout(150);
        assert.equal((await readAdvanced()).marker, "", "advanced CSS survived the opt-in being turned off");
    });

    it("refuses an invalid theme and stores nothing", async () => {
        await page.locator("#tumult-theme-install").fill(
            JSON.stringify({ version: 1, name: "evil", tokens: { accent: "red; } html { display: none" } }),
        );
        await page.locator('[data-testid="theme-install"]').click();
        await page.waitForTimeout(150);

        assert.ok(await page.locator(".tumult-dialog-error").count() > 0, "the refusal was not explained");
        assert.equal((await readState(page)).theme, MODES_NAME, "an invalid theme was applied anyway");
        assert.equal(
            await page.locator('.tumult-appearance-row[data-theme-name="evil"]').count(),
            0,
            "an invalid theme was listed",
        );
    });

    it("resets to the built-in theme", async () => {
        await page.locator('[data-testid="theme-reset"]').click();
        await page.locator('[data-testid="theme-reset-confirm"]').click();
        await page.waitForTimeout(200);

        const state = await readState(page);
        assert.equal(state.theme, "default");
        assert.equal(state.mode, null);
        assert.equal(await page.locator(".tumult-appearance-row").count(), 0, "themes survived a reset");

        await closeSettings();
        assert.equal(
            (await readAdvanced()).allSlots,
            0,
            "a theme stylesheet survived the reset",
        );
    });

    it("renders the login view when no session is stored", async () => {
        // A clean context: the shared one seeds a session before every load.
        const fresh = await browser.newContext({ viewport: VIEWPORT });
        const freshPage = await fresh.newPage();
        const errors: string[] = [];
        freshPage.on("pageerror", (error) => errors.push(error.message));

        await freshPage.goto(`${origin}/login`, { waitUntil: "load" });
        await freshPage.waitForSelector("main.tumult-page", { timeout: 10_000 });
        assert.ok(await freshPage.locator("form input").count(), "the login form did not render");

        // The pre-shell surfaces are the app's own chrome and are token-driven
        // like the shell, so a value that does not resolve shows up here: an
        // unresolved surface token leaves the card transparent, an unresolved
        // `border:` declaration falls back to the browser's own input chrome.
        const readAuth = () =>
            freshPage.evaluate(() => {
                const card = document.querySelector(".tumult-page-card");
                const input = document.querySelector(".tumult-page-input");
                const cardStyle = card ? getComputedStyle(card) : null;
                const inputStyle = input ? getComputedStyle(input) : null;
                return {
                    cardBackground: cardStyle?.backgroundColor ?? "",
                    cardShadow: cardStyle?.boxShadow ?? "",
                    // The longhands, not the shorthand: an unresolved var makes
                    // the whole `border:` declaration invalid at computed-value
                    // time, so the input falls back to the UA default (`inset`).
                    inputBorderStyle: inputStyle?.borderTopStyle ?? "",
                    inputBorderWidth: inputStyle?.borderTopWidth ?? "",
                    font: getComputedStyle(document.documentElement).fontFamily,
                };
            });

        const dark = await readAuth();
        assert.notEqual(dark.cardBackground, "rgba(0, 0, 0, 0)", "the login card surface did not resolve");
        assert.notEqual(dark.cardShadow, "none", "the login card shadow did not resolve");
        assert.equal(dark.inputBorderStyle, "solid", "the login input border did not resolve to the token rule");
        assert.equal(dark.inputBorderWidth, "1px", "the login input border width did not resolve to the token");
        assert.match(dark.font, /system-ui/, "the document font did not come from the font token");

        // Light mode reaches the auth surface through the same tokens, not a
        // second hardcoded palette.
        await freshPage.evaluate(() => {
            document.documentElement.dataset.mode = "light";
        });
        const light = await readAuth();
        assert.notEqual(light.cardBackground, dark.cardBackground, "light mode did not reach the auth surface");

        assert.deepEqual(errors, [], "the login view threw");

        await fresh.close();
    });

    it("reports no console errors across the whole run", () => {
        assert.deepEqual(consoleErrors, []);
    });
});
