import { IconRegistry } from "./registry.ts";
import { mdiPack } from "./mdi.ts";

/** A registry with the built-in Material pack installed. */
export function createIconRegistry(): IconRegistry {
    const registry = new IconRegistry();
    registry.addPack("mdi", mdiPack);
    return registry;
}
