import { inject, type InjectionKey } from "vue";

import type { Disposable } from "../plugins/types.ts";

/**
 * One icon: a single SVG path in a square viewBox, drawn with `currentColor`.
 * Path-only on purpose — it lands in a `d` attribute, never in markup, so a
 * pack we did not write cannot inject anything.
 */
export interface IconDef {
    path: string;
    /** Side of the square viewBox. Default 24. */
    viewBox?: number;
}

/**
 * A named set of icons. `resolve` may answer synchronously or later (a pack
 * that loads its glyphs lazily); `undefined` means "this pack has no such icon".
 */
export interface IconPack {
    resolve(name: string): IconDef | undefined | Promise<IconDef | undefined>;
}

/** The pack a bare name (`"cog"`) resolves in. */
export const DEFAULT_ICON_PACK = "mdi";

export interface IconRef {
    pack: string;
    name: string;
}

const ICON_NAME = /^(?:([a-z][a-z0-9-]*):)?([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/**
 * `"cog"` → `{ pack: "mdi", name: "cog" }`, `"solar:home-2"` → pack `solar`.
 * `null` when the string is not an icon name at all (an emoji, a capital
 * letter, a path) — callers render those as literal text.
 */
export function parseIconRef(ref: string): IconRef | null {
    const match = ICON_NAME.exec(ref);
    if (!match) return null;
    return { pack: match[1] ?? DEFAULT_ICON_PACK, name: match[2]! };
}

/**
 * Per-shell icon registry (provide/inject — never a module singleton, same
 * rule as the other registries). The built-in Material pack is registered by
 * the caller; a host or plugin adds more under their own prefix, so names stay
 * unambiguous without standardizing them across libraries.
 */
export class IconRegistry {
    private readonly packs = new Map<string, IconPack>();

    public addPack(id: string, pack: IconPack): Disposable {
        if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`Invalid icon pack id "${id}"`);
        this.packs.set(id, pack);
        return () => {
            if (this.packs.get(id) === pack) this.packs.delete(id);
        };
    }

    /** The icon for `ref`, or `undefined` for an unknown pack/name or a non-name string. */
    public resolve(ref: string): IconDef | undefined | Promise<IconDef | undefined> {
        const parsed = parseIconRef(ref);
        if (!parsed) return undefined;
        return this.packs.get(parsed.pack)?.resolve(parsed.name);
    }
}

export const IconsKey: InjectionKey<IconRegistry> = Symbol("tumult/icons");

/**
 * `null` outside a shell: `Icon` is an exported primitive, and a standalone use
 * falls back to the built-in pack alone rather than throwing.
 */
export function useIcons(): IconRegistry | null {
    return inject(IconsKey, null);
}
