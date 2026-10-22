/** `thumb-up` → `mdiThumbUp`, the export name `@mdi/js` uses for the icon. */
export function mdiExportName(name: string): string {
    return "mdi" + name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}
