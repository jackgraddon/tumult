/**
 * Node-only theme compiler. Reads `themes/*.json` with node:fs, validates
 * through the public validator, and writes `dist/themes/*.css`.
 *
 * Never imported from `src/index.ts` — one transitive node:fs import breaks
 * the Vite browser build. Library only: the side effects (including the docs
 * regeneration) live in `cli.ts`, so importing this module compiles nothing.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { emitBaseCss } from "../emit/base-css.ts";
import { serializeTheme } from "../emit/serialize.ts";
import { validateTheme } from "../validate/index.ts";
import { requireDefaultTheme, themesDir, type RawTheme } from "./default-theme.ts";

const outDir = join(themesDir, "..", "dist", "themes");

export function compileThemes(): void {
    mkdirSync(outDir, { recursive: true });

    const docs: RawTheme[] = [];
    for (const file of readdirSync(themesDir)) {
        if (!file.endsWith(".json")) continue;
        const raw = readFileSync(join(themesDir, file), "utf8");
        const validation = validateTheme(JSON.parse(raw) as unknown);
        if (!validation.valid) {
            const issues = validation.issues.filter((issue) => issue.severity === "error");
            throw new Error(`Theme ${file} invalid:\n${issues.map((issue) => `- ${issue.message}`).join("\n")}`);
        }
        const parsed = JSON.parse(raw) as RawTheme;
        docs.push(parsed);
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

    writeFileSync(join(outDir, "base.css"), emitBaseCss(requireDefaultTheme(docs)));
}
