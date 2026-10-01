import type { TokenDef } from "../types.ts";
import { PRIMITIVE_TOKENS } from "./primitives.ts";
import { SEMANTIC_TOKENS } from "./semantic.ts";
import { COMPONENT_TOKENS } from "./components.ts";

export { PRIMITIVE_TOKENS, SEMANTIC_TOKENS, COMPONENT_TOKENS };

export const ALL_TOKENS: readonly TokenDef[] = [
    ...PRIMITIVE_TOKENS,
    ...SEMANTIC_TOKENS,
    ...COMPONENT_TOKENS,
];

export const TOKEN_MAP: ReadonlyMap<string, TokenDef> = new Map(
    ALL_TOKENS.map((t) => [t.name, t]),
);
