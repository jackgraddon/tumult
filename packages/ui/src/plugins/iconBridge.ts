/**
 * The icon bridge — the host's Material icon library, for plugin components.
 *
 * A plugin's manifest `icon` is resolved by the shell (§Icons), but a plugin
 * that renders its own Vue component needs the same glyphs. The registry is
 * per-shell and provided through Vue's `provide`/`inject`, which a third-party
 * bundle cannot reach from `install(ctx)` — it has no component instance. This
 * publishes a small, read-only view of that registry on
 * `globalThis.__tumult.icons` instead, alongside the Vue bridge.
 *
 * Only paths cross the boundary. An `IconDef` lands in an SVG `d` attribute,
 * never in markup, so a plugin cannot inject HTML through an icon name.
 */
import type { IconRegistry } from "../icons/registry.ts";

interface TumultGlobals {
    vue?: unknown;
    icons?: unknown;
    [key: string]: unknown;
}

/** One Material Design Icon, in a square viewBox, drawn with `currentColor`. */
export interface PluginIconDef {
    path: string;
    viewBox?: number;
}

/** The read-only icon surface a trusted plugin can reach at runtime. */
export interface PluginIconApi {
    /**
     * Resolve a Material Design Icons name (or `pack:name`) to its SVG path.
     * First-party names resolve immediately; the rest wait for the lazily
     * loaded library. Unknown names resolve to `null`.
     */
    resolve(name: string): Promise<PluginIconDef | null>;
}

/**
 * Publish this shell's icon registry on `globalThis.__tumult.icons`.
 *
 * Safe to call more than once; later shells replace the resolver with their
 * own. Like the Vue bridge, it merges into whatever is already there.
 */
export function installIconBridge(registry: IconRegistry): PluginIconApi {
    const icons: PluginIconApi = {
        async resolve(name: string): Promise<PluginIconDef | null> {
            const found = await registry.resolve(name);
            if (!found) return null;
            return found.viewBox === undefined
                ? { path: found.path }
                : { path: found.path, viewBox: found.viewBox };
        },
    };
    const globals = globalThis as typeof globalThis & { __tumult?: TumultGlobals };
    globals.__tumult = { ...(globals.__tumult ?? {}), icons };
    return icons;
}
