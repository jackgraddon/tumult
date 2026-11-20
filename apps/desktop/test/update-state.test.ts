/**
 * The pure half of the updater: which installs may replace themselves, and how
 * progress and failures become the snapshots the settings page renders. No
 * Electron, no feed, no packaged app — just the rules.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    available,
    canSelfUpdate,
    checking,
    downloaded,
    downloading,
    failed,
    installing,
    unsupportedMessage,
    unsupportedSnapshot,
    updateError,
    type UpdaterEnvironment,
} from "../src/update-state.ts";

function env(patch: Partial<UpdaterEnvironment> = {}): UpdaterEnvironment {
    return { platform: "linux", packaged: true, env: {}, ...patch };
}

describe("canSelfUpdate", () => {
    it("allows a packaged AppImage and a Windows install", () => {
        assert.equal(canSelfUpdate(env({ env: { APPIMAGE: "/opt/Tumult.AppImage" } })), true);
        assert.equal(canSelfUpdate(env({ platform: "win32" })), true);
    });

    it("refuses a deb/rpm, a mac build and an unpackaged app without a test feed", () => {
        assert.equal(canSelfUpdate(env()), false);
        assert.equal(canSelfUpdate(env({ platform: "darwin" })), false);
        assert.equal(canSelfUpdate(env({ packaged: false })), false);
    });

    it("allows a dev build only with an explicit loopback feed", () => {
        assert.equal(canSelfUpdate(env({ packaged: false, env: { TUMULT_UPDATE_URL: "http://127.0.0.1:1/" } })), true);
    });
});

describe("unsupported", () => {
    it("names the package manager instead of pretending deb/rpm can self-update", () => {
        assert.match(unsupportedMessage(env()) ?? "", /deb and rpm|package manager/);
        assert.match(unsupportedMessage(env({ packaged: false })) ?? "", /development build/);
        const snapshot = unsupportedSnapshot(env());
        assert.equal(snapshot.phase, "unsupported");
        assert.equal(typeof snapshot.message, "string");
    });
});

describe("snapshots", () => {
    it("keeps each phase immutable and minimal", () => {
        assert.deepEqual(checking(), { phase: "checking" });
        assert.deepEqual(available("1.2.3"), { phase: "available", version: "1.2.3" });
        assert.deepEqual(downloaded("1.2.3"), { phase: "downloaded", version: "1.2.3" });
        assert.deepEqual(installing("1.2.3"), { phase: "installing", version: "1.2.3" });
    });

    it("turns Electron's percentage into a bounded 0–1 progress", () => {
        assert.deepEqual(downloading("1.2.3", 42), { phase: "downloading", version: "1.2.3", progress: 0.42 });
        assert.equal(downloading("1.2.3", -10).progress, 0);
        assert.equal(downloading("1.2.3", 140).progress, 1);
        assert.equal(downloading("1.2.3", Number.NaN).progress, 0);
    });

    it("translates failures with the shared error rules", () => {
        assert.match(updateError({ httpStatus: 403 }, "Couldn't check for updates"), /permission/);
        assert.match(
            updateError(new Error("https://example.invalid/feed is broken"), "Couldn't check for updates"),
            /something went wrong|Try again/,
        );
        const snapshot = failed({ httpStatus: 503 }, "Couldn't download the update", "1.2.3");
        assert.equal(snapshot.phase, "error");
        assert.equal(snapshot.version, "1.2.3");
        assert.match(snapshot.message ?? "", /overloaded|Try again/);
    });
});
