/**
 * Write the `tumult.plugin.json` JSON schema to its committed homes.
 *
 * `pnpm --filter @tumult/ui emit:schema`. Both copies come from
 * `buildPluginSchemaJson()`, so they are byte-identical; the drift test
 * (`packages/ui/test/plugin-schema.test.ts`) fails when either copy falls
 * behind the builder — run this and commit the result.
 *
 * - `docs/plugin.schema.json` — the author-facing document next to the
 *   theme's schema.
 * - `templates/plugin/tumult.plugin.schema.json` — what the template repo
 *   ships for editor validation of a plugin's manifest.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPluginSchemaJson } from "../src/plugins/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const json = buildPluginSchemaJson();

for (const target of [
    join(repoRoot, "docs", "plugin.schema.json"),
    join(repoRoot, "templates", "plugin", "tumult.plugin.schema.json"),
]) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, json);
    console.log(`wrote ${target}`);
}
