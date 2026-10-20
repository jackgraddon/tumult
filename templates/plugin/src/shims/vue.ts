/**
 * The `vue` your bundle builds against.
 *
 * A plugin must share the HOST's Vue instance — a second copy would break
 * `provide`/`inject` and split reactivity in two. So the build aliases `vue`
 * to this shim (see `esbuild.config.mjs`), and Tumult puts its own runtime on
 * `globalThis.__tumult.vue` before it installs any plugin.
 *
 * Import the real `vue` for its TYPES (`import { h } from "vue"` still
 * typechecks — `vue` is a devDependency); at runtime this file is what ships.
 * Everything is resolved lazily so a missing bridge throws a sentence that
 * names the problem instead of `undefined is not a function`.
 *
 * Only the members a plugin realistically needs are forwarded. To use one that
 * is not here, add it (and its type import) — the shim is the whole surface.
 */
import type {
    Component,
    ComputedRef,
    EffectScope,
    MaybeRef,
    Ref,
    VNode,
    WatchOptions,
    WatchSource,
} from "vue";

interface VueRuntime {
    h: typeof import("vue").h;
    defineComponent: typeof import("vue").defineComponent;
    defineAsyncComponent: typeof import("vue").defineAsyncComponent;
    ref: typeof import("vue").ref;
    shallowRef: typeof import("vue").shallowRef;
    reactive: typeof import("vue").reactive;
    computed: typeof import("vue").computed;
    watch: typeof import("vue").watch;
    watchEffect: typeof import("vue").watchEffect;
    effectScope: typeof import("vue").effectScope;
    onMounted: typeof import("vue").onMounted;
    onBeforeUnmount: typeof import("vue").onBeforeUnmount;
    nextTick: typeof import("vue").nextTick;
    toRefs: typeof import("vue").toRefs;
    inject: typeof import("vue").inject;
    provide: typeof import("vue").provide;
    markRaw: typeof import("vue").markRaw;
}

/** The bridge Tumult installs at boot. Absent inside the sandbox lane. */
const bridge = (globalThis as { __tumult?: { vue?: VueRuntime } }).__tumult?.vue;

/** Every export goes through this, so a missing bridge fails loudly. */
function runtime(): VueRuntime {
    const vue = (globalThis as { __tumult?: { vue?: VueRuntime } }).__tumult?.vue;
    if (!vue) {
        throw new Error(
            "[tumult] this plugin built against Vue, but the host provided no Vue runtime. " +
                "A logic-only plugin must not import `vue` — it is the sandbox lane, which has " +
                "no DOM. Declare a component permission (e.g. `commands` → fine; " +
                "`timeline-renderers` needs no Vue import at all) or drop the import.",
        );
    }
    return vue;
}

export const h: VueRuntime["h"] = ((...args: unknown[]) =>
    (runtime().h as (...a: unknown[]) => unknown)(...args)) as VueRuntime["h"];
export const defineComponent: VueRuntime["defineComponent"] = ((...args: unknown[]) =>
    (runtime().defineComponent as (...a: unknown[]) => unknown)(...args)) as VueRuntime["defineComponent"];
export const defineAsyncComponent: VueRuntime["defineAsyncComponent"] = ((...args: unknown[]) =>
    (runtime().defineAsyncComponent as (...a: unknown[]) => unknown)(
        ...args,
    )) as VueRuntime["defineAsyncComponent"];
export const ref: VueRuntime["ref"] = ((...args: unknown[]) =>
    (runtime().ref as (...a: unknown[]) => unknown)(...args)) as VueRuntime["ref"];
export const shallowRef: VueRuntime["shallowRef"] = ((...args: unknown[]) =>
    (runtime().shallowRef as (...a: unknown[]) => unknown)(...args)) as VueRuntime["shallowRef"];
export const reactive: VueRuntime["reactive"] = ((...args: unknown[]) =>
    (runtime().reactive as (...a: unknown[]) => unknown)(...args)) as VueRuntime["reactive"];
export const computed: VueRuntime["computed"] = ((...args: unknown[]) =>
    (runtime().computed as (...a: unknown[]) => unknown)(...args)) as VueRuntime["computed"];
export const watch: VueRuntime["watch"] = ((...args: unknown[]) =>
    (runtime().watch as (...a: unknown[]) => unknown)(...args)) as VueRuntime["watch"];
export const watchEffect: VueRuntime["watchEffect"] = ((...args: unknown[]) =>
    (runtime().watchEffect as (...a: unknown[]) => unknown)(...args)) as VueRuntime["watchEffect"];
export const effectScope: VueRuntime["effectScope"] = ((...args: unknown[]) =>
    (runtime().effectScope as (...a: unknown[]) => unknown)(...args)) as VueRuntime["effectScope"];
export const onMounted: VueRuntime["onMounted"] = ((...args: unknown[]) =>
    (runtime().onMounted as (...a: unknown[]) => unknown)(...args)) as VueRuntime["onMounted"];
export const onBeforeUnmount: VueRuntime["onBeforeUnmount"] = ((...args: unknown[]) =>
    (runtime().onBeforeUnmount as (...a: unknown[]) => unknown)(...args)) as VueRuntime["onBeforeUnmount"];
export const nextTick: VueRuntime["nextTick"] = ((...args: unknown[]) =>
    (runtime().nextTick as (...a: unknown[]) => unknown)(...args)) as VueRuntime["nextTick"];
export const toRefs: VueRuntime["toRefs"] = ((...args: unknown[]) =>
    (runtime().toRefs as (...a: unknown[]) => unknown)(...args)) as VueRuntime["toRefs"];
export const inject: VueRuntime["inject"] = ((...args: unknown[]) =>
    (runtime().inject as (...a: unknown[]) => unknown)(...args)) as VueRuntime["inject"];
export const provide: VueRuntime["provide"] = ((...args: unknown[]) =>
    (runtime().provide as (...a: unknown[]) => unknown)(...args)) as VueRuntime["provide"];
export const markRaw: VueRuntime["markRaw"] = ((...args: unknown[]) =>
    (runtime().markRaw as (...a: unknown[]) => unknown)(...args)) as VueRuntime["markRaw"];

/** Unused-import guard for the type-only imports above. */
export type { Component, ComputedRef, EffectScope, MaybeRef, Ref, VNode, WatchOptions, WatchSource };
export type { VueRuntime };
