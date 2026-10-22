/**
 * Write `src/icons/builtin.generated.ts` from `BUILTIN_ICON_NAMES`.
 *
 * `pnpm --filter @tumult/ui emit:icons`. The drift test
 * (`test/icons.test.ts`) fails when the generated file falls behind the name
 * list or `@mdi/js` — run this and commit the result.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_ICON_NAMES } from "../src/icons/names.ts";
import { buildBuiltinSource } from "../src/icons/emit.ts";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "src", "icons", "builtin.generated.ts");
writeFileSync(target, await buildBuiltinSource(BUILTIN_ICON_NAMES));
console.log(`wrote ${target}`);
