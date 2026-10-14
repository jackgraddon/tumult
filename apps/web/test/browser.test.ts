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
        // even though it leaves no runtime trace.
        assert.ok(
            biggest.bytes < 300_000,
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

    it("renders the login view when no session is stored", async () => {
        // A clean context: the shared one seeds a session before every load.
        const fresh = await browser.newContext({ viewport: VIEWPORT });
        const freshPage = await fresh.newPage();
        const errors: string[] = [];
        freshPage.on("pageerror", (error) => errors.push(error.message));

        await freshPage.goto(`${origin}/login`, { waitUntil: "load" });
        await freshPage.waitForSelector("main.centered", { timeout: 10_000 });
        assert.ok(await freshPage.locator("form input").count(), "the login form did not render");
        assert.deepEqual(errors, [], "the login view threw");

        await fresh.close();
    });

    it("reports no console errors across the whole run", () => {
        assert.deepEqual(consoleErrors, []);
    });
});
