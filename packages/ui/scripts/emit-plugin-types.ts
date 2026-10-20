/**
 * Write the vendored plugin type declarations to their committed home.
 *
 * `pnpm --filter @tumult/ui emit:types`. Thin writer around
 * `build-plugin-types.ts`; the drift guard (`test/plugin-types.test.ts`) calls
 * the same builder, so this script and the guard can never disagree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { buildPluginTypes, PLUGIN_TYPES_TARGET } from "./build-plugin-types.ts";

mkdirSync(dirname(PLUGIN_TYPES_TARGET), { recursive: true });
writeFileSync(PLUGIN_TYPES_TARGET, buildPluginTypes());
console.log(`wrote ${PLUGIN_TYPES_TARGET}`);
