import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { firefox } from "playwright";
import type { PreviewServer } from "vite";
import { build, preview } from "vite";

// The app's own colour conversion, so the luminance checks below agree with
// what the theme editor believes a value resolves to.
import { toHexColor } from "../../../packages/ui/src/theme/color.ts";

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
/** Repo root — the production `packages/*/dist` live here, two levels up. */
const repoRoot = dirname(dirname(appRoot));
const outDir = "dist/browser-test";
const PORT = 4183;
const VIEWPORT = { width: 1440, height: 900 };

/**
 * What must never appear in the fake build. Matched against resolved module
 * ids (absolute paths), so it catches the package itself and the crypto WASM
 * glue it pulls in — the two things the fake client exists to avoid linking.
 */
const SDK_MODULE = /[/\\]node_modules[/\\]\.pnpm[/\\](matrix-js-sdk|@matrix-org\+)/;

/** A persisted session, so the router guard opens the shell rather than /login. */
const SESSION = {
    homeserverUrl: "https://fake.invalid",
    userId: "@self:fake.invalid",
    deviceId: "FAKEBROWSERTEST",
    clientId: "fake-browser-test",
    accessToken: "fake-token",
};

/**
 * Semantic colour tokens: every one of these must differ between the two modes.
 * `--accent` included: the built-in theme uses a light brand colour in dark
 * mode and a darker one in light mode (white text has to stay readable on it),
 * so the brand is mode-dependent like everything else.
 */
const COLOUR_TOKENS = [
    "--accent",
    "--accent-hover",
    "--accent-contrast",
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

/** Mode-independent by design — geometry. */
const STABLE_TOKENS = ["--layout-guild-rail-width", "--layout-roomlist-width"];

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

/**
 * sRGB relative luminance of a CSS colour.
 *
 * The theme authors in OKLCH, and a computed colour serializes in the space it
 * was authored in (`oklch(0.16 0 0)`, not `rgb(…)`), so this resolves through
 * the same conversion the theme editor uses — `packages/ui/src/theme/color.ts` —
 * instead of assuming `rgb()` and failing on a colour the app can display.
 */
function luminance(colour: string | null): number {
    const hex = toHexColor(colour ?? "");
    assert.ok(hex, `not a resolvable colour: ${colour}`);
    const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => {
        const value = Number.parseInt(part, 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    assert.ok(r !== undefined && g !== undefined && b !== undefined);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Map each emitted chunk's file name to the module ids that went into it.
 *
 * Every Rollup output chunk carries `modules`, keyed by the RESOLVED absolute
 * path of each module in the graph. That is the build's own record of what it
 * linked, so asserting on it asks the real question — "is matrix-js-sdk in this
 * fake bundle?" — rather than inferring the answer from a byte count.
 *
 * Two reasons the size proxy this replaced was worth deleting. It only fails
 * once a leak is big enough to cross the threshold, so a chunk that grows for
 * legitimate reasons keeps tripping it while a *type-only* leak that survives
 * tree-shaking at near-zero bytes slides under; and it reports a number, which
 * says nothing about what leaked. This reports the offending module ids.
 */
function collectModules(result: unknown): Map<string, Set<string>> {
    // `build()` returns one output for a single config, but an array when the
    // config forks — handle both rather than assume.
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{
        output: Array<{ type: string; fileName?: string; modules?: Record<string, unknown> }>;
    }>;
    const byChunk = new Map<string, Set<string>>();
    for (const output of outputs) {
        for (const item of output.output) {
            if (item.type !== "chunk" || item.fileName === undefined) continue;
            byChunk.set(item.fileName, new Set(Object.keys(item.modules ?? {})));
        }
    }
    return byChunk;
}

describe("browser smoke test (fake client)", () => {
    let browser: Browser;
    let context: BrowserContext;
    let server: PreviewServer;
    let origin: string;
    let page: Page;
    /** Module ids per chunk from the build, for the SDK-absence assertion. */
    let builtModules: Map<string, Set<string>>;
    const consoleErrors: string[] = [];

    before(async () => {
        // A build, not the dev server: dev serves unminified modules through the
        // dep optimizer, and the dep optimizer is a documented dev-only hazard
        // for the crypto WASM. `mode: "fake"` picks the fake client in
        // vite.config.ts, so this build links no matrix-js-sdk.
        const result = await build({ root: appRoot, mode: "fake", logLevel: "error", build: { outDir } });
        builtModules = collectModules(result);

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
        // `--mode fake` swaps `@chat-impl` for the fake client, but that alone
        // does not prove the SDK is gone: an inline `type` specifier
        // (`import { type X } from "matrix-js-sdk"`) is NOT erased by the SFC
        // compiler, and under `verbatimModuleSyntax` tsc emits an all-type
        // braces import as the side-effect `import {} from "matrix-js-sdk"` —
        // which links the whole package. That shipped once and took the fake
        // chunk from 17 kB to 839 kB while every other gate stayed green.
        //
        // Assert on module IDENTITY, not on bundle size. The size gate this
        // replaced only fired once a leak was big enough to cross a byte
        // threshold, so legitimate growth kept tripping it while a leak that
        // tree-shook to nothing slipped under — and it reported a number
        // instead of naming what leaked.
        assert.ok(builtModules.size > 0, "the build reported no chunks to inspect");

        // A stale `packages/core/dist` would satisfy this assertion while
        // proving nothing, because the fake build imports the BUILT
        // `@tumult/core/fake`, not its sources. `pretest:browser` rebuilds core,
        // so this only trips when the file is run directly (or a build failed
        // silently) — which is exactly when a green result would be a lie.
        const fakeSrc = join(repoRoot, "packages", "core", "src", "fake", "index.ts");
        const fakeDist = join(repoRoot, "packages", "core", "dist", "fake", "index.js");
        assert.ok(
            statSync(fakeDist).mtimeMs >= statSync(fakeSrc).mtimeMs,
            `packages/core/dist is older than its sources — run \`pnpm --filter @tumult/core build\` first, ` +
                "or this check is inspecting a stale bundle",
        );

        const leaked = new Map<string, string[]>();
        for (const [chunk, modules] of builtModules) {
            const offenders = [...modules].filter((id) => SDK_MODULE.test(id));
            if (offenders.length > 0) leaked.set(chunk, offenders);
        }

        const report = [...leaked]
            .map(([chunk, ids]) => `  ${chunk}:\n${ids.map((id) => `    ${id}`).join("\n")}`)
            .join("\n");
        assert.deepEqual(
            [...leaked.keys()],
            [],
            `matrix-js-sdk is in the fake build — use whole-statement \`import type\` (see AGENTS.md):\n${report}`,
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

    it("reserves media boxes from event info dims, so decode cannot shift the timeline", async () => {
        // The fake timeline's two newest rows are image events WITH `info`
        // dims (landscape binds the width clamp, portrait the height clamp),
        // and the fixture bytes are a fixed 100x100 SVG — so a box shaped by
        // the EVENT's dims can only come from the pre-load reservation, never
        // from the decoded image. Measured after load, which is exactly when
        // an unreserved layout would have jumped.
        await page.waitForFunction(
            () => {
                const images = Array.from(document.querySelectorAll("img.tumult-media-message-image"));
                return (
                    images.length >= 2 &&
                    images.every((img) => img.complete && img.naturalWidth > 0)
                );
            },
            undefined,
            { timeout: 10_000 },
        );
        const measured = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const images = Array.from(document.querySelectorAll("img.tumult-media-message-image")).map(
                (img) => ({
                    intrinsicW: img.style.getPropertyValue("--media-intrinsic-w"),
                    ratio: img.style.getPropertyValue("--media-intrinsic-ratio"),
                    natural: `${img.naturalWidth}x${img.naturalHeight}`,
                    box: img.getBoundingClientRect(),
                }),
            );
            const viewport = document.querySelector(".tumult-viewport");
            return {
                maxWidth: root.getPropertyValue("--media-image-max-width"),
                maxHeight: root.getPropertyValue("--media-image-max-height"),
                anchor: viewport
                    ? getComputedStyle(viewport).getPropertyValue("overflow-anchor")
                    : "MISSING",
                images,
            };
        });
        const maxWidth = parseFloat(measured.maxWidth);
        const maxHeight = parseFloat(measured.maxHeight);
        assert.ok(
            maxWidth > 0 && maxHeight > 0,
            `theme media maxes missing: ${measured.maxWidth} / ${measured.maxHeight}`,
        );
        assert.equal(measured.images.length, 2, "both seeded image fixtures should sit at the tail");
        for (const [index, img] of measured.images.entries()) {
            const width = parseFloat(img.intrinsicW);
            const ratio = parseFloat(img.ratio);
            assert.ok(width > 0 && ratio > 0, `image ${index} carries no reservation props`);
            assert.equal(img.natural, "100x100", "fixture bytes must not match the event dims");
            const expectedW = Math.min(width, maxWidth, maxHeight * ratio);
            const expectedH = expectedW / ratio;
            assert.ok(
                Math.abs(img.box.width - expectedW) < 1 && Math.abs(img.box.height - expectedH) < 1,
                `image ${index}: box ${img.box.width}x${img.box.height} != reserved ` +
                    `${expectedW}x${expectedH} (width ${width}, ratio ${ratio}, tokens ${maxWidth}x${maxHeight})`,
            );
        }
        // Both min() branches are exercised by the fixtures.
        const landscape = measured.images.find((img) => parseFloat(img.ratio) > 1);
        const portrait = measured.images.find((img) => parseFloat(img.ratio) < 1);
        assert.ok(
            landscape && Math.abs(landscape.box.width - maxWidth) < 1,
            "the landscape fixture should bind --media-image-max-width",
        );
        assert.ok(
            portrait && Math.abs(portrait.box.height - maxHeight) < 1,
            "the portrait fixture should bind --media-image-max-height",
        );
        // The virtualizer compensates row re-measures itself; native scroll
        // anchoring would apply the same shift a second time.
        assert.equal(
            measured.anchor,
            "none",
            "the timeline viewport must opt out of native scroll anchoring",
        );
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

    it("opens a workspace pane from the rail, in all three of its slots", async () => {
        // A pane is the other kind of thing the rail opens: the tile under the
        // DMs button belongs to a plugin, and clicking it hands the shell's
        // own layout (rail, tracks, chrome) over to the plugin's three slots
        // — nav, content, footer. The plugin's stylesheet (the `styles`
        // permission) is what makes the note's box visible.
        const tile = page.locator(".tumult-pane-item").first();
        await tile.waitFor({ timeout: 10_000 });
        assert.equal(
            await tile.getAttribute("aria-label"),
            "Plugin pane",
            "the pane tile did not carry the label the plugin registered",
        );

        await tile.click();

        await page.waitForSelector(".tumult-showcase-pane", { timeout: 10_000 });
        await page.waitForSelector(".tumult-showcase-nav", { timeout: 10_000 });
        await page.waitForSelector(".tumult-showcase-footer", { timeout: 10_000 });

        assert.ok(
            page.url().endsWith("/p/cc.jackg.tumult.pane-showcase"),
            `the pane did not get its own route: ${page.url()}`,
        );

        // The shell's own layout is still the shell's: the pane occupies the
        // tracks, it does not replace them.
        const nav = await page.locator(".tumult-pane-sidebar").boundingBox();
        const content = await page.locator(".tumult-pane-content").boundingBox();
        const footer = await page.locator(".tumult-pane-footer").boundingBox();
        assert.ok(nav && content && footer, "a pane slot was not rendered");
        assert.ok(nav.width > 0 && nav.height > 0, "the pane's nav slot has no size");
        assert.ok(content.width > 0 && content.height > 0, "the pane's content slot has no size");
        assert.ok(footer.height > 0, "the pane's footer slot has no size");
        // The nav is the left track, the content is the middle one, the footer
        // runs along the bottom of the middle track.
        assert.ok(nav.x < content.x, "the pane's nav is not left of its content");
        assert.ok(footer.y > content.y, "the pane's footer is not below its content");

        // The stylesheet the plugin injected is what paints the note.
        const marker = await page
            .locator('[data-showcase="pane-note"]')
            .evaluate((element) => getComputedStyle(element).getPropertyValue("--tumult-showcase-style").trim());
        assert.equal(marker, "applied", "the plugin's injected stylesheet did not reach the pane");

        // Back to a room: the pane is a view, not a mode the app gets stuck in.
        await page.locator(".tumult-dms-item").click();
        await page.waitForSelector(".tumult-room-item", { timeout: 10_000 });
        assert.equal(await page.locator(".tumult-showcase-pane").count(), 0, "the pane stayed on screen");
    });

    it("loads a workspace pane directly by URL (reload / shared link)", async () => {
        // The pane route must render the plugin's region on a cold direct load,
        // not wait for the user to click a rail tile. The app's own boot does a
        // history.replaceState during initial navigation; tolerate the "navigation
        // interrupted" race that Playwright reports for same-document replaces.
        const cold = await browser.newContext({ viewport: VIEWPORT });
        await cold.addInitScript((session) => {
            localStorage.setItem("tumult.session", JSON.stringify(session));
        }, SESSION);
        const coldPage = await cold.newPage();
        const errors: string[] = [];
        coldPage.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
        });
        coldPage.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

        try {
            await coldPage.goto(`${origin}/p/cc.jackg.tumult.pane-showcase`, { waitUntil: "domcontentloaded" });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("interrupted by another navigation")) throw error;
        }

        await coldPage.waitForSelector(".tumult-showcase-pane", { timeout: 10_000 });
        await coldPage.waitForSelector(".tumult-showcase-nav", { timeout: 10_000 });
        await coldPage.waitForSelector(".tumult-showcase-footer", { timeout: 10_000 });
        await coldPage.waitForSelector(".tumult-pane-content", { timeout: 5_000 });

        assert.equal(coldPage.url(), `${origin}/p/cc.jackg.tumult.pane-showcase`);
        assert.equal(
            await coldPage.locator(".tumult-shell-grid").getAttribute("data-view"),
            "pane",
            "a direct pane load did not set data-view=pane",
        );
        assert.equal(
            await coldPage.locator(".tumult-timeline").count(),
            0,
            "a direct pane load showed the room timeline instead of the pane",
        );

        const nav = await coldPage.locator(".tumult-pane-sidebar").boundingBox();
        const content = await coldPage.locator(".tumult-pane-content").boundingBox();
        assert.ok(nav && content && nav.width > 0 && content.width > 0, "direct pane load did not lay out the pane slots");
        assert.ok(nav.x < content.x, "the pane nav was not left of content on a direct load");

        await coldPage.close();
        await cold.close();
    });

    it("installs a third-party plugin from a repository URL, verifying its hash", async () => {
        // The whole third-party path, end to end, with GitHub faked at the
        // network layer. A fresh context isolates the install from the tests
        // above (its own IndexedDB) and lets the routes be scoped to it.
        const isolated = await browser.newContext({ viewport: VIEWPORT });
        try {
            await isolated.addInitScript((session) => {
                window.localStorage.setItem("tumult.session", JSON.stringify(session));
            }, SESSION);

            // A minimal, valid bundle: a logic-only plugin (sandbox lane) that
            // registers a slash command. Its sha256 is computed below from the
            // exact bytes served, so the hash check is exercised for real.
            const bundle =
                "export const plugin = { manifest: { id: \"cc.example.remote\", name: \"Remote\", " +
                "version: \"1.0.0\", permissions: [\"commands\"] }, install(ctx) {} };\n";
            const encoder = new TextEncoder();
            const digest = await crypto.subtle.digest("SHA-256", encoder.encode(bundle));
            let binary = "";
            for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
            const integrity = `sha256-${Buffer.from(binary, "binary").toString("base64")}`;

            const manifest = {
                id: "cc.example.remote",
                name: "Remote",
                version: "1.0.0",
                author: "Someone",
                description: "A plugin installed from a repository.",
                permissions: ["commands"],
                entry: "plugin.js",
                integrity,
            };

            await isolated.route("**/api.github.com/repos/example/remote/releases/latest", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        tag_name: "v1.0.0",
                        assets: [
                            {
                                name: "tumult.plugin.json",
                                browser_download_url: "https://github.com/example/remote/releases/download/v1.0.0/tumult.plugin.json",
                            },
                            {
                                name: "plugin.js",
                                browser_download_url: "https://github.com/example/remote/releases/download/v1.0.0/plugin.js",
                            },
                        ],
                    }),
                }),
            );
            await isolated.route("**/api/plugin-asset**name=tumult.plugin.json**", (route) =>
                route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(manifest) }),
            );
            await isolated.route("**/api/plugin-asset**name=plugin.js**", (route) =>
                route.fulfill({ status: 200, contentType: "text/javascript", body: bundle }),
            );

            const installed = await isolated.newPage();
            await installed.goto(origin, { waitUntil: "domcontentloaded" });
            await installed.waitForSelector(".tumult-account", { timeout: 10_000 });

            await installed.locator(".tumult-account").click();
            await installed.locator(".tumult-menu-item", { hasText: "Settings" }).click();
            await installed.getByRole("tab", { name: "Plugins" }).click();

            await installed.locator("#tumult-plugin-url").fill("https://github.com/example/remote");
            await installed.getByRole("button", { name: "Check" }).click();

            // The consent screen: lane badge, the permission in plain words, and
            // the verified hash — before anything is installed.
            const consent = installed.locator(".tumult-consent");
            await consent.waitFor({ timeout: 10_000 });
            const consentText = (await consent.textContent()) ?? "";
            assert.match(consentText, /Sandboxed/, "the consent screen is missing the derived lane");
            assert.match(consentText, /slash commands/i, "the consent screen is missing permission copy");
            assert.ok(consentText.includes(integrity), "the consent screen is missing the verified hash");

            await installed.getByRole("button", { name: "Install" }).click();

            // Installed: the row appears with the lane badge and its source.
            //
            // The installed row is located by `.tumult-plugin-lane-sandbox`, NOT
            // by matching the plugin id in `.tumult-plugin`. Both the installed
            // list and the built-in list render `<li class="tumult-plugin">`, and
            // installing moves the id from one list to the other — so between the
            // click above and the record reaching the store there are momentarily
            // two matching candidates, and `hasText` can resolve to the built-in
            // node that Vue is detaching. Reading it then reports `Built in` with
            // no source, intermittently, on a loaded runner (observed at ~10-25%
            // in a repeat loop). The lane class exists only on the installed
            // branch, so it cannot match the wrong element.
            const installedRow = installed.locator(".tumult-plugin", {
                has: installed.locator(".tumult-plugin-lane-sandbox"),
            });
            await installedRow.waitFor({ timeout: 10_000 });
            // One read for both assertions: two reads could straddle a re-render
            // and disagree, which is exactly the race this replaced.
            const rowText = (await installedRow.textContent()) ?? "";
            assert.match(rowText, /Sandboxed/, "the installed row lost its lane");
            assert.match(rowText, /example\/remote/, "the installed row lost its source");
            assert.match(rowText, /cc\.example\.remote/, "the installed row is not the plugin that was installed");
        } finally {
            await isolated.close();
        }
    });

    it("takes the guild rail width from its layout token", async () => {
        const state = await readState(page);
        const token = state.tokens["--layout-guild-rail-width"];
        assert.ok(token, "--layout-guild-rail-width is not emitted");
        assert.equal(state.railWidth, Number.parseInt(token, 10), "the rail is not sized by the token");
    });

    it("lays the user bar across the rail and the room list, and shrinks it with the list", async () => {
        // The bar starts INSIDE the rail (its first grid column IS the rail's
        // track, which is what keeps the avatar centred on the rail) and runs
        // to the far edge of the room list.
        await page.locator("a.tumult-guild-item").first().click();
        await page.waitForSelector(".tumult-room-item", { timeout: 10_000 });

        // Measured with locators, not a helper inside `page.evaluate`: tsx wraps
        // a named function as `__name(f, "f")` before Playwright serializes it,
        // and the page has no `__name` (see AGENTS.md).
        const bar = await page.locator(".tumult-userbar").boundingBox();
        const rail = await page.locator(".tumult-rail").boundingBox();
        const roomlist = await page.locator(".tumult-pane-roomlist").boundingBox();
        assert.ok(bar && rail && roomlist, "the user bar or its neighbours did not render");
        assert.equal(
            Math.round(bar.x),
            Math.round(rail.x),
            "the user bar does not start at the rail's edge",
        );
        assert.equal(
            Math.round(bar.x + bar.width),
            Math.round(roomlist.x + roomlist.width),
            "the user bar does not reach the room list's far edge",
        );
        assert.ok(bar.width > rail.width, "the user bar did not extend past the rail");
        // Below both panes: the room list ends where the bar starts.
        assert.ok(
            Math.round(roomlist.y + roomlist.height) <= Math.round(bar.y) + 1,
            "the room list overlaps the user bar",
        );
        assert.equal(await page.locator(".tumult-userbar-status").count(), 1, "the status line is missing");
        assert.equal(await page.locator(".tumult-userbar-gear").count(), 1, "the gear is missing");

        // Collapse the list: the bar keeps only the rail's width, and the
        // name/status/gear are gone rather than overflowing a 0-width track.
        await page.locator(".tumult-pane-toolbar button").first().click();
        await page.waitForFunction(
            () => document.querySelector(".tumult-shell-grid")?.getAttribute("data-roomlist") === "closed",
            { timeout: 5_000 },
        );

        const collapsedBar = await page.locator(".tumult-userbar").boundingBox();
        const railToken = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--layout-guild-rail-width").trim(),
        );
        assert.ok(collapsedBar, "the user bar did not survive the collapse");
        assert.equal(
            Math.round(collapsedBar.width),
            Math.round(Number.parseFloat(railToken)),
            "the collapsed user bar is not the rail's width",
        );
        assert.equal(
            await page.locator(".tumult-userbar-status").count(),
            0,
            "the status line survived the collapse",
        );
        assert.equal(await page.locator(".tumult-userbar-gear").count(), 0, "the gear survived the collapse");
        assert.equal(
            await page.locator(".tumult-account").count(),
            1,
            "the avatar should stay reachable — it owns the account menu",
        );

        await page.locator(".tumult-pane-toolbar button").first().click();
        await page.waitForFunction(
            () => document.querySelector(".tumult-shell-grid")?.getAttribute("data-roomlist") === "open",
            { timeout: 5_000 },
        );
    });

    it("sets a status from the user bar, and the bar shows it", async () => {
        // The fake starts with no status at all, so the bar shows its honest
        // "Set a status" hint; the dialog then writes through `setOwnPresence`
        // and the bar follows the published feed.
        const hint = page.locator(".tumult-userbar-status-hint");
        await hint.waitFor({ timeout: 5_000 });
        assert.equal(await hint.textContent(), "Set a status");

        await page.locator(".tumult-userbar-status").click();
        const dialog = page.locator(".tumult-dialog", { hasText: "Set a status" });
        await dialog.waitFor({ timeout: 5_000 });

        await dialog.locator('input[value="unavailable"]').check();
        await dialog.locator("#tumult-status-message").fill("Listening to Kite");
        await dialog.getByRole("button", { name: "Save" }).click();
        await dialog.waitFor({ state: "hidden", timeout: 5_000 });

        const barText = await page.locator(".tumult-userbar-status").textContent();
        assert.match(barText ?? "", /Listening to Kite/, "the user bar did not pick up the written status");
        assert.equal(
            await page.locator(".tumult-userbar-dot").getAttribute("data-presence"),
            "unavailable",
            "the presence dot did not follow the written presence",
        );

        // Reopening seeds from the live feed, so the dialog shows what was saved.
        await page.locator(".tumult-userbar-status").click();
        await dialog.waitFor({ timeout: 5_000 });
        assert.equal(await dialog.locator("#tumult-status-message").inputValue(), "Listening to Kite");
        assert.ok(await dialog.locator('input[value="unavailable"]').isChecked(), "away did not survive a reopen");

        // Empty saves clear the status: the bar goes back to the hint.
        await dialog.locator("#tumult-status-message").fill("");
        await dialog.locator('input[value="online"]').check();
        await dialog.getByRole("button", { name: "Save" }).click();
        await dialog.waitFor({ state: "hidden", timeout: 5_000 });

        await page.locator(".tumult-userbar-status-hint").waitFor({ timeout: 5_000 });
        assert.equal(
            await page.locator(".tumult-userbar-dot").getAttribute("data-presence"),
            "online",
            "the presence dot did not follow the cleared status",
        );
    });

    it("opens Settings from the user bar's gear", async () => {
        await page.locator(".tumult-userbar-gear").click();
        await page.locator(".tumult-settings").waitFor({ timeout: 10_000 });
        await page.keyboard.press("Escape");
        await page.locator(".tumult-settings").waitFor({ state: "hidden", timeout: 5_000 });
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

    /**
     * Density is a DOM attribute plus the row heights it drives. Measured off
     * real elements, not just the token string: the whole point is that the
     * attribute reaches the rows, so a theme-format change that emits the block
     * but never matches it would still fail here.
     */
    function readDensity() {
        return page.evaluate(() => {
            const roomEl = document.querySelector(".tumult-room-item");
            // The first *non-grouped* row carries the vertical padding token; a
            // grouped (continuation) row is deliberately pinned to 0, and the
            // virtualizer re-renders a different row when heights move, so the
            // padding — not the row height — is the stable thing to compare.
            const messageEl = document.querySelector('.tumult-row:not([data-grouped="true"])');
            return {
                density: document.documentElement.dataset.density ?? null,
                room: roomEl
                    ? {
                          height: Math.round(roomEl.getBoundingClientRect().height),
                          paddingTop: Math.round(Number.parseFloat(getComputedStyle(roomEl).paddingTop)),
                      }
                    : null,
                messagePaddingTop: messageEl
                    ? Math.round(Number.parseFloat(getComputedStyle(messageEl).paddingTop))
                    : null,
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
        // Installed themes only: gallery rows share the styling class.
        assert.equal(
            await page.locator(".tumult-appearance-row[data-theme-name]").count(),
            0,
            "themes survived a reset",
        );

        await closeSettings();
        assert.equal(
            (await readAdvanced()).allSlots,
            0,
            "a theme stylesheet survived the reset",
        );
    });

    // --- Density (the theme's third axis) ------------------------------------

    it("offers the built-in densities and repacks rows when one is chosen", async () => {
        // Open a timeline so there is a message row to measure, then open the
        // Appearance tab over it (the dialog is an overlay; the rows stay laid
        // out behind it).
        await page.locator(".tumult-dmlist .tumult-room-item").first().click();
        await page.waitForSelector(".tumult-row", { timeout: 10_000 });
        await page.waitForTimeout(200);

        await openAppearance();
        const options = await page.locator("#tumult-theme-density option").allTextContents();
        assert.deepEqual(
            options.map((option) => option.trim()),
            ["cozy", "compact", "spacious"],
            "the density menu should offer the theme's densities, base first",
        );

        const cozy = await readDensity();
        assert.equal(cozy.density, null, "cozy is the base density, so no data-density attribute");
        assert.ok(cozy.room && cozy.room.height > 0, "no room row to measure");
        assert.ok(cozy.messagePaddingTop !== null, "no message row to measure");

        await page.locator("#tumult-theme-density").selectOption("compact");
        await page.waitForTimeout(250);
        const compact = await readDensity();
        assert.equal(compact.density, "compact", "data-density did not follow the choice");
        assert.ok(
            compact.room && compact.room.height < cozy.room.height,
            `compact did not tighten the room list (${cozy.room?.height} -> ${compact.room?.height})`,
        );
        assert.ok(
            compact.messagePaddingTop !== null &&
                cozy.messagePaddingTop !== null &&
                compact.messagePaddingTop < cozy.messagePaddingTop,
            `compact did not tighten the timeline row (${cozy.messagePaddingTop} -> ${compact.messagePaddingTop})`,
        );
        assert.ok(
            compact.room && cozy.room && compact.room.paddingTop < cozy.room.paddingTop,
            "the density block changed the height without changing the padding token",
        );

        await page.locator("#tumult-theme-density").selectOption("spacious");
        await page.waitForTimeout(250);
        const spacious = await readDensity();
        assert.equal(spacious.density, "spacious");
        assert.ok(
            spacious.room && spacious.room.height > cozy.room.height,
            `spacious did not loosen the room list (${cozy.room?.height} -> ${spacious.room?.height})`,
        );
        assert.ok(
            spacious.messagePaddingTop !== null &&
                cozy.messagePaddingTop !== null &&
                spacious.messagePaddingTop > cozy.messagePaddingTop,
            `spacious did not loosen the timeline row (${cozy.messagePaddingTop} -> ${spacious.messagePaddingTop})`,
        );

        // Back to the base: the attribute disappears and so does the effect.
        await page.locator("#tumult-theme-density").selectOption("cozy");
        await page.waitForTimeout(250);
        const back = await readDensity();
        assert.equal(back.density, null, "choosing cozy should drop data-density");
        assert.deepEqual(back.room, cozy.room, "returning to cozy did not restore the room row");
        assert.equal(back.messagePaddingTop, cozy.messagePaddingTop, "returning to cozy did not restore the timeline row");
    });

    it("restores the stored density at boot, before the shell renders", async () => {
        // Leave a non-base density selected, then reload.
        await page.locator("#tumult-theme-density").selectOption("compact");
        await page.waitForTimeout(150);
        await closeSettings();

        await page.goto(`${origin}/dms`, { waitUntil: "domcontentloaded" });
        // index.html hardcodes no density, so a value here can only come from
        // main.ts's boot path — the same route the mode test proves.
        const early = await page.evaluate(() => document.documentElement.dataset.density ?? null);
        assert.equal(early, "compact", "the boot path did not apply the stored density");

        await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
        await page.waitForTimeout(300);
        assert.equal((await readDensity()).density, "compact");

        // Clean up: later tests should start on the base density.
        await openAppearance();
        await page.locator("#tumult-theme-density").selectOption("cozy");
        await page.waitForTimeout(150);
        await closeSettings();
    });

    it("sizes a full-width dialog field to its container, not past it", async () => {
        // The regression this guards: without a document-wide `box-sizing:
        // border-box`, a `width: 100%` field adds its own padding and border on
        // top and overflows its container. The Appearance tab's install box is
        // one of those fields, so it measures the reset end to end.
        await openAppearance();
        const fits = await page.evaluate(() => {
            const field = document.querySelector(".tumult-dialog-textarea");
            if (!field) return null;
            const parent = field.parentElement;
            if (!parent) return null;
            const parentStyle = getComputedStyle(parent);
            const contentWidth =
                parent.clientWidth -
                Number.parseFloat(parentStyle.paddingLeft) -
                Number.parseFloat(parentStyle.paddingRight);
            return { field: field.getBoundingClientRect().width, contentWidth };
        });
        assert.ok(fits, "no full-width field rendered");
        assert.ok(
            fits.field <= fits.contentWidth + 0.5,
            `a width:100% field overflowed its container (${fits.field} > ${fits.contentWidth})`,
        );

        await closeSettings();
    });

    it("floats a row's hover actions instead of resizing the row", async () => {
        // The regression this guards: the affordances used to sit in the flow
        // and be `display: none` until hover, so hovering grew the row and
        // pushed every message below it down — in a virtualized timeline that
        // moves the very thing the pointer was aiming at.
        await page.locator(".tumult-dmlist .tumult-room-item").first().click();
        await page.waitForSelector(".tumult-row", { timeout: 10_000 });
        await page.mouse.move(3, 3);
        await page.waitForTimeout(250);

        const row = page.locator(".tumult-virtual-row:has(.tumult-row-actions)").nth(2);
        await row.scrollIntoViewIfNeeded();
        await page.mouse.move(3, 3);
        await page.waitForTimeout(250);

        const measure = () =>
            row.evaluate((el) => {
                const actions = el.querySelector(".tumult-row-actions")?.getBoundingClientRect();
                const message = el.querySelector(".tumult-row")?.getBoundingClientRect();
                return {
                    height: Math.round(el.getBoundingClientRect().height),
                    overflow: actions && message ? Math.round(actions.right - message.right) : null,
                };
            });

        const before = await measure();
        const box = await row.boundingBox();
        assert.ok(box, "the row carrying hover actions is off screen");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(250);
        const after = await measure();

        assert.equal(
            after.height,
            before.height,
            `hovering changed the row height by ${after.height - before.height}px`,
        );
        assert.ok(
            after.overflow !== null && after.overflow <= 0,
            `the actions panel overflowed its row by ${after.overflow}px`,
        );
    });

    it("keeps the rail's favourites label inside the fixed-width rail", async () => {
        // The rail is a narrow, non-collapsible chrome track: as a tracked-out
        // uppercase run the band heading clipped mid-glyph, reading "FAVOURI".
        const heading = await page.locator(".tumult-rail-heading").evaluate((el) => ({
            text: (el.textContent ?? "").trim(),
            clipped: el.scrollWidth > el.clientWidth + 1,
        }));
        assert.ok(heading.text.length > 0, "the fake seed should have a favourites band to measure");
        assert.ok(!heading.clipped, `"${heading.text}" is clipped by the rail`);
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
                const rootStyle = getComputedStyle(document.documentElement);
                return {
                    cardBackground: cardStyle?.backgroundColor ?? "",
                    cardShadow: cardStyle?.boxShadow ?? "",
                    // The longhands, not the shorthand: an unresolved var makes
                    // the whole `border:` declaration invalid at computed-value
                    // time, so the input falls back to the UA default (`inset`).
                    inputBorderStyle: inputStyle?.borderTopStyle ?? "",
                    inputBorderWidth: inputStyle?.borderTopWidth ?? "",
                    font: rootStyle.fontFamily,
                    // The theme's own stack, for comparison — the document font
                    // must be this, not the UA default. Read it rather than
                    // pinning a family name: the stack is theme-owned.
                    fontToken: rootStyle.getPropertyValue("--font-sans").trim(),
                };
            });

        const dark = await readAuth();
        assert.notEqual(dark.cardBackground, "rgba(0, 0, 0, 0)", "the login card surface did not resolve");
        assert.notEqual(dark.cardShadow, "none", "the login card shadow did not resolve");
        assert.equal(dark.inputBorderStyle, "solid", "the login input border did not resolve to the token rule");
        assert.equal(dark.inputBorderWidth, "1px", "the login input border width did not resolve to the token");
        assert.equal(dark.font, dark.fontToken, "the document font did not come from the font token");

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

    // --- Shell polish: focus visibility and motion ---------------------------

    it("gives keyboard focus a ring on controls that declare none themselves", async () => {
        // The app-level `:focus-visible` floor is what covers a control like the
        // Appearance tab's selects — that SFC declares no ring of its own. Focus
        // is moved by KEYBOARD on purpose: `:focus-visible` does not match a
        // programmatic `.focus()`, so that would prove nothing.
        await openAppearance();

        let focused = "";
        for (let i = 0; i < 40 && focused !== "select#tumult-theme-active"; i += 1) {
            await page.keyboard.press("Tab");
            focused = await page.evaluate(() => {
                const el = document.activeElement;
                return el instanceof HTMLElement ? `${el.tagName.toLowerCase()}#${el.id}` : "";
            });
        }
        assert.equal(focused, "select#tumult-theme-active", "the theme select was not reachable by keyboard");

        const ring = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el) return null;
            const style = getComputedStyle(el);
            return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
        });
        // `solid`/`2px` is the token's signature: the browser's own ring is
        // `auto` and 1px or 5px wide, so both of these say the rule won.
        assert.equal(ring?.style, "solid", "the focused control got no focus ring");
        assert.equal(ring?.width, "2px", "the focus ring width did not come from the token");
        assert.notEqual(ring?.color, "rgba(0, 0, 0, 0)", "the focus ring colour did not resolve");

        await closeSettings();
    });

    it("zeroes transitions when the system prefers reduced motion", async () => {
        const withSession = async (reducedMotion: "reduce" | "no-preference") => {
            const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion });
            await context.addInitScript((session) => {
                localStorage.setItem("tumult.session", JSON.stringify(session));
            }, SESSION);
            const target = await context.newPage();
            await target.goto(`${origin}/dms`, { waitUntil: "load" });
            await target.waitForSelector(".tumult-room-item", { timeout: 20_000 });
            return { context, target };
        };
        const durations = (target: Page) =>
            target
                .locator(".tumult-room-item")
                .first()
                .evaluate((el) => getComputedStyle(el).transitionDuration);

        const calm = await withSession("reduce");
        const busy = await withSession("no-preference");
        try {
            const reduced = await durations(calm.target);
            assert.ok(
                reduced.split(",").every((part) => part.trim() === "0s"),
                `reduced motion left a transition running (${reduced})`,
            );
            // The control: the same row under the default preference really does
            // carry the token, so the zero above is the media query's doing and
            // not a transition that was never there.
            const normal = await durations(busy.target);
            assert.ok(
                normal.split(",").some((part) => Number.parseFloat(part) > 0),
                `the default transition token is not applied at all (${normal})`,
            );
        } finally {
            await calm.context.close();
            await busy.context.close();
        }
    });

    // --- Message context menu ------------------------------------------------

    /**
     * Right-click the row containing `text` and wait for the message menu. A
     * real right-click, not a synthetic `contextmenu`: Reka opens on the event
     * and anchors the menu at the pointer.
     */
    async function openMessageMenu(text: string): Promise<void> {
        const row = page.locator(".tumult-virtual-row", { hasText: text }).first();
        await row.scrollIntoViewIfNeeded();
        const box = await row.boundingBox();
        assert.ok(box, `no measurable row for "${text}"`);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
        await page.waitForSelector(".tumult-message-menu", { timeout: 5_000 });
    }

    /** One item of the open message menu, matched by its label. */
    function menuItem(label: string) {
        return page.locator(".tumult-message-menu .tumult-menu-item", { hasText: label });
    }

    it("opens a message context menu, gating moderation on the room's power levels", async () => {
        // Any guild channel room carries the full roster (alice 100, bob 50,
        // carol 0, we are 100), so both sides of the moderation gate are
        // reachable from a single timeline.
        await page.locator("a.tumult-guild-item").first().click();
        await page.waitForSelector(".tumult-room-item", { timeout: 10_000 });
        await page.locator(".tumult-room-item").first().click();
        await page.waitForSelector(".tumult-row", { timeout: 10_000 });

        // Alice sits at our own level (100): there is nothing to moderate.
        await openMessageMenu("react to this");
        for (const label of [
            "Add reaction",
            "Reply",
            "Copy text",
            "Copy link",
            "Copy message ID",
            "View source",
        ]) {
            assert.ok(await menuItem(label).count() > 0, `the menu is missing "${label}"`);
        }
        assert.equal(
            await menuItem("Delete message").count(),
            0,
            "an equal-ranked sender must not offer a moderation delete",
        );
        const quickReactions = page.locator(
            ".tumult-message-menu .tumult-quick-reactions .tumult-reaction-pick",
        );
        assert.equal(
            await quickReactions.count(),
            4,
            "the inline quick-reaction row should carry four emoji",
        );
        // The menu lives in a body-level portal, so this also proves the row's
        // SCOPED styles travel with it (the menu chrome is global CSS).
        assert.equal(
            await page
                .locator(".tumult-message-menu .tumult-quick-reactions")
                .evaluate((el) => getComputedStyle(el).display),
            "flex",
            "the quick-reaction row lost its scoped layout",
        );
        await page.keyboard.press("Escape");
        await page.waitForSelector(".tumult-message-menu", { state: "detached", timeout: 5_000 });

        // Bob sits below us (50): the delete appears, and it looks destructive.
        await openMessageMenu("Unsupported event");
        assert.equal(
            await menuItem("Delete message").count(),
            1,
            "a lower-ranked sender must offer Delete",
        );
        // `evaluate` on a locator throws unless it resolves to one element, so
        // this also pins the item down. Compare computed colours, not token
        // names: the theme authors colours in oklch.
        const dangerColour = await menuItem("Delete message").evaluate(
            (el) => getComputedStyle(el).color,
        );
        const plainColour = await menuItem("Copy text").evaluate(
            (el) => getComputedStyle(el).color,
        );
        assert.notEqual(dangerColour, plainColour, "the destructive item must stand out");

        // Escape must leave no menu behind for the next test.
        await page.keyboard.press("Escape");
        await page.waitForSelector(".tumult-message-menu", { state: "detached", timeout: 5_000 });
    });

    it("reacts and inspects a message through the menu", async () => {
        // Submenu: nested one level, opened by hover like a user would.
        await openMessageMenu("react to this");
        await menuItem("Add reaction").hover();
        await page.waitForSelector(".tumult-reaction-grid", { timeout: 5_000 });
        const palette = page.locator(".tumult-reaction-grid .tumult-reaction-pick");
        assert.equal(await palette.count(), 8, "the submenu should carry the full palette");
        // 🎉 is deliberately not one of the fixture's reactions.
        await palette.filter({ hasText: /^🎉$/ }).click();

        const reactedRow = page.locator(".tumult-virtual-row", { hasText: "react to this" }).first();
        await reactedRow.locator(".tumult-reaction-chip", { hasText: "🎉" }).waitFor({ timeout: 5_000 });

        // View source: the row-local dialog over the shared dialog chrome.
        await openMessageMenu("react to this");
        // Copying is the one item whose result cannot be read back in a
        // headless browser; a failure logs a console error, which the next
        // test fails on — so it is asserted, just indirectly.
        await menuItem("Copy link").click();
        await openMessageMenu("react to this");
        await menuItem("View source").click();
        const dialog = page.locator(".tumult-dialog");
        await dialog.waitFor({ timeout: 5_000 });
        assert.equal(
            (await dialog.locator(".tumult-dialog-title").textContent())?.trim(),
            "Message source",
        );
        const source = (await dialog.locator(".tumult-source-json").textContent()) ?? "";
        assert.ok(source.includes('"m.room.message"'), `unexpected source payload: ${source}`);
        assert.ok(source.includes('"react to this"'), `source should carry the body: ${source}`);
        // An unstyled dialog still renders its text, so prove the shared
        // `.tumult-dialog` chrome reached this row-local instance.
        assert.notEqual(
            await dialog.evaluate((el) => getComputedStyle(el).backgroundColor),
            "rgba(0, 0, 0, 0)",
            "the source dialog lost its chrome",
        );
        await dialog.locator(".tumult-dialog-button").click();
        await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    });

    it("confirms, then deletes a message from the menu when we outrank its sender", async () => {
        // In a DM the partner sits at level 0, so what the menu offers is the
        // moderation path rather than the own-message one.
        await page.goto(`${origin}/dms`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
        await page.locator(".tumult-dmlist .tumult-room-item", { hasText: "Alice" }).first().click();
        await page.waitForSelector(".tumult-row", { timeout: 10_000 });

        const tombstones = () =>
            page
                .locator(".tumult-virtual-row .tumult-text-message", {
                    hasText: "Message deleted.",
                })
                .count();
        const before = await tombstones();
        const stillThere = () =>
            page.locator(".tumult-virtual-row", { hasText: "react to this" }).count();

        // Redaction is permanent, so the item opens a confirm rather than
        // deleting straight away.
        await openMessageMenu("react to this");
        await menuItem("Delete message").click();
        const dialog = page.locator(".tumult-dialog");
        await dialog.waitFor({ timeout: 5_000 });
        assert.equal(
            (await dialog.locator(".tumult-dialog-title").textContent())?.trim(),
            "Delete message?",
        );
        assert.equal(await stillThere(), 1, "the message must survive until the confirm");

        // Backing out leaves the message alone.
        await dialog.locator("button", { hasText: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden", timeout: 5_000 });
        assert.equal(await stillThere(), 1, "cancel must not delete anything");

        await openMessageMenu("react to this");
        await menuItem("Delete message").click();
        await dialog.waitFor({ timeout: 5_000 });
        await dialog.locator("button", { hasText: "Delete" }).click();

        // The redaction tombstones the row we opened the menu on: no rendered
        // row carries its body any more, and one more tombstone is on screen.
        await page.waitForFunction(
            (text) =>
                !Array.from(document.querySelectorAll(".tumult-virtual-row")).some((row) =>
                    (row.textContent ?? "").includes(text),
                ),
            "react to this",
            { timeout: 5_000 },
        );
        assert.equal(
            await tombstones(),
            before + 1,
            "the deleted message should render as a tombstone",
        );
        await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    });

    // --- Room, space and member context menus --------------------------------

    /**
     * Right-click any element and wait for its menu. The row menus are all
     * Reka context menus anchored at the pointer, so this works the same for a
     * room row, a guild tile and a member row.
     */
    async function openMenuOn(locator: Locator): Promise<void> {
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        assert.ok(box, "the target must be measurable to right-click it");
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
        await page.waitForSelector(".tumult-menu", { timeout: 5_000 });
    }

    /** One item of the open menu, matched by its label. */
    function menuEntry(scope: string, label: string) {
        return page.locator(`${scope} .tumult-menu-item`, { hasText: label });
    }

    /**
     * Record what the app asks the clipboard to hold. Firefox grants no
     * clipboard-read permission, so the value cannot be read back — wrapping
     * `writeText` observes the request while still performing the real write
     * (the message-menu test covers the real path). The evaluated body is a
     * STRING on purpose: a serialized function carrying a name dies in the page
     * with `__name is not defined` (tsx/esbuild `keepNames`).
     */
    async function recordClipboard(): Promise<void> {
        await page.evaluate(
            `(() => {
                const clip = navigator.clipboard;
                const original = clip.writeText.bind(clip);
                window.__copied = null;
                clip.writeText = (text) => {
                    window.__copied = text;
                    return original(text);
                };
            })()`,
        );
    }

    /** The last text the app asked the clipboard to hold. */
    function lastCopied(): Promise<string | null> {
        return page.evaluate<string | null>("window.__copied");
    }

    /** Open a row's menu, click one item, and wait for the menu to close. */
    async function pick(target: Locator, label: string): Promise<void> {
        await openMenuOn(target);
        await menuEntry(".tumult-menu", label).click();
        await page.locator(".tumult-menu").first().waitFor({ state: "detached", timeout: 5_000 });
    }

    it("marks a room read from its context menu without opening it", async () => {
        await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
        // The rail lists guilds in name order, so the first tile is Big Guild,
        // whose channel-07 carries a seeded 99+ badge.
        await page.locator("a.tumult-guild-item").first().click();
        await page.waitForSelector(".tumult-room-item", { timeout: 10_000 });

        const room = page.locator(".tumult-room-item", { hasText: "channel-07" }).first();
        // Opening the room would mark it read, so the assertion below only means
        // something because we never clicked it.
        await room.locator(".tumult-badge").waitFor({ timeout: 5_000 });

        await openMenuOn(room);
        for (const label of ["Mark as read", "Copy link", "Copy room ID", "Leave room"]) {
            assert.equal(
                await menuEntry(".tumult-menu", label).count(),
                1,
                `the room menu is missing "${label}"`,
            );
        }
        await menuEntry(".tumult-menu", "Mark as read").click();

        // Marking read goes client -> sync -> snapshot -> tree, so the badge
        // goes away without the room ever being opened.
        await page
            .locator(".tumult-room-item", { hasText: "channel-07" })
            .first()
            .locator(".tumult-badge")
            .waitFor({ state: "detached", timeout: 10_000 });

        // The copy items are dispatchers like any other, and a swapped link/id
        // would still "work" — so record what the app asked to copy.
        await recordClipboard();
        await pick(room, "Copy room ID");
        assert.equal(
            await lastCopied(),
            "!b-7:fake",
            "Copy room ID must put the room id on the clipboard",
        );
        // This room carries no canonical alias, so the link falls back to its id.
        await pick(room, "Copy link");
        assert.equal(
            await lastCopied(),
            "https://matrix.to/#/!b-7:fake",
            "Copy link must put the room's matrix.to link on the clipboard",
        );
    });

    it("offers a space its link and id, and leave", async () => {
        await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
        await page.waitForSelector("a.tumult-guild-item", { timeout: 10_000 });

        const guild = page.locator("a.tumult-guild-item").first();
        await openMenuOn(guild);
        for (const label of ["Copy link", "Copy space ID", "Leave space"]) {
            assert.equal(
                await menuEntry(".tumult-menu", label).count(),
                1,
                `the space menu is missing "${label}"`,
            );
        }
        // No mark-read here: a space means every channel in it.
        assert.equal(await menuEntry(".tumult-menu", "Mark as read").count(), 0);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".tumult-menu", { state: "detached", timeout: 5_000 });

        // The first rail tile is Big Guild, which has no canonical alias, so both
        // the id and the link resolve to its room id.
        await recordClipboard();
        await pick(guild, "Copy space ID");
        assert.equal(await lastCopied(), "!guild-b:fake", "Copy space ID must copy the space id");
        await pick(guild, "Copy link");
        assert.equal(
            await lastCopied(),
            "https://matrix.to/#/!guild-b:fake",
            "Copy link must put the space's matrix.to link on the clipboard",
        );
    });

    it("gates member moderation and always offers the copy pair", async () => {
        await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".tumult-shell", { timeout: 20_000 });
        await page.locator("a.tumult-guild-item").first().click();
        await page.waitForSelector(".tumult-room-item", { timeout: 10_000 });
        await page.locator(".tumult-room-item").first().click();
        await page.waitForSelector(".tumult-members", { timeout: 10_000 });
        await page.waitForSelector(".tumult-member", { timeout: 10_000 });

        // Bob is below us (50 < 100): the copy pair comes first, then moderation,
        // with the destructive pair marked as such.
        const bob = page.locator(".tumult-member", { hasText: "Bob" }).first();
        await openMenuOn(bob);
        for (const label of ["Copy user ID", "Copy link", "Kick Bob", "Ban Bob"]) {
            assert.equal(
                await menuEntry(".tumult-menu", label).count(),
                1,
                `the member menu is missing "${label}"`,
            );
        }
        const dangerColour = await menuEntry(".tumult-menu", "Kick Bob").evaluate(
            (el) => getComputedStyle(el).color,
        );
        const plainColour = await menuEntry(".tumult-menu", "Copy user ID").evaluate(
            (el) => getComputedStyle(el).color,
        );
        assert.notEqual(dangerColour, plainColour, "kick should stand out as destructive");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".tumult-menu", { state: "detached", timeout: 5_000 });

        // Copy dispatches by id, so check the value the app asked for.
        await recordClipboard();
        await pick(bob, "Copy user ID");
        assert.equal(await lastCopied(), "@bob:example.com", "Copy user ID must copy the id");
        await pick(bob, "Copy link");
        assert.equal(
            await lastCopied(),
            "https://matrix.to/#/@bob:example.com",
            "Copy link must put the user's matrix.to link on the clipboard",
        );

        // Moderation items dispatch through the shell's request channel, so the
        // set-power one must open its dialog — the id -> request mapping proven
        // end to end.
        await pick(bob, "Change permissions…");
        const dialog = page.locator(".tumult-dialog");
        await dialog.waitFor({ timeout: 5_000 });
        assert.equal(
            (await dialog.locator(".tumult-dialog-title").textContent())?.trim(),
            "Change permissions",
        );
        await dialog.locator("button", { hasText: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden", timeout: 5_000 });

        // Alice is at our own level (100): nothing to moderate, but the id is
        // still copyable — the menu is never empty.
        await openMenuOn(page.locator(".tumult-member", { hasText: "Alice" }).first());
        assert.equal(await menuEntry(".tumult-menu", "Copy user ID").count(), 1);
        for (const label of ["Kick Alice", "Ban Alice", "Change permissions…"]) {
            assert.equal(
                await menuEntry(".tumult-menu", label).count(),
                0,
                `an equal-ranked member must not offer "${label}"`,
            );
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".tumult-menu", { state: "detached", timeout: 5_000 });
    });

    it("reports no console errors across the whole run", () => {
        assert.deepEqual(consoleErrors, []);
    });

    it("enforces shell layout parity: grid tracks, inert panes and chrome-vs-panes", async () => {
        // Read layout tokens from the running app
        const tokens = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            return {
                rail: root.getPropertyValue("--layout-guild-rail-width").trim(),
                roomlist: root.getPropertyValue("--layout-roomlist-width").trim(),
                members: root.getPropertyValue("--layout-members-width").trim(),
            };
        });

        const getGrid = () =>
            page.evaluate(() => {
                const grid = document.querySelector(".tumult-shell-grid");
                if (!grid) return null;
                const style = getComputedStyle(grid);
                return style.gridTemplateColumns;
            });

        const checkRoomlist = () =>
            page.evaluate(() => {
                const pane = document.querySelector(".tumult-pane-roomlist");
                if (!pane) return null;
                const rect = pane.getBoundingClientRect();
                const style = getComputedStyle(pane);
                const inert = pane.hasAttribute("inert");
                // When closed, width is 0 or very small; when open, takes roomlist width
                return { inert, width: Math.round(rect.width), display: style.display };
            });

        const checkMembers = () =>
            page.evaluate(() => {
                const pane = document.querySelector(".tumult-pane-members");
                if (!pane) return null;
                const rect = pane.getBoundingClientRect();
                const inert = pane.hasAttribute("inert");
                return { inert, width: Math.round(rect.width) };
            });

        // Default: both panes open
        const gridBoth = await getGrid();
        assert.ok(gridBoth, "no shell grid found");
        // Expected: rail roomlist minmax(0,1fr) members
        // Accept resolved pixel values or the token name
        assert.ok(gridBoth.includes(tokens.rail), `grid should include rail token (${tokens.rail}) in ${gridBoth}`);
        assert.ok(gridBoth.includes(tokens.roomlist), `grid should include roomlist token (${tokens.roomlist}) in ${gridBoth}`);
        assert.ok(gridBoth.includes(tokens.members), `grid should include members token (${tokens.members}) in ${gridBoth}`);
        // Center track is flexible (also common as "minmax(0,1fr)" but resolved as px in some cases; just ensure not a fixed width)
        assert.ok(gridBoth.includes("1fr") || gridBoth.includes("minmax(0,1fr)") || gridBoth.split(/\s+/).length === 4, `grid should be flexible in center track: ${gridBoth}`);

        const rlBoth = await checkRoomlist();
        const mBoth = await checkMembers();
        assert.ok(!rlBoth?.inert, "roomlist should not be inert when open");
        assert.ok(!mBoth?.inert, "members should not be inert when open");

        // Close roomlist, keep members open
        await page.getByLabel("Toggle room list").click();
        await page.waitForTimeout(100);

        const gridNoRl = await getGrid();
        assert.ok(gridNoRl?.includes("0px"), `closing roomlist should set its track to 0: ${gridNoRl}`);
        const rlClosed = await checkRoomlist();
        assert.ok(rlClosed?.inert, "closed roomlist must be inert");
        assert.ok(rlClosed?.width === 0, `closed roomlist width must be 0, got ${rlClosed?.width}`);

        // Reopen roomlist
        await page.getByLabel("Toggle room list").click();
        await page.waitForTimeout(100);

        // Close members
        await page.getByLabel("Toggle members").click();
        await page.waitForTimeout(100);
        const gridNoM = await getGrid();
        assert.ok(gridNoM?.includes("0px"), `closing members should set its track to 0: ${gridNoM}`);
        const mClosed = await checkMembers();
        assert.ok(mClosed?.inert, "closed members must be inert");
        assert.ok(mClosed?.width === 0, `closed members width must be 0, got ${mClosed?.width}`);

        // Close both
        await page.getByLabel("Toggle room list").click();
        await page.waitForTimeout(100);
        const gridNone = await getGrid();
        assert.ok(gridNone?.includes("0px"), `both closed: all pane tracks should be 0: ${gridNone}`);
        assert.ok(gridNone?.includes("minmax(0,1fr)") || gridNone?.includes("1fr") || gridNone.split(/\s+/).length === 4, "timeline must remain flexible even when both panes closed");
        const rlNone = await checkRoomlist();
        const mNone = await checkMembers();
        assert.ok(rlNone?.inert, "closed roomlist must be inert");
        assert.ok(mNone?.inert, "closed members must be inert");

        // Reopen both
        await page.getByLabel("Toggle members").click();
        await page.getByLabel("Toggle room list").click();
        await page.waitForTimeout(100);
        const gridFinal = await getGrid();
        assert.ok(gridFinal?.includes("minmax(0,1fr)") || gridFinal?.includes("1fr") || gridFinal.split(/\s+/).length === 4, "final state must have flexible center");
    });
});
