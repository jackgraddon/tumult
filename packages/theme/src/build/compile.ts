/**
 * Node-only theme compiler. Reads `themes/*.json` with node:fs, validates
 * through the public validator, and writes `dist/themes/*.css`.
 *
 * Never imported from `src/index.ts` — one transitive node:fs import breaks
 * the Vite browser build.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { emitBaseCss } from "../emit/base-css.ts";
import { serializeTheme } from "../emit/serialize.ts";
import { validateTheme } from "../validate/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
// dist/build/compile.js -> package root is ../../ from dist/build.
const root = join(here, "..", "..");
const themesDir = join(root, "themes");
const outDir = join(root, "dist", "themes");

export function compileThemes(): void {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "base.css"), emitBaseCss());

    for (const file of readdirSync(themesDir)) {
        if (!file.endsWith(".json")) continue;
        const raw = readFileSync(join(themesDir, file), "utf8");
        const validation = validateTheme(JSON.parse(raw) as unknown);
        if (!validation.valid) {
            const errors = validation.issues.filter((i) => i.severity === "error");
            throw new Error(`Theme ${file} invalid:\n${errors.map((e) => `- ${e.message}`).join("\n")}`);
        }
        const parsed = JSON.parse(raw) as {
            name: string;
            tokens: Record<string, string>;
            modes?: Record<string, Record<string, string>>;
            densities?: Record<string, Record<string, string>>;
        };
        writeFileSync(
            join(outDir, `${parsed.name}.css`),
            serializeTheme({
                name: parsed.name,
                tokens: parsed.tokens,
                ...(parsed.modes ? { modes: parsed.modes } : {}),
                ...(parsed.densities ? { densities: parsed.densities } : {}),
                validation,
            }),
        );
    }
}

// CLI entry: `node ./dist/build/compile.js`
compileThemes();
