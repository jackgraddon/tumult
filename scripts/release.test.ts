import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    changelogNotes,
    checkExplicitVersion,
    compareSemver,
    isPrereleaseVersion,
    looksLikeVersion,
    parseVersion,
    versionTags,
} from "./release.ts";

describe("parseVersion", () => {
    it("accepts a v-prefixed or bare x.y.z", () => {
        assert.equal(parseVersion("v0.2.0"), "0.2.0");
        assert.equal(parseVersion("0.2.0"), "0.2.0");
    });

    it("rejects incomplete or extra forms", () => {
        assert.equal(parseVersion("v0.2"), null);
        assert.equal(parseVersion("0.2.0-beta"), null);
        assert.equal(parseVersion("--dry-run"), null);
    });
});

describe("looksLikeVersion", () => {
    it("treats flags as pass-through, not versions", () => {
        assert.equal(looksLikeVersion("--dry-run"), false);
        assert.equal(looksLikeVersion("v0.2"), true);
        assert.equal(looksLikeVersion("0.2.0"), true);
    });
});

describe("compareSemver / versionTags", () => {
    it("orders patch then minor then major", () => {
        assert.ok(compareSemver("0.2.0", "0.1.9") > 0);
        assert.ok(compareSemver("0.1.2", "0.1.2") === 0);
        assert.ok(compareSemver("0.1.1", "0.1.2") < 0);
    });

    it("keeps only vX.Y.Z tags, newest first", () => {
        assert.deepEqual(versionTags(["v0.1.1", "notes", "v0.1.2", "v0.1.0"]), [
            "v0.1.2",
            "v0.1.1",
            "v0.1.0",
        ]);
    });
});

describe("checkExplicitVersion", () => {
    const tags = ["v0.1.1", "v0.1.2"];

    it("allows a version newer than the latest tag", () => {
        assert.deepEqual(checkExplicitVersion("v0.2.0", tags), {
            ok: true,
            version: "0.2.0",
            tag: "v0.2.0",
        });
    });

    it("refuses a tag that already exists", () => {
        const check = checkExplicitVersion("v0.1.1", tags);
        assert.equal(check.ok, false);
        if (!check.ok) assert.match(check.reason, /already exists/);
    });

    it("refuses a version that is not newer than the latest tag", () => {
        const check = checkExplicitVersion("0.1.0", tags);
        assert.equal(check.ok, false);
        if (!check.ok) assert.match(check.reason, /not newer than the latest tag v0.1.2/);
    });

    it("allows any well-formed version when there are no tags", () => {
        assert.deepEqual(checkExplicitVersion("0.1.0", []), {
            ok: true,
            version: "0.1.0",
            tag: "v0.1.0",
        });
    });

    it("names an ill-formed argument", () => {
        const check = checkExplicitVersion("v0.2", tags);
        assert.equal(check.ok, false);
        if (!check.ok) assert.match(check.reason, /not a version/);
    });
});

const CHANGELOG = [
    "# Changelog",
    "",
    "All notable changes to this project will be documented in this file.",
    "",
    "### [0.4.1](https://github.com/jackgraddon/tumult/compare/v0.4.0...v0.4.1) (2026-10-31)",
    "",
    "",
    "### Features",
    "",
    "* **composer:** convert staged HEIC photos to JPEG before sending ([8b2b2be](...))",
    "",
    "### Bug Fixes",
    "",
    "* **errors:** translate every failed request into a readable sentence ([071beaa](...))",
    "",
    "## [0.4.0](https://github.com/jackgraddon/tumult/compare/v0.3.4...v0.4.0) (2026-10-31)",
    "",
    "",
    "### Features",
    "",
    "* **members:** a shield in place of the presence dot for verified users ([04b53fa](...))",
    "",
].join("\n");

describe("changelogNotes", () => {
    it("returns the section for a version, without its own header line", () => {
        assert.equal(changelogNotes(CHANGELOG, "0.4.1"), [
            "### Features",
            "",
            "* **composer:** convert staged HEIC photos to JPEG before sending ([8b2b2be](...))",
            "",
            "### Bug Fixes",
            "",
            "* **errors:** translate every failed request into a readable sentence ([071beaa](...))",
        ].join("\n"));
    });

    it("stops at the next version header and bleeds into no older section", () => {
        const notes = changelogNotes(CHANGELOG, "0.4.1");
        assert.ok(!notes.includes("0.4.0"));
        assert.ok(!notes.includes("shield in place of the presence dot"));
    });

    it("keeps the Features / Bug Fixes subsections (no [version] in them)", () => {
        const notes = changelogNotes(CHANGELOG, "0.4.1");
        assert.match(notes, /^### Features/m);
        assert.match(notes, /### Bug Fixes/);
    });

    it("reads the level-2 header form too", () => {
        const older = [
            "# Changelog",
            "",
            "## [0.1.0](...) (2020-01-01)",
            "",
            "Initial release",
        ].join("\n");
        assert.equal(changelogNotes(older, "0.1.0"), "Initial release");
    });

    it("does not confuse 0.4.0 with 0.4.1 or a 0.10.x version", () => {
        assert.doesNotMatch(changelogNotes(CHANGELOG, "0.4.1"), /0\.4\.0\]/);
        const withTens = ["## [0.10.0](...)", "", "ten patch", "", "## [0.1.0](...)", "", "one"].join("\n");
        assert.equal(changelogNotes(withTens, "0.10.0"), "ten patch");
    });

    it("returns empty for an absent version or empty changelog", () => {
        assert.equal(changelogNotes(CHANGELOG, "9.9.9"), "");
        assert.equal(changelogNotes("", "0.4.1"), "");
        assert.equal(changelogNotes("   ", "0.4.1"), "");
    });
});

describe("isPrereleaseVersion", () => {
    it("flags a prerelease suffix, not a stable version", () => {
        assert.equal(isPrereleaseVersion("1.0.0-rc.1"), true);
        assert.equal(isPrereleaseVersion("0.4.1"), false);
        assert.equal(isPrereleaseVersion("1.0.0"), false);
    });
});
