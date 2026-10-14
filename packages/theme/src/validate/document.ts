import type { ThemeDensities, ThemeJson, ThemeModes } from "../types.ts";
import { TOKEN_CONTRACT_VERSION } from "../version.ts";

export interface ThemeDocument {
    name: string;
    version: number;
    tokens: Record<string, string>;
    /** Per-mode overrides (e.g. `light`). Absent means the theme has only its default mode. */
    modes: ThemeModes;
    /** Per-density overrides (e.g. `compact`, `cozy`, `spacious`). */
    densities: ThemeDensities;
}

/** Structural envelope check. Returns null when the shape is unusable. */
export function parseDocument(input: unknown): { doc?: ThemeDocument; error?: string } {
    if (typeof input !== "object" || input === null) return { error: "Theme must be a JSON object." };
    const o = input as Record<string, unknown>;
    if (typeof o["name"] !== "string" || o["name"].length === 0) {
        return { error: "Theme `name` must be a non-empty string." };
    }
    if (typeof o["version"] !== "number") {
        return { error: "Theme `version` must be a number." };
    }
    const tokens = readTokenMap(o["tokens"], "tokens");
    if (typeof tokens === "string") return { error: tokens };

    const modes: ThemeModes = {};
    if (o["modes"] !== undefined) {
        if (typeof o["modes"] !== "object" || o["modes"] === null || Array.isArray(o["modes"])) {
            return { error: "Theme `modes` must be an object." };
        }
        for (const [mode, map] of Object.entries(o["modes"] as Record<string, unknown>)) {
            const parsed = readTokenMap(map, `modes.${mode}`);
            if (typeof parsed === "string") return { error: parsed };
            modes[mode] = parsed;
        }
    }

    const densities: ThemeDensities = {};
    if (o["densities"] !== undefined) {
        if (typeof o["densities"] !== "object" || o["densities"] === null || Array.isArray(o["densities"])) {
            return { error: "Theme `densities` must be an object." };
        }
        for (const [density, map] of Object.entries(o["densities"] as Record<string, unknown>)) {
            const parsed = readTokenMap(map, `densities.${density}`);
            if (typeof parsed === "string") return { error: parsed };
            densities[density] = parsed;
        }
    }

    const doc: ThemeDocument = {
        name: o["name"] as string,
        version: o["version"] as number,
        tokens,
        modes,
        densities,
    };
    void TOKEN_CONTRACT_VERSION;
    return { doc };
}

function readTokenMap(input: unknown, label: string): Record<string, string> | string {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return `Theme \`${label}\` must be an object.`;
    }
    const tokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        if (typeof v !== "string") return `Token "${k}" in \`${label}\` must be a string value.`;
        tokens[k] = v;
    }
    return tokens;
}

export function toThemeJson(doc: ThemeDocument): ThemeJson {
    const out: ThemeJson = { version: doc.version, name: doc.name, tokens: { ...doc.tokens } };
    if (Object.keys(doc.modes).length > 0) out.modes = { ...doc.modes };
    if (Object.keys(doc.densities).length > 0) out.densities = { ...doc.densities };
    return out;
}
