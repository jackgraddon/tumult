import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    checkExplicitVersion,
    compareSemver,
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
