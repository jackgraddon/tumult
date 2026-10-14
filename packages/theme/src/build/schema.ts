import { ALL_TOKENS } from "../registry/index.ts";
import { SUPPORTED_TOKEN_CONTRACT_VERSIONS, TOKEN_CONTRACT_VERSION } from "../version.ts";

/** JSON Schema for the theme envelope (authoring aid, not the validator). */
export function buildThemeSchema(): Record<string, unknown> {
    const tokenProperties = Object.fromEntries(
        ALL_TOKENS.map((t) => [t.name, { type: "string", description: t.description }]),
    );
    return {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "Tumult theme",
        type: "object",
        required: ["version", "name", "tokens"],
        properties: {
            version: {
                type: "number",
                enum: [...SUPPORTED_TOKEN_CONTRACT_VERSIONS],
                description: `Token contract version; current is ${TOKEN_CONTRACT_VERSION}.`,
            },
            name: { type: "string", minLength: 1 },
            tokens: {
                type: "object",
                properties: tokenProperties,
                additionalProperties: false,
            },
            modes: {
                type: "object",
                description: "Per-mode token overrides (e.g. `light`), applied via :root[data-theme][data-mode].",
                additionalProperties: {
                    type: "object",
                    properties: tokenProperties,
                    additionalProperties: false,
                },
            },
        },
        additionalProperties: false,
    };
}
