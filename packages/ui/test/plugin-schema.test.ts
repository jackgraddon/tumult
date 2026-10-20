/**
 * Pins the three plugin-install sources to one truth.
 *
 * The permission list (`PLUGIN_PERMISSIONS`), the release schema
 * (`buildPluginSchema` + the committed `docs/plugin.schema.json` and the
 * template's copy), the runtime validator (`validatePluginManifest`) and the
 * lane rule (`deriveLane`) must agree with each other and with the committed
 * files. Each test here names the drift it forbids.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    buildPluginSchema,
    buildPluginSchemaJson,
    validatePluginManifest,
    REQUIRED_MANIFEST_KEYS,
    INTEGRITY_PATTERN,
    ENTRY_PATTERN,
} from "../src/plugins/schema.ts";
import { PLUGIN_PERMISSIONS } from "../src/plugins/types.ts";
import { deriveLane, SANDBOXABLE_PERMISSIONS } from "../src/plugins/lane.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/** A well-formed release manifest; callers override fields per case. */
function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "cc.example.shrug",
        name: "Shrug",
        version: "1.0.0",
        permissions: ["commands"],
        entry: "plugin.js",
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        ...overrides,
    };
}

describe("plugin schema ↔ validator ↔ permission list", () => {
    it("the schema requires exactly REQUIRED_MANIFEST_KEYS", () => {
        const schema = buildPluginSchema() as {
            required: string[];
            properties: Record<string, { enum?: string[]; pattern?: string }>;
        };
        assert.deepEqual([...schema.required], [...REQUIRED_MANIFEST_KEYS]);
    });

    it("the schema's permission enum is exactly PLUGIN_PERMISSIONS", () => {
        const schema = buildPluginSchema() as {
            properties: { permissions: { items: { enum: string[] } } };
        };
        assert.deepEqual([...schema.properties.permissions.items.enum], [...PLUGIN_PERMISSIONS]);
    });

    it("the schema's patterns are the validator's patterns", () => {
        const schema = buildPluginSchema() as {
            properties: Record<string, { pattern?: string }>;
        };
        assert.equal(schema.properties["entry"]!.pattern, ENTRY_PATTERN.source);
        assert.equal(schema.properties["integrity"]!.pattern, INTEGRITY_PATTERN.source);
    });

    it("docs/plugin.schema.json is in sync with the builder", () => {
        const committed = readFileSync(join(repoRoot, "docs", "plugin.schema.json"), "utf8");
        assert.equal(committed, buildPluginSchemaJson(), "run: pnpm --filter @tumult/ui emit:schema");
    });

    it("the template's schema copy is in sync with the builder", () => {
        const committed = readFileSync(
            join(repoRoot, "templates", "plugin", "tumult.plugin.schema.json"),
            "utf8",
        );
        assert.equal(committed, buildPluginSchemaJson(), "run: pnpm --filter @tumult/ui emit:schema");
    });
});

describe("validatePluginManifest", () => {
    it("accepts a minimal release manifest", () => {
        assert.deepEqual(validatePluginManifest(release()), []);
    });

    it("accepts every declared permission", () => {
        for (const permission of PLUGIN_PERMISSIONS) {
            assert.deepEqual(
                validatePluginManifest(release({ permissions: [permission] })),
                [],
                `permission "${permission}" must validate`,
            );
        }
    });

    it("tolerates unknown top-level fields (a newer template must not brick an old client)", () => {
        assert.deepEqual(validatePluginManifest(release({ homepage: "https://example.com" })), []);
    });

    it("names every missing required field", () => {
        for (const key of REQUIRED_MANIFEST_KEYS) {
            const value = release();
            delete value[key];
            const errors = validatePluginManifest(value);
            assert.ok(
                errors.some((error) => error.includes(key)),
                `missing "${key}" must be reported, got: ${errors.join("; ")}`,
            );
        }
    });

    it("refuses an unknown permission, listing the known ones", () => {
        const errors = validatePluginManifest(release({ permissions: ["root-access"] }));
        assert.ok(errors.some((error) => error.includes('unknown permission "root-access"')));
        for (const permission of PLUGIN_PERMISSIONS) {
            assert.ok(errors[0]!.includes(permission), "the refusal must list known permissions");
        }
    });

    it("refuses a duplicate permission", () => {
        const errors = validatePluginManifest(release({ permissions: ["commands", "commands"] }));
        assert.ok(errors.some((error) => error.includes('duplicate permission "commands"')));
    });

    it("refuses a permissions value that is not an array", () => {
        assert.ok(
            validatePluginManifest(release({ permissions: "commands" })).some((error) =>
                error.includes('"permissions" must be an array'),
            ),
        );
    });

    it("refuses a non-namespaced id", () => {
        for (const id of ["Shrug", "shrug", "cc.", "cc Example shrug"]) {
            const errors = validatePluginManifest(release({ id }));
            assert.ok(errors.some((error) => error.includes('"id"')), `id "${id}" must be refused`);
        }
    });

    it("refuses a path-shaped entry", () => {
        for (const entry of ["../plugin.js", "dist/plugin.js", "/plugin.js", ".hidden.js"]) {
            const errors = validatePluginManifest(release({ entry }));
            assert.ok(
                errors.some((error) => error.includes('"entry"')),
                `entry "${entry}" must be refused`,
            );
        }
    });

    it("integrity is optional in the schema but required for a release", () => {
        const value = release();
        delete value["integrity"];
        assert.deepEqual(validatePluginManifest(value), [], "the committed file has no hash yet");
        const errors = validatePluginManifest(value, { requireIntegrity: true });
        assert.ok(errors.some((error) => error.includes("integrity")));
    });

    it("refuses a malformed integrity string", () => {
        for (const integrity of ["sha256:deadbeef", "sha512-AAAA", "sha256-AAAA", "plugin.js"]) {
            const errors = validatePluginManifest(release({ integrity }));
            assert.ok(
                errors.some((error) => error.includes('"integrity"')),
                `integrity "${integrity}" must be refused`,
            );
        }
    });

    it("refuses a non-object manifest", () => {
        for (const value of [null, "plugin", 42, []]) {
            assert.deepEqual(validatePluginManifest(value), ["manifest must be a JSON object"]);
        }
    });
});

describe("deriveLane", () => {
    it("sanboxes logic-only permissions", () => {
        assert.equal(deriveLane({ permissions: [] }), "sandbox");
        for (const permission of SANDBOXABLE_PERMISSIONS) {
            assert.equal(deriveLane({ permissions: [permission] }), "sandbox", permission);
        }
        assert.equal(
            deriveLane({ permissions: [...SANDBOXABLE_PERMISSIONS] }),
            "sandbox",
            "the full sandboxable set stays sandboxed",
        );
    });

    it("trusts any component-capable permission", () => {
        for (const permission of PLUGIN_PERMISSIONS) {
            if ((SANDBOXABLE_PERMISSIONS as readonly string[]).includes(permission)) continue;
            assert.equal(
                deriveLane({ permissions: [permission] }),
                "trusted",
                `${permission} must force the trusted lane`,
            );
            assert.equal(deriveLane({ permissions: ["commands", permission] }), "trusted");
        }
    });

    it("every sandboxable permission is a real permission", () => {
        for (const permission of SANDBOXABLE_PERMISSIONS) {
            assert.ok(
                (PLUGIN_PERMISSIONS as readonly string[]).includes(permission),
                `${permission} is not in PLUGIN_PERMISSIONS`,
            );
        }
    });
});
