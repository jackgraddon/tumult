/**
 * electron-builder configuration for Tumult desktop: Linux (AppImage, deb, rpm)
 * and Windows (NSIS, x64). macOS is a development host only — no mac target.
 *
 * The packaged app is three things: the main-process bundle (dist/), the
 * desktop web build (web/) and package.json. No node_modules: esbuild bundles
 * the main process and the package has no runtime dependencies.
 *
 * The version is the REPO's (root package.json, bumped by `pnpm release`),
 * injected here so the desktop package itself stays at 0.0.0 like the others
 * and cannot drift.
 */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { version } = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));

/** @type {import("electron-builder").Configuration} */
module.exports = {
    appId: "io.github.jackgraddon.tumult",
    productName: "Tumult",
    copyright: "Copyright © Jack Graddon",
    // `desktopName` is what Electron reports as the Wayland app_id / X11
    // WM_CLASS; with `linux.syncDesktopName` the installed .desktop file is
    // named to match, so the shell links running windows to the launcher.
    extraMetadata: { version, main: "dist/main.cjs", desktopName: "tumult.desktop" },
    directories: { output: "release", buildResources: "build" },
    files: ["package.json", "dist/**/*", "!dist/**/*.map", "web/**/*"],
    asar: true,
    // Fail the package rather than ship an app with no web build in it.
    beforePack: async () => {
        const { existsSync } = require("node:fs");
        if (!existsSync(join(__dirname, "web", "index.html"))) {
            throw new Error("apps/desktop/web/index.html is missing — run `node scripts/build-web.ts` first (dist:* scripts do).");
        }
    },
    // The Electron fuses that harden a packaged app: no ELECTRON_RUN_AS_NODE,
    // no NODE_OPTIONS / --inspect, cookies encrypted, and the app only loads
    // from its own asar (integrity-checked where the platform supports it).
    electronFuses: {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
    },
    linux: {
        target: ["AppImage", "deb", "rpm"],
        executableName: "tumult",
        syncDesktopName: true,
        icon: "build/icons",
        synopsis: "Matrix chat client",
        description: "Tumult, a Matrix chat client inspired by Discord.",
        maintainer: "Jack Graddon",
        vendor: "Jack Graddon",
        artifactName: "Tumult-${version}-${arch}.${ext}",
        // The WHOLE Categories list goes in `category`: electron-builder 26.18
        // always writes `Categories=<category>;` after merging `desktop.entry`,
        // so an `entry.Categories` is silently replaced (VERIFIED: it shipped
        // `Categories=Network;`, then `Utility;` with `category` unset).
        category: "Network;Chat;InstantMessaging",
        desktop: {
            entry: {
                Name: "Tumult",
                GenericName: "Matrix Client",
                Keywords: "matrix;chat;messaging;",
            },
        },
    },
    deb: {
        // libsecret is what Chromium's cookie-encryption key uses under GNOME;
        // without a keyring it falls back to basic_text (AGENTS.md, Linux).
        depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"],
    },
    rpm: {
        depends: ["gtk3", "libnotify", "nss", "libXScrnSaver", "libXtst", "xdg-utils", "at-spi2-core", "libuuid", "libsecret"],
    },
    win: {
        target: [{ target: "nsis", arch: ["x64"] }],
        icon: "build/icons/256x256.png",
        artifactName: "Tumult-Setup-${version}-${arch}.${ext}",
    },
    nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        deleteAppDataOnUninstall: false,
        shortcutName: "Tumult",
    },
    publish: null,
};
