/**
 * Writes the generated authored docs:
 *
 *   docs/tokens.md           the token reference (registry + built-in values)
 *   docs/theme.schema.json   JSON Schema for a theme document (editor aid)
 *
 * Node-only, and deliberately separate from the pure builders in `docs.ts` and
 * the compiler in `compile.ts`: `cli.ts` is the only module that has side
 * effects, and the guard test only needs the builders.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { docsDir, readDefaultTheme } from "./default-theme.ts";
import { buildThemeSchemaJson, buildTokenDocs } from "./docs.ts";

export function emitDocs(): void {
    const theme = readDefaultTheme();
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "tokens.md"), buildTokenDocs(theme.tokens));
    writeFileSync(join(docsDir, "theme.schema.json"), buildThemeSchemaJson());
}
