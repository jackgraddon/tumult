/**
 * Build the vendored plugin type declarations — pure, no filesystem writes.
 *
 * Split from `emit-plugin-types.ts` (which writes the file) so the drift guard
 * in `packages/ui/test/plugin-types.test.ts` can call the exact same builder and
 * compare it to the committed copy. One builder, two callers.
 *
 * Why this exists at all: a plugin author's checkout has no Tumult packages
 * installed, so the types they program against must live in the template as one
 * self-contained file. Hand-maintaining that file means it silently drifts from
 * the real plugin surface. Instead the surface is declared ONCE, explicitly, in
 * `src/plugins/authoring.ts`, and bundled here with `dts-bundle-generator`. Two
 * rules keep the output stand-alone:
 *
 *   - `@tumult/core/contract` IS inlined: it is the contract a plugin programs
 *     against and there is no package in a plugin checkout to resolve it from.
 *   - `vue` is NOT inlined: the template lists `vue` as a devDependency for its
 *     types (the runtime `vue` is the shell's own, reached through
 *     `globalThis.__tumult.vue`), so `from "vue"` resolves there and keeping it
 *     as an import avoids vendoring Vue's own declarations.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateDtsBundle } from "dts-bundle-generator";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to `src/plugins/authoring.ts` — the one author surface. */
export const AUTHORING_ENTRY = join(here, "..", "src", "plugins", "authoring.ts");

/** Absolute path to the committed, generated declarations. */
export const PLUGIN_TYPES_TARGET = join(
    here,
    "..",
    "..",
    "..",
    "templates",
    "plugin",
    "types",
    "plugin.d.ts",
);

const BANNER = `/**
 * The Tumult plugin API — vendored, self-contained, one file.
 *
 * A plugin author needs these types and nothing else. The file is GENERATED
 * from the Tumult repository: do not edit it by hand. Its source is
 * \`packages/ui/src/plugins/authoring.ts\` (the explicit plugin-author surface),
 * bundled by \`packages/ui/scripts/build-plugin-types.ts\` and guarded by
 * \`packages/ui/test/plugin-types.test.ts\`, which fails when this file and the
 * generator disagree. To pick up an API change, update authoring.ts and run
 * \`pnpm --filter @tumult/ui emit:types\`.
 *
 * The \`vue\` import here is a TYPE-only dependency; a plugin's template lists
 * \`vue\` for its types, while the runtime component comes from the shell
 * (\`globalThis.__tumult.vue\`). Pinned to plugin API \`1.0.0\` and core contract
 * \`1.0.0\` — the versions a manifest's \`minUI\` / \`minCore\` are compared
 * against.
 */
`;

/**
 * Generate the vendored declarations as a string, byte-for-byte identical to
 * what `emit:types` writes. Throws rather than returning a half-built file.
 */
export function buildPluginTypes(): string {
    const [bundle] = generateDtsBundle(
        [
            {
                filePath: AUTHORING_ENTRY,
                output: {
                    noBanner: true,
                    inlineDeclareExternals: false,
                    // Do not export types only referenced internally: the file
                    // is the surface a plugin may see, and nothing more.
                    exportReferencedTypes: false,
                },
            },
        ],
        {
            // A dedicated config (no `.vue`, no `extends`) because the generator
            // runs plain tsc, which cannot parse SFCs — the author surface
            // deliberately reaches none.
            preferredConfigPath: join(here, "..", "tsconfig.plugin-types.json"),
        },
    );
    if (!bundle) throw new Error("dts-bundle-generator produced no output");
    return `${BANNER}\n${bundle}`;
}
