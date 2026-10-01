import type { ThemeJson } from "../types.ts";
import { TOKEN_CONTRACT_VERSION } from "../version.ts";

export interface ThemeDocument {
    name: string;
    version: number;
    tokens: Record<string, string>;
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
    if (typeof o["tokens"] !== "object" || o["tokens"] === null || Array.isArray(o["tokens"])) {
        return { error: "Theme `tokens` must be an object." };
    }
    const tokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(o["tokens"] as Record<string, unknown>)) {
        if (typeof v !== "string") return { error: `Token "${k}" must be a string value.` };
        tokens[k] = v;
    }
    const doc: ThemeDocument = {
        name: o["name"] as string,
        version: o["version"] as number,
        tokens,
    };
    void TOKEN_CONTRACT_VERSION;
    return { doc };
}

export function toThemeJson(doc: ThemeDocument): ThemeJson {
    return { version: doc.version, name: doc.name, tokens: { ...doc.tokens } };
}
