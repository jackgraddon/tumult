/**
 * Regenerate `src/shims/vue.ts` from the installed `vue` package.
 *
 * A plugin must share the HOST's Vue instance: `provide`/`inject` and the
 * reactivity system are per-instance, so a plugin that bundled its own copy
 * would render but could not inject anything the shell provides, and its
 * lifecycle hooks would find no active component instance. The build aliases
 * `vue` to the shim (see `vite.config.ts`), and the shim forwards to
 * `globalThis.__tumult.vue`, which the shell installs before it imports a
 * plugin bundle.
 *
 * The shim is GENERATED, not hand-written, because a compiled single-file
 * component calls internal helpers — `openBlock`, `createElementBlock`,
 * `renderList`, `toDisplayString`, `withCtx`, `withDirectives` — that a
 * hand-written list would forget. This script reads the real export list of
 * the installed `vue` and emits one forwarding binding per export, so the
 * shim cannot drift from the runtime the host actually provides.
 *
 * Only the exports the *type* declarations also have are emitted: `vue`
 * ships a handful of development-only internals (`compatUtils`,
 * `assertNumber`, …) that exist at runtime but are not part of its public
 * type, and a binding to one of those could not be typed.
 *
 * Run it after changing the `vue` dependency:
 *
 *     pnpm shim
 *
 * The output is committed, so a plain `pnpm install && pnpm build` works
 * without this script.
 */
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

import ts from "typescript";

import * as vue from "vue";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "src", "shims", "vue.ts");

/**
 * The names `vue` exports *as types* — the public surface, minus the
 * development-only internals that exist at runtime only.
 */
function typedExportNames() {
    const probe = join(ROOT, ".vue-shim-probe.ts");
    writeFileSync(probe, 'import * as vue from "vue";\nexport default vue;\n');
    try {
        const configFile = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
        const program = ts.createProgram([probe], { ...parsed.options, noEmit: true });
        const checker = program.getTypeChecker();
        const source = program.getSourceFile(probe);
        if (!source) throw new Error("could not read the probe file");
        const moduleSymbol = checker.getSymbolAtLocation(source);
        if (!moduleSymbol) throw new Error("could not resolve the module symbol");
        const defaultExport = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === "default");
        if (!defaultExport) throw new Error("could not find the module's default export");
        const moduleType = checker.getTypeOfSymbolAtLocation(defaultExport, source);
        return new Set(
            checker
                .getPropertiesOfType(moduleType)
                .map((property) => property.getName())
                .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)),
        );
    } finally {
        rmSync(probe, { force: true });
    }
}

const typed = typedExportNames();

/** Runtime exports the type declarations also have. */
const names = Object.keys(vue)
    .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !name.startsWith("__"))
    .filter((name) => typed.has(name))
    .sort();

const header = `/**
 * The \`vue\` your bundle builds against — GENERATED, do not edit by hand.
 *
 * Run \`pnpm shim\` (scripts/gen-vue-shim.mjs) to regenerate it from the
 * installed \`vue\` package.
 *
 * A plugin must share the HOST's Vue instance — a second copy would break
 * \`provide\`/\`inject\` and split reactivity in two. So the build aliases
 * \`vue\` to this file (see \`vite.config.ts\`), and the shell puts its own
 * runtime on \`globalThis.__tumult.vue\` before it imports any plugin.
 *
 * Every export below is a binding to the host's own value, so a compiled
 * single-file component finds the helpers it needs (\`openBlock\`,
 * \`createElementBlock\`, \`renderList\`, \`toDisplayString\`, …) and the
 * identity-sensitive ones (\`Fragment\`, \`Transition\`) are the host's
 * objects, not look-alikes.
 *
 * Import the real \`vue\` for your TYPES (\`import { h } from "vue"\` still
 * typechecks — \`vue\` is a devDependency); at runtime this file is what
 * ships.
 */
import type * as VueRuntime from "vue";

type Bridge = typeof VueRuntime;

let cached: Bridge | undefined;

/** The host's Vue runtime, resolved once and remembered. */
function runtime(): Bridge {
    if (cached) return cached;
    const bridge = (globalThis as { __tumult?: { vue?: unknown } }).__tumult?.vue as
        | Bridge
        | undefined;
    if (!bridge) {
        throw new Error(
            "[tumult] this plugin needs the host's Vue runtime, and the host published none. " +
                "A plugin that contributes a component runs in the trusted lane, where the shell " +
                "installs \`globalThis.__tumult.vue\` before the bundle is imported.",
        );
    }
    cached = bridge;
    return cached;
}
`;

const bindings = names
    .map((name) => `export const ${name}: typeof VueRuntime.${name} = runtime().${name};`)
    .join("\n");

const types = `
// The type names a plugin author reaches for. Types are erased at runtime —
// these exist so \`import type { Component } from "vue"\` keeps working inside
// the plugin's own sources. (Names that are values as well as types —
// \`EffectScope\`, \`Fragment\` — are already bound above, so they are not
// repeated here.)
export type {
    Component,
    ComputedRef,
    CSSProperties,
    MaybeRef,
    Ref,
    ShallowRef,
    VNode,
    WatchOptions,
    WatchSource,
} from "vue";
`;

writeFileSync(OUT, `${header}\n${bindings}\n${types}`);

console.log(`wrote ${OUT} (${names.length} exports)`);
