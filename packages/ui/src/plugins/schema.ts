/**
 * The release manifest schema and its runtime validator — one source, two
 * consumers.
 *
 * `tumult.plugin.json` is the document a plugin repository publishes with
 * every release: the manifest the user consents to plus where the bundle is
 * (`entry`) and what it must hash to (`integrity`). It is authored in the
 * plugin repo, validated by the author's editor against the emitted JSON
 * schema (`docs/plugin.schema.json`, copied into the template), and validated
 * again by the installer before anything is downloaded — via
 * `validatePluginManifest`, which is built from the same constants as the
 * schema so the two cannot disagree (pinned by `plugin-schema.test.ts`).
 *
 * Deliberate leniency: unknown TOP-LEVEL fields are tolerated (an older
 * client installing a newer template's manifest should ignore a field it does
 * not know, not brick the install), while an unknown PERMISSION is refused —
 * consent cannot be shown for a capability the client cannot name.
 */

import { PLUGIN_PERMISSIONS } from "./types.ts";

/** Fields the schema requires (and the validator demands). */
export const REQUIRED_MANIFEST_KEYS = ["id", "name", "version", "permissions", "entry"] as const;

/** `sha256-` + 32 bytes base64-encoded (44 chars, last one padding). */
export const INTEGRITY_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;

/** A bare filename: no path separators, must not start with a dot. */
export const ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Namespaced id: lowercase segments separated by dots (`cc.example.shrug`). */
export const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;

const PERMISSION_SET = new Set<string>(PLUGIN_PERMISSIONS);

/**
 * Build the draft-07 schema for `tumult.plugin.json`. Emitted to
 * `docs/plugin.schema.json` (and the template) by `pnpm --filter @tumult/ui
 * emit:schema`; the test suite fails if the committed file drifts.
 */
export function buildPluginSchema(): Record<string, unknown> {
    return {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "tumult.plugin.json — a Tumult plugin release manifest",
        description:
            "Published as a release asset next to the built bundle. The installer validates " +
            "against this document, requires `integrity`, and ignores unknown top-level " +
            "fields; unknown permissions are refused.",
        type: "object",
        required: [...REQUIRED_MANIFEST_KEYS],
        properties: {
            id: {
                type: "string",
                pattern: ID_PATTERN.source,
                description: "Stable, namespaced plugin id (lowercase, dot-separated).",
            },
            name: { type: "string", minLength: 1, description: "Display name." },
            version: {
                type: "string",
                minLength: 1,
                description: "Display version of this release (e.g. 1.0.0).",
            },
            author: { type: "string", minLength: 1, description: "Who wrote it." },
            description: { type: "string", minLength: 1, description: "One or two sentences." },
            minCore: {
                type: "string",
                minLength: 1,
                description: "Minimum @tumult/core CONTRACT_VERSION this plugin understands.",
            },
            minUI: {
                type: "string",
                minLength: 1,
                description: "Minimum @tumult/ui PLUGIN_API_VERSION this plugin understands.",
            },
            permissions: {
                type: "array",
                items: { type: "string", enum: [...PLUGIN_PERMISSIONS] },
                uniqueItems: true,
                description: "Every extension API the plugin uses. The installer shows these.",
            },
            entry: {
                type: "string",
                pattern: ENTRY_PATTERN.source,
                description:
                    "Filename of the built bundle attached to the release (e.g. plugin.js).",
            },
            integrity: {
                type: "string",
                pattern: INTEGRITY_PATTERN.source,
                description:
                    "sha256-<base64> of the entry bundle, added by the release workflow. " +
                    "Optional in the committed file, required by the installer.",
            },
        },
        // Unknown top-level fields are ignored by older clients, on purpose:
        // a template may grow metadata without bricking every old install.
    };
}

/** The schema, serialized exactly as `emit:schema` writes it. */
export function buildPluginSchemaJson(): string {
    return JSON.stringify(buildPluginSchema(), null, 4) + "\n";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, key: string, errors: string[]): void {
    if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
        errors.push(`"${key}" must be a non-empty string`);
    }
}

/**
 * Validate a fetched release manifest. Returns every problem found (empty
 * means installable); the installer joins them into the refusal. Pass
 * `requireIntegrity: true` for a RELEASE document — the schema leaves
 * `integrity` optional so the file committed in the plugin repo (which has
 * no hash yet) still validates in the author's editor.
 */
export function validatePluginManifest(
    value: unknown,
    options: { requireIntegrity?: boolean } = {},
): string[] {
    const errors: string[] = [];
    if (!isRecord(value)) return ["manifest must be a JSON object"];

    for (const key of REQUIRED_MANIFEST_KEYS) {
        if (!(key in value)) errors.push(`missing required field "${key}"`);
    }

    for (const key of ["id", "name", "version", "entry"] as const) {
        const field = value[key];
        if (field !== undefined && (typeof field !== "string" || field.length === 0)) {
            errors.push(`"${key}" must be a non-empty string`);
        }
    }
    if (typeof value["id"] === "string" && !ID_PATTERN.test(value["id"])) {
        errors.push(`"id" must be a namespaced lowercase id (e.g. cc.example.shrug)`);
    }
    if (typeof value["entry"] === "string" && !ENTRY_PATTERN.test(value["entry"])) {
        errors.push(`"entry" must be a bare filename with no path (e.g. plugin.js)`);
    }

    optionalString(value["author"], "author", errors);
    optionalString(value["description"], "description", errors);
    optionalString(value["minCore"], "minCore", errors);
    optionalString(value["minUI"], "minUI", errors);

    const permissions = value["permissions"];
    if (permissions !== undefined) {
        if (!Array.isArray(permissions)) {
            errors.push(`"permissions" must be an array`);
        } else {
            const seen = new Set<string>();
            for (const permission of permissions) {
                if (typeof permission !== "string" || !PERMISSION_SET.has(permission)) {
                    errors.push(
                        `unknown permission ${JSON.stringify(permission)} — known: ` +
                            PLUGIN_PERMISSIONS.join(", "),
                    );
                    continue;
                }
                if (seen.has(permission)) errors.push(`duplicate permission "${permission}"`);
                seen.add(permission);
            }
        }
    }

    const integrity = value["integrity"];
    if (integrity === undefined) {
        if (options.requireIntegrity) {
            errors.push(`missing "integrity" — a release manifest must carry its bundle's hash`);
        }
    } else if (typeof integrity !== "string" || !INTEGRITY_PATTERN.test(integrity)) {
        errors.push(`"integrity" must look like sha256-<base64 of 32 bytes>`);
    }

    return errors;
}
