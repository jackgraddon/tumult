import { ALL_TOKENS } from "../registry/index.ts";

/** JSON Schema for the theme envelope (authoring aid, not the validator). */
export function buildThemeSchema(): Record<string, unknown> {
    return {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "Tumult theme",
        type: "object",
        required: ["version", "name", "tokens"],
        properties: {
            version: { type: "number", const: 1 },
            name: { type: "string", minLength: 1 },
            tokens: {
                type: "object",
                properties: Object.fromEntries(
                    ALL_TOKENS.map((t) => [t.name, { type: "string", description: t.description }]),
                ),
                additionalProperties: false,
            },
        },
        additionalProperties: false,
    };
}
