import type { IconDef, IconPack } from "./registry.ts";
import { mdiExportName } from "./exportName.ts";
import { BUILTIN_ICON_PATHS } from "./builtin.generated.ts";

let library: Promise<Record<string, string>> | undefined;

/** The whole library, fetched once, as its own chunk — never in the entry. */
function loadLibrary(): Promise<Record<string, string>> {
    library ??= import("@mdi/js") as unknown as Promise<Record<string, string>>;
    return library;
}

/**
 * The built-in pack: Material Design Icons by their kebab-case names.
 *
 * First-party icons resolve synchronously from the generated map; any other
 * name in the library resolves from the lazily loaded chunk, so a plugin can
 * use the full set without the main bundle paying for it. Unknown → undefined.
 */
export const mdiPack: IconPack = {
    resolve(name: string): IconDef | undefined | Promise<IconDef | undefined> {
        const path = BUILTIN_ICON_PATHS[name];
        if (path !== undefined) return { path };
        return loadLibrary().then((mdi) => {
            const found = mdi[mdiExportName(name)];
            return found === undefined ? undefined : { path: found };
        });
    },
};
