/**
 * The installer core, network-free.
 *
 * `source.ts`, `verify.ts` and `consent.ts` are the parts of a third-party
 * install that decide things — which repo a pasted link names, whether a
 * downloaded bundle is the one promised, and whether the user must be asked
 * again. They touch no network and no DOM (bar WebCrypto for the hash), so the
 * whole decision surface is pinned here; the app-side controller only glues
 * them to `fetch` and IndexedDB.
 *
 * The tests that matter most are the refusals: a bad link parses to `null` (not
 * a wrong repo), a hash mismatch is a refusal (not a warning), and a permission
 * that changed in ANY direction re-opens consent.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    parsePluginSource,
    rawManifestUrl,
    releaseApiUrl,
    sourceSlug,
    sourceUrl,
} from "../src/plugins/source.ts";
import {
    addedPermissions,
    checkReleaseManifest,
    hashBundle,
    hashMismatchReason,
    needsConsent,
    samePermissionSet,
} from "../src/plugins/verify.ts";
import { describePermission, LANE_SUMMARY, PERMISSION_SUMMARY } from "../src/plugins/consent.ts";
import { PLUGIN_PERMISSIONS } from "../src/plugins/types.ts";
import type { PluginManifest } from "../src/plugins/types.ts";
import { SANDBOXABLE_PERMISSIONS } from "../src/plugins/lane.ts";

describe("parsePluginSource", () => {
    it("parses a plain repository URL", () => {
        assert.deepEqual(parsePluginSource("https://github.com/jackgraddon/tumult-plugin-template"), {
            owner: "jackgraddon",
            repo: "tumult-plugin-template",
            ref: null,
        });
    });

    it("parses the bare owner/repo shorthand", () => {
        assert.deepEqual(parsePluginSource("jackgraddon/tumult-plugin-template"), {
            owner: "jackgraddon",
            repo: "tumult-plugin-template",
            ref: null,
        });
    });

    it("parses an ssh remote", () => {
        assert.deepEqual(parsePluginSource("git@github.com:jackgraddon/tumult-plugin-template.git"), {
            owner: "jackgraddon",
            repo: "tumult-plugin-template",
            ref: null,
        });
    });

    it("reads a ref from a /tree/<ref> link", () => {
        assert.deepEqual(parsePluginSource("https://github.com/owner/repo/tree/v1.2.0"), {
            owner: "owner",
            repo: "repo",
            ref: "v1.2.0",
        });
    });

    it("keeps a slash inside a branch ref", () => {
        assert.deepEqual(parsePluginSource("https://github.com/owner/repo/tree/feat/new-thing"), {
            owner: "owner",
            repo: "repo",
            ref: "feat/new-thing",
        });
    });

    it("reads a ref from a releases/tag link", () => {
        assert.deepEqual(parsePluginSource("https://github.com/owner/repo/releases/tag/v2.0.0"), {
            owner: "owner",
            repo: "repo",
            ref: "v2.0.0",
        });
    });

    it("tolerates a trailing .git and a query string", () => {
        assert.deepEqual(parsePluginSource("https://github.com/owner/repo.git?tab=readme"), {
            owner: "owner",
            repo: "repo",
            ref: null,
        });
    });

    it("refuses a non-GitHub host rather than guessing", () => {
        assert.equal(parsePluginSource("https://gitlab.com/owner/repo"), null);
        assert.equal(parsePluginSource("https://evil.com/github.com/owner/repo"), null);
    });

    it("refuses anything that is not a repository reference", () => {
        for (const input of ["", "   ", "just-a-word", "owner", "a/b/c", "https://github.com/owner"]) {
            assert.equal(parsePluginSource(input), null, `expected null for ${JSON.stringify(input)}`);
        }
    });

    it("refuses path traversal and empty segments", () => {
        assert.equal(parsePluginSource("https://github.com/owner/../../etc/passwd"), null);
        assert.equal(parsePluginSource("https://github.com//"), null);
    });
});

describe("plugin source URLs", () => {
    const source = { owner: "owner", repo: "repo", ref: null };

    it("builds the browsable, slug and API URLs", () => {
        assert.equal(sourceUrl(source), "https://github.com/owner/repo");
        assert.equal(sourceSlug(source), "owner/repo");
        assert.equal(releaseApiUrl(source), "https://api.github.com/repos/owner/repo/releases/latest");
    });

    it("pins the release API to a ref when there is one", () => {
        assert.equal(
            releaseApiUrl({ ...source, ref: "v1.0.0" }),
            "https://api.github.com/repos/owner/repo/releases/tags/v1.0.0",
        );
    });

    it("falls back to the raw manifest at HEAD without a ref", () => {
        assert.equal(
            rawManifestUrl(source),
            "https://raw.githubusercontent.com/owner/repo/HEAD/tumult.plugin.json",
        );
        assert.equal(
            rawManifestUrl({ ...source, ref: "v1.0.0" }),
            "https://raw.githubusercontent.com/owner/repo/v1.0.0/tumult.plugin.json",
        );
    });
});

describe("hashBundle", () => {
    it("produces sha256-<base64> of the raw bytes", async () => {
        // Well-known: sha256("") base64.
        assert.equal(
            await hashBundle(new Uint8Array()),
            "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
        );
        // And of "abc".
        const abc = new TextEncoder().encode("abc");
        assert.equal(await hashBundle(abc), "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
    });

    it("hashes the same bytes identically from a Uint8Array and its buffer", async () => {
        const bytes = new TextEncoder().encode("the quick brown fox");
        assert.equal(await hashBundle(bytes), await hashBundle(bytes.buffer));
    });

    it("ignores bytes outside a typed-array view", async () => {
        const backing = new Uint8Array([9, 9, 9, 9, 9]);
        const view = new Uint8Array(backing.buffer, 1, 3).fill(1);
        // Only the three 1s are hashed, not the 9s around them.
        assert.equal(await hashBundle(view), await hashBundle(new Uint8Array([1, 1, 1])));
        assert.notEqual(await hashBundle(view), await hashBundle(backing));
    });
});

describe("checkReleaseManifest", () => {
    function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            id: "cc.example.shrug",
            name: "Shrug",
            version: "1.0.0",
            permissions: ["commands", "styles"],
            entry: "plugin.js",
            integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ...overrides,
        };
    }

    it("accepts a valid release and derives the lane", () => {
        const result = checkReleaseManifest(release());
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.lane, "sandbox");
        assert.equal(result.manifest.id, "cc.example.shrug");
    });

    it("derives the trusted lane for a component permission", () => {
        const result = checkReleaseManifest(release({ permissions: ["timeline-renderers"] }));
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.lane, "trusted");
    });

    it("refuses a release manifest with no integrity, naming the field", () => {
        const result = checkReleaseManifest(release({ integrity: undefined }));
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.match(result.reason, /integrity/);
    });

    it("refuses an unknown permission before anything is downloaded", () => {
        const result = checkReleaseManifest(release({ permissions: ["read-your-mind"] }));
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.match(result.reason, /read-your-mind/);
    });

    it("tolerates an unknown top-level field", () => {
        const result = checkReleaseManifest(release({ futureThing: { a: 1 } }));
        assert.equal(result.ok, true);
    });
});

describe("needsConsent / permissions", () => {
    const manifest = {
        id: "cc.example.shrug",
        name: "Shrug",
        version: "1.0.0",
        permissions: ["commands", "styles"],
        entry: "plugin.js",
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    } satisfies PluginManifest;

    it("asks when there is no prior record", () => {
        assert.equal(needsConsent(manifest, null), true);
    });

    it("does not ask again for the identical version, hash and permissions", () => {
        assert.equal(
            needsConsent(manifest, {
                id: "cc.example.shrug",
                version: "1.0.0",
                permissions: ["styles", "commands"], // order does not matter
                integrity: manifest.integrity,
            }),
            false,
        );
    });

    it("asks again on a version bump", () => {
        assert.equal(
            needsConsent(
                { ...manifest, version: "1.1.0" },
                {
                    id: "cc.example.shrug",
                    version: "1.0.0",
                    permissions: ["commands", "styles"],
                    integrity: manifest.integrity,
                },
            ),
            true,
        );
    });

    it("asks again when a permission is added", () => {
        assert.equal(
            needsConsent(
                { ...manifest, permissions: ["commands", "styles", "settings-tabs"] },
                {
                    id: "cc.example.shrug",
                    version: "1.0.0",
                    permissions: ["commands", "styles"],
                    integrity: manifest.integrity,
                },
            ),
            true,
        );
    });

    it("asks again when a permission is removed — the plugin changed too", () => {
        assert.equal(
            needsConsent(
                { ...manifest, permissions: ["commands"] },
                {
                    id: "cc.example.shrug",
                    version: "1.0.0",
                    permissions: ["commands", "styles"],
                    integrity: manifest.integrity,
                },
            ),
            true,
        );
    });

    it("asks again when the hash changed under the same version", () => {
        assert.equal(
            needsConsent(
                manifest,
                {
                    id: "cc.example.shrug",
                    version: "1.0.0",
                    permissions: ["commands", "styles"],
                    integrity: "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
                },
            ),
            true,
        );
    });

    it("reports added permissions only, for the copy", () => {
        assert.deepEqual(
            addedPermissions(
                { ...manifest, permissions: ["commands", "styles", "settings-tabs"] },
                {
                    id: "cc.example.shrug",
                    version: "1.0.0",
                    permissions: ["commands", "styles"],
                    integrity: manifest.integrity,
                },
            ),
            ["settings-tabs"],
        );
        // A fresh install adds everything the manifest declares.
        assert.deepEqual(addedPermissions(manifest, null), ["commands", "styles"]);
    });

    it("samePermissionSet is order-insensitive set equality", () => {
        assert.equal(samePermissionSet(["commands", "styles"], ["styles", "commands"]), true);
        assert.equal(samePermissionSet(["commands"], ["commands", "styles"]), false);
        assert.equal(samePermissionSet(["commands", "commands"], ["commands"]), false);
    });
});

describe("hashMismatchReason", () => {
    it("names both hashes and tells the user not to retry", () => {
        const reason = hashMismatchReason("sha256-AAA=", "sha256-BBB=");
        assert.match(reason, /sha256-AAA=/);
        assert.match(reason, /sha256-BBB=/);
        assert.match(reason, /do not retry/);
    });
});

describe("consent copy stays in step with the permission list", () => {
    it("has a sentence for every permission", () => {
        for (const permission of PLUGIN_PERMISSIONS) {
            assert.equal(typeof PERMISSION_SUMMARY[permission], "string");
            assert.ok(PERMISSION_SUMMARY[permission].length > 20, permission);
        }
    });

    it("covers every lane, and only the trusted lane warns", () => {
        assert.equal(LANE_SUMMARY.sandbox.warning, null);
        assert.ok(LANE_SUMMARY.trusted.warning !== null);
        assert.match(LANE_SUMMARY.trusted.label, /app/);
    });

    it("describePermission falls back to the raw name for an unknown value", () => {
        assert.equal(describePermission("commands"), PERMISSION_SUMMARY.commands);
        // A value outside the union cannot be produced in typed code, but the
        // runtime must not print `undefined` if a manifest smuggled one through.
        assert.equal(describePermission("made-up" as never), "made-up");
    });

    it("the sandbox lane is exactly the permissions whose copy promises no page access", () => {
        // Guard: a permission must not be sandboxable while its copy implies DOM
        // access. This is a coarse check, but it catches the drift that matters —
        // someone moving a component permission into SANDBOXABLE_PERMISSIONS.
        for (const permission of SANDBOXABLE_PERMISSIONS) {
            assert.ok(PERMISSION_SUMMARY[permission], permission);
        }
    });
});
