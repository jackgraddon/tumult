/**
 * Development-only shims for the workspace typecheck
 * (`tsconfig.workspace.json`). NOT shipped to plugin authors.
 *
 * `packages/ui/src/index.ts` (the real API surface) imports `.vue` SFCs and
 * `.ts` sources with explicit extensions. Under `vue-tsc` those are understood;
 * plain `tsc` needs them declared. This file exists so the template example can
 * be typechecked against the real sources with `tsc` alone.
 */
declare module "*.vue" {
    import type { DefineComponent } from "vue";
    const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
    export default component;
}
