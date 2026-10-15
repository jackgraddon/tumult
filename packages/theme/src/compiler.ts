/**
 * Node-only entry for tooling (`@tumult/theme/compiler`). Importing this
 * compiles nothing and writes nothing — the build side effects live in
 * `build/cli.ts`.
 */
export { compileThemes } from "./build/compile.ts";
export { buildThemeSchema } from "./build/schema.ts";
export { buildThemeSchemaJson, buildTokenDocs } from "./build/docs.ts";
export { emitDocs } from "./build/emit-docs.ts";
export { docsDir, readDefaultTheme, repoRoot, requireDefaultTheme, themesDir } from "./build/default-theme.ts";
export type { RawTheme } from "./build/default-theme.ts";
