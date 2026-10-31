/**
 * Regenerate build/icons/*.png from the web app's favicon
 * (`apps/web/public/favicon.svg`), rasterised by Electron's own Chromium so no
 * image tool is needed. The flame is taller than wide; it is centred on a
 * transparent square. Run with `pnpm --filter @tumult/desktop icons`, then
 * commit the PNGs (electron-builder reads build/icons for Linux, and
 * build/icons/256x256.png for the Windows .ico).
 *
 * One offscreen window, re-laid-out per size: destroying a window between
 * sizes killed the shared renderer under the next load.
 */
const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const MAX = Math.max(...SIZES);
const root = join(__dirname, "..");
const svg = readFileSync(join(root, "..", "web", "public", "favicon.svg"), "utf8");
const outDir = join(root, "build", "icons");

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    mkdirSync(outDir, { recursive: true });
    const tmp = mkdtempSync(join(tmpdir(), "tumult-icons-"));
    const page = join(tmp, "icon.html");
    writeFileSync(
        page,
        `<!doctype html><html><body style="margin:0;background:transparent">
<div id="box" style="display:flex;align-items:center;justify-content:center">
<img id="icon" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" style="width:auto"></div></body></html>`,
    );
    const window = new BrowserWindow({
        width: MAX,
        height: MAX,
        show: false,
        frame: false,
        transparent: true,
        useContentSize: true,
        webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
    });
    await window.loadFile(page);
    for (const size of SIZES) {
        await window.webContents.executeJavaScript(
            `(() => { const b = document.getElementById("box"); b.style.width = b.style.height = "${size}px";
             document.getElementById("icon").style.height = "${Math.round(size * 0.92)}px";
             return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`,
        );
        const image = await window.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
        writeFileSync(join(outDir, `${size}x${size}.png`), image.resize({ width: size, height: size, quality: "best" }).toPNG());
    }
    console.log(`wrote ${SIZES.length} icons to build/icons`);
    app.quit();
});
