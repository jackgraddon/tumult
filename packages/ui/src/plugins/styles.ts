/**
 * Plugin stylesheet injection.
 *
 * Plugins ship TypeScript modules, but a renderer's own CSS is usually easier
 * to write as text than as a scoped SFC, so `injectStylesheet(css)` appends one
 * `<style>` element to the document head and hands back a disposable that
 * removes it.
 *
 * The CSS is **not** shadowed or rewritten: it applies app-wide. A plugin's
 * stylesheet is first-party, app-authored CSS — the same trust level as the
 * module that injected it — and the shell has no shadow root to scope into.
 * What the guard buys is that an injected stylesheet can never make the
 * browser fetch a third-party resource: no `@import`, and no `url()` except
 * `data:`, `blob:` and same-document fragments. The dev CSP already allows only
 * `'self'` for styles and `data:`/`blob:`/`https:` for images, so a remote
 * reference would otherwise fail silently in the console; here it becomes an
 * install-time error naming the offending declaration.
 *
 * The guard itself lives in `@tumult/theme/runtime`: the app's advanced-CSS
 * opt-in is the same rule applied from the boot path, which must not pull the
 * UI package (or the theme registry) into the entry chunk.
 */

import { findExternalStylesheetReferences } from "@tumult/theme/runtime";

import type { Disposable } from "./types.ts";

export { findExternalStylesheetReferences };

/**
 * Append `css` as a `<style>` element owned by `owner` (a plugin id, or
 * `"shell"`). Throws when the stylesheet references anything remote, so the
 * install rolls back instead of half-applying. The returned disposable is
 * idempotent and removes exactly that element.
 */
export function injectStylesheet(css: string, owner: string): Disposable {
    const external = findExternalStylesheetReferences(css);
    if (external.length > 0) {
        throw new Error(
            `[tumult] the stylesheet from "${owner}" references external resources ` +
                `(${external.join(", ")}); inline them as data: URLs instead`,
        );
    }

    const element = document.createElement("style");
    element.dataset["tumultPluginStyles"] = owner;
    element.textContent = css;
    document.head.append(element);
    if (owner !== SHELL_OWNER) {
        pluginStyles.add(element);
        // `disabled` only takes once the sheet exists, i.e. after append.
        element.disabled = suspensions > 0;
    }

    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        pluginStyles.delete(element);
        element.remove();
    };
}

/** The shell's own stylesheets (registry.injectStylesheet) are never suspended. */
const SHELL_OWNER = "shell";
const pluginStyles = new Set<HTMLStyleElement>();
let suspensions = 0;

/**
 * Turn every PLUGIN stylesheet off until the returned function is called.
 *
 * Plugin CSS applies app-wide, so a plugin with the `styles` permission —
 * which a sandboxed plugin may hold — could restyle the screens that protect
 * the user: hide the consent screen's warning, relabel "They match" on emoji
 * verification, overlay the recovery key (security review finding F3). CSS
 * cannot be scoped away from a sandboxed plugin (it has no DOM of its own to
 * scope to), so instead the security surfaces switch plugin CSS off while they
 * are on screen. Counted, so overlapping surfaces nest; the release is
 * idempotent. Stylesheets injected while suspended start disabled.
 */
export function suspendPluginStyles(): () => void {
    suspensions += 1;
    applySuspension();
    let released = false;
    return () => {
        if (released) return;
        released = true;
        suspensions -= 1;
        applySuspension();
    };
}

function applySuspension(): void {
    for (const element of pluginStyles) element.disabled = suspensions > 0;
}
