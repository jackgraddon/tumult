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

    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        element.remove();
    };
}
