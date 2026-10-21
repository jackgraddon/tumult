/**
 * The Vue bridge — how a third-party plugin gets the *host's* Vue.
 *
 * A plugin must share the host's Vue instance: `provide`/`inject` and the
 * reactivity system are per-instance, so a plugin that bundled its own copy
 * would render but could not inject anything the shell provides, and its
 * `onMounted` would find no active component instance. The template's build
 * therefore aliases `vue` to a shim that forwards to `globalThis.__tumult.vue`
 * — but nothing set that global, because until now no third-party plugin
 * shipped a component.
 *
 * This module is what sets it. It hands over the **whole `vue` namespace**,
 * not a hand-picked subset: a compiled single-file component calls internal
 * helpers (`openBlock`, `createElementBlock`, `renderList`, `toDisplayString`,
 * …) that are part of the package's public exports but would be tedious — and
 * fragile — to enumerate by hand.
 */

import * as Vue from "vue";

interface TumultGlobals {
    vue?: unknown;
    [key: string]: unknown;
}

/**
 * Publish the host's Vue runtime on `globalThis.__tumult.vue`.
 *
 * Safe to call more than once, and safe to call before the app's own globals
 * are installed — the bridge merges into whatever is already there rather than
 * replacing it.
 */
export function installVueBridge(): void {
    const globals = globalThis as typeof globalThis & { __tumult?: TumultGlobals };
    const existing = globals.__tumult ?? {};
    globals.__tumult = { ...existing, vue: Vue };
}

// Installed as soon as the UI package is imported — before the app has drawn
// anything and therefore before any plugin bundle is fetched. A plugin that
// is installed later finds the bridge already in place; one that is loaded
// eagerly finds it too.
installVueBridge();
