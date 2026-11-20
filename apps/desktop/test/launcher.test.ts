/**
 * AppImage updates replace a versioned file under a NEW name. A launcher made
 * by desktop integration still points at the old one, so this module rewrites
 * only the two path-bearing keys. The rewrite is pure; the filesystem walk is
 * exercised with a throwaway XDG_DATA_HOME.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { quoteExecPath, repairAppImageLaunchers, repointDesktopLauncher } from "../src/launcher.ts";

const OLD = "/home/jack/AppImages/Tumult-0.4.1-x86_64.AppImage";
const NEW = "/home/jack/AppImages/Tumult-0.5.0-x86_64.AppImage";

describe("quoteExecPath", () => {
    it("quotes and escapes a desktop-entry path", () => {
        assert.equal(quoteExecPath(OLD), `"${OLD}"`);
        assert.equal(quoteExecPath('/tmp/a "b".AppImage'), '"/tmp/a \\"b\\".AppImage"');
    });
});

describe("repointDesktopLauncher", () => {
    it("rewrites Exec and TryExec, including a quoted path and extra arguments", () => {
        const before = [
            "[Desktop Entry]",
            `Exec=env DESKTOPINTEGRATION=1 ${OLD} --no-sandbox %U`,
            `TryExec=${quoteExecPath(OLD)}`,
            `Icon=${OLD}`,
            "Name=Tumult",
        ].join("\n");
        const after = repointDesktopLauncher(before, OLD, NEW);
        assert.ok(after);
        assert.match(after, new RegExp(`^Exec=env DESKTOPINTEGRATION=1 ${quoteExecPath(NEW)} --no-sandbox %U$`, "m"));
        assert.match(after, new RegExp(`^TryExec=${quoteExecPath(NEW)}$`, "m"));
        assert.match(after, new RegExp(`^Icon=${OLD}$`, "m"));
    });

    it("returns null when there is no launcher path to change", () => {
        assert.equal(repointDesktopLauncher(`Icon=${OLD}\n`, OLD, NEW), null);
        assert.equal(repointDesktopLauncher(`Exec=${OLD}\n`, OLD, OLD), null);
    });
});

describe("repairAppImageLaunchers", () => {
    it("updates only user .desktop entries that launched the old file", async () => {
        const root = mkdtempSync(join(tmpdir(), "tumult-launcher-test-"));
        try {
            const dir = join(root, "applications");
            mkdirSync(dir);
            const relevant = join(dir, "tumult.desktop");
            const other = join(dir, "other.desktop");
            const nested = join(dir, "notes.txt");
            writeFileSync(relevant, `Exec=${OLD} %U\nTryExec=${OLD}\n`, "utf8");
            writeFileSync(other, "Exec=/usr/bin/other\n", "utf8");
            writeFileSync(nested, OLD, "utf8");
            const changed = await repairAppImageLaunchers(OLD, NEW, { XDG_DATA_HOME: root });
            assert.deepEqual(changed, ["tumult.desktop"]);
            assert.equal(readFileSync(relevant, "utf8"), `Exec=${quoteExecPath(NEW)} %U\nTryExec=${quoteExecPath(NEW)}\n`);
            assert.equal(readFileSync(other, "utf8"), "Exec=/usr/bin/other\n");
            assert.equal(readFileSync(nested, "utf8"), OLD);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("treats a missing applications directory as normal", async () => {
        const root = mkdtempSync(join(tmpdir(), "tumult-launcher-empty-"));
        try {
            assert.deepEqual(await repairAppImageLaunchers(OLD, NEW, { XDG_DATA_HOME: root }), []);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
